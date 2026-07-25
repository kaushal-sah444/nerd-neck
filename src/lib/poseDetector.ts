/**
 * Pose detection and the posture metric.
 *
 * Wraps TensorFlow.js MoveNet and reduces 17 body keypoints down to three numbers
 * that describe how you are sitting. Everything runs in the browser via WebGL —
 * frames are read straight from the `<video>` element and never transmitted.
 *
 * ## Measuring "tech neck" from a front-facing webcam
 *
 * The clinical measure of forward head posture is the craniovertebral angle, which
 * needs a *side* view. A laptop webcam sees you head-on, so this uses two proxies
 * that work front-on and are robust to how far you sit from the camera:
 *
 * 1. **Neck angle** — the angle between vertical and the line from the shoulder
 *    midpoint to the ear midpoint. Sitting tall keeps the head stacked above the
 *    shoulders (small angle); slumping drops it forward and down (larger angle).
 * 2. **Head height ratio** — vertical head-above-shoulders distance divided by
 *    shoulder width. Slouching compresses it. Dividing by shoulder width makes it
 *    scale-invariant, so leaning closer to the screen doesn't fake a good score.
 *
 * Both are noisy frame to frame, so `smoothMetrics` applies a short moving average
 * before anything is judged.
 */

// Type-only: erased at compile time, so importing these costs nothing at runtime.
// TensorFlow itself is ~2.3 MB and is loaded dynamically in `createDetector`, which
// keeps it out of the initial bundle — the page paints immediately and the model
// only downloads once the user actually starts tracking.
import type * as poseDetection from "@tensorflow-models/pose-detection";

import type { PostureThresholds } from "./config";

export type PostureState = "good" | "slouching" | "unknown";

export interface PostureMetrics {
  /** Degrees between vertical and the shoulders→ears vector. Higher is worse. */
  neckAngleDeg: number;
  /** Head-above-shoulders distance / shoulder width. Lower is worse. */
  headHeightRatio: number;
  /** Degrees the shoulder line sits off horizontal. */
  shoulderTiltDeg: number;
  /** Lowest confidence among the keypoints used. */
  confidence: number;
}

export interface PostureReading {
  state: PostureState;
  metrics: PostureMetrics | null;
  keypoints: poseDetection.Keypoint[];
  /** Human-readable reason a frame was judged the way it was. */
  reason: string;
}

const REQUIRED_KEYPOINTS = [
  "left_shoulder",
  "right_shoulder",
  "left_ear",
  "right_ear",
] as const;

/** Which compute backend TensorFlow ended up using. */
export type Backend = "webgl" | "cpu";

export interface Detector {
  detector: poseDetection.PoseDetector;
  backend: Backend;
}

/**
 * Bring up a backend, in order of preference.
 *
 * `setBackend` **returns `false`** when a backend cannot initialise — it does not
 * throw — so the result has to be checked. Getting that wrong means the fallback
 * silently never runs and `tf.ready()` fails later with the unhelpful "all backend
 * initializations failed".
 *
 * WebGL is tried first because it is roughly an order of magnitude faster. It is
 * genuinely unavailable on plenty of real machines (hardware acceleration turned
 * off, a blocklisted GPU driver, a locked-down VM), so CPU has to be a real
 * fallback and not a theoretical one.
 */
async function selectBackend(
  tf: typeof import("@tensorflow/tfjs-core"),
): Promise<Backend> {
  const candidates: Backend[] = ["webgl", "cpu"];
  const failures: string[] = [];

  for (const name of candidates) {
    try {
      if (await tf.setBackend(name)) {
        await tf.ready();
        return name;
      }
      failures.push(`${name}: unavailable`);
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message}`);
    }
  }

  throw new Error(
    `No usable TensorFlow backend (${failures.join("; ")}). ` +
      "Enable hardware acceleration in your browser settings, or try another browser.",
  );
}

export async function createDetector(): Promise<Detector> {
  const [tf, detection] = await Promise.all([
    import("@tensorflow/tfjs-core"),
    import("@tensorflow-models/pose-detection"),
    // Side-effect imports: each one registers itself with tfjs-core. The CPU
    // backend is what makes the fallback above actually possible.
    import("@tensorflow/tfjs-backend-webgl"),
    import("@tensorflow/tfjs-backend-cpu"),
  ]);

  const backend = await selectBackend(tf);

  const detector = await detection.createDetector(
    detection.SupportedModels.MoveNet,
    { modelType: detection.movenet.modelType.SINGLEPOSE_LIGHTNING },
  );

  return { detector, backend };
}

function midpoint(a: poseDetection.Keypoint, b: poseDetection.Keypoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Reduce a set of keypoints to posture metrics.
 *
 * Returns ``null`` when the keypoints needed are missing or too low-confidence —
 * better to report "can't tell" than to score a frame where you left the desk.
 */
export function computeMetrics(
  keypoints: poseDetection.Keypoint[],
  minScore: number,
): PostureMetrics | null {
  const byName = new Map(keypoints.map((k) => [k.name ?? "", k]));

  const needed = REQUIRED_KEYPOINTS.map((name) => byName.get(name));
  if (needed.some((k) => !k)) return null;

  const [leftShoulder, rightShoulder, leftEar, rightEar] =
    needed as poseDetection.Keypoint[];

  const confidence = Math.min(
    ...needed.map((k) => (k as poseDetection.Keypoint).score ?? 0),
  );
  if (confidence < minScore) return null;

  const shoulders = midpoint(leftShoulder, rightShoulder);
  const ears = midpoint(leftEar, rightEar);

  const shoulderWidth = Math.hypot(
    leftShoulder.x - rightShoulder.x,
    leftShoulder.y - rightShoulder.y,
  );
  if (shoulderWidth < 1) return null; // degenerate; camera probably lost the body

  // Image coordinates put y=0 at the top, so "head above shoulders" is a
  // *negative* dy. Flip it so the ratio reads positively when sitting upright.
  const dx = ears.x - shoulders.x;
  const dy = shoulders.y - ears.y;

  const headHeightRatio = dy / shoulderWidth;

  // Angle away from straight-up. atan2(horizontal, vertical) gives 0 when the head
  // is directly above the shoulders and grows as it drifts sideways or drops.
  const neckAngleDeg = Math.abs((Math.atan2(dx, Math.max(dy, 1e-6)) * 180) / Math.PI);

  const shoulderTiltDeg = Math.abs(
    (Math.atan2(leftShoulder.y - rightShoulder.y, leftShoulder.x - rightShoulder.x) *
      180) /
      Math.PI,
  );

  return {
    neckAngleDeg,
    headHeightRatio,
    // A tilt near 180° is the same posture as one near 0° — the shoulder line is
    // just labelled in the other direction.
    shoulderTiltDeg: shoulderTiltDeg > 90 ? 180 - shoulderTiltDeg : shoulderTiltDeg,
    confidence,
  };
}

/** Judge a set of metrics against the thresholds. */
export function classifyPosture(
  metrics: PostureMetrics | null,
  thresholds: PostureThresholds,
  /** Optional calibrated baseline ratio from the user sitting up straight. */
  baselineRatio?: number,
): { state: PostureState; reason: string } {
  if (!metrics) {
    return { state: "unknown", reason: "Can't see your head and shoulders" };
  }

  // A personal baseline beats a fixed number: torso proportions and camera angle
  // vary enormously between people. Allow a 12% drop from the calibrated posture.
  const heightFloor =
    baselineRatio !== undefined
      ? baselineRatio * 0.88
      : thresholds.minHeadHeightRatio;

  if (metrics.headHeightRatio < heightFloor) {
    return { state: "slouching", reason: "Head has dropped toward your shoulders" };
  }
  if (metrics.neckAngleDeg > thresholds.slouchAngleDeg) {
    return { state: "slouching", reason: "Neck is craning forward" };
  }
  if (metrics.shoulderTiltDeg > thresholds.maxShoulderTiltDeg) {
    return { state: "slouching", reason: "You're leaning to one side" };
  }
  return { state: "good", reason: "Sitting tall" };
}

/** Moving average over the last `window` readings, to stop single-frame jitter. */
export function smoothMetrics(
  history: PostureMetrics[],
  window = 5,
): PostureMetrics | null {
  const recent = history.slice(-window);
  if (recent.length === 0) return null;

  const mean = (pick: (m: PostureMetrics) => number) =>
    recent.reduce((sum, m) => sum + pick(m), 0) / recent.length;

  return {
    neckAngleDeg: mean((m) => m.neckAngleDeg),
    headHeightRatio: mean((m) => m.headHeightRatio),
    shoulderTiltDeg: mean((m) => m.shoulderTiltDeg),
    confidence: mean((m) => m.confidence),
  };
}
