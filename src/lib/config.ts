/** Tunable thresholds. Everything the user can reasonably want to change lives here. */

export interface PostureThresholds {
  /**
   * Neck angle (degrees from vertical) above which posture counts as slouching.
   *
   * Measured between the shoulder midpoint and the ear midpoint: sit tall and the
   * head sits almost straight above the shoulders (small angle); crane forward and
   * down and the angle opens up.
   */
  slouchAngleDeg: number;
  /**
   * Minimum normalised head height (head-above-shoulders distance divided by
   * shoulder width). Slumping pulls the head down toward the shoulders, shrinking
   * this ratio. Dividing by shoulder width keeps it independent of how far you are
   * from the camera.
   */
  minHeadHeightRatio: number;
  /** Shoulder tilt (degrees off horizontal) that counts as leaning. */
  maxShoulderTiltDeg: number;
  /** Keypoint confidence below which a frame is treated as "can't tell". */
  minKeypointScore: number;
  /** Seconds of continuous slouching before a roast fires. */
  slouchGraceSeconds: number;
  /** Cooldown after a roast so it can't spam you. */
  roastCooldownSeconds: number;
  /** Points awarded per minute of good posture. */
  pointsPerMinute: number;
  /** Points in a day needed to keep the daily streak alive. */
  dailyGoalPoints: number;
  /** Pose inferences per second. */
  targetFps: number;
}

export const DEFAULT_THRESHOLDS: PostureThresholds = {
  slouchAngleDeg: 22,
  minHeadHeightRatio: 0.42,
  maxShoulderTiltDeg: 12,
  minKeypointScore: 0.35,
  slouchGraceSeconds: 15,
  roastCooldownSeconds: 60,
  pointsPerMinute: 10,
  dailyGoalPoints: 100,
  targetFps: 10,
};

const SETTINGS_KEY = "nerdneck.settings.v1";

export function loadThresholds(): PostureThresholds {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    // Merge rather than replace, so a stored config from an older version still
    // gets any newly added fields.
    return { ...DEFAULT_THRESHOLDS, ...(JSON.parse(raw) as Partial<PostureThresholds>) };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function saveThresholds(thresholds: PostureThresholds): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(thresholds));
  } catch {
    // Storage full or blocked (private mode). Settings just won't persist.
  }
}
