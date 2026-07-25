/**
 * Scoring, streak and roast-trigger behaviour.
 *
 * Driven entirely by feeding the pure `tick` function elapsed time, so the rules
 * are verified without a webcam, a model download or a browser.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS, type PostureThresholds } from "./config";
import {
  createSession,
  formatDuration,
  pointsFor,
  postureRatio,
  tick,
  type SessionState,
} from "./postureScoring";
import {
  dailyStreak,
  emptyDay,
  recentDays,
  todayKey,
  upsertToday,
  type HistoryStore,
} from "./storage";
import { classifyPosture, computeMetrics, smoothMetrics } from "./poseDetector";

const T: PostureThresholds = { ...DEFAULT_THRESHOLDS, slouchGraceSeconds: 15, roastCooldownSeconds: 60 };

/** Run `seconds` of a single posture state, one second at a time. */
function run(session: SessionState, state: "good" | "slouching" | "unknown", seconds: number) {
  let current = session;
  let roasts = 0;
  for (let i = 0; i < seconds; i++) {
    const result = tick(current, state, 1, T);
    current = result.session;
    if (result.shouldRoast) roasts++;
  }
  return { session: current, roasts };
}

describe("scoring", () => {
  it("accumulates good time and points", () => {
    const { session } = run(createSession(), "good", 120);
    expect(session.goodSeconds).toBe(120);
    expect(pointsFor(session.goodSeconds, T)).toBe(T.pointsPerMinute * 2);
  });

  it("does not count time when posture cannot be determined", () => {
    const { session } = run(createSession(), "unknown", 60);
    expect(session.goodSeconds).toBe(0);
    expect(session.slouchSeconds).toBe(0);
    expect(session.currentStreakSeconds).toBe(0);
  });

  it("breaks the current streak on a slouch but keeps the best", () => {
    let s = run(createSession(), "good", 40).session;
    expect(s.currentStreakSeconds).toBe(40);

    s = run(s, "slouching", 5).session;
    expect(s.currentStreakSeconds).toBe(0);
    expect(s.bestStreakSeconds).toBe(40);

    s = run(s, "good", 10).session;
    expect(s.currentStreakSeconds).toBe(10);
    expect(s.bestStreakSeconds).toBe(40);
  });

  it("reports the share of judged time spent sitting well", () => {
    let s = run(createSession(), "good", 75).session;
    s = run(s, "slouching", 25).session;
    s = run(s, "unknown", 100).session; // must not dilute the ratio
    expect(postureRatio(s)).toBeCloseTo(0.75);
  });
});

describe("roast triggering", () => {
  it("stays quiet until the grace period elapses", () => {
    const { roasts } = run(createSession(), "slouching", T.slouchGraceSeconds - 1);
    expect(roasts).toBe(0);
  });

  it("fires exactly once when the grace period is crossed", () => {
    const { roasts } = run(createSession(), "slouching", T.slouchGraceSeconds);
    expect(roasts).toBe(1);
  });

  it("does not re-fire while you keep slouching", () => {
    const { roasts } = run(createSession(), "slouching", 600);
    expect(roasts).toBe(1);
  });

  it("respects the cooldown between separate slouches", () => {
    // Slouch → roast, sit up briefly, slouch again inside the cooldown window.
    let s = run(createSession(), "slouching", 20).session;
    expect(s.roastCount).toBe(1);

    s = run(s, "good", 5).session;
    const second = run(s, "slouching", 20);
    expect(second.roasts).toBe(0);
    expect(second.session.roastCount).toBe(1);
  });

  it("roasts again once the cooldown has passed", () => {
    let s = run(createSession(), "slouching", 20).session;
    s = run(s, "good", T.roastCooldownSeconds).session;
    const second = run(s, "slouching", 20);
    expect(second.roasts).toBe(1);
  });
});

describe("history and daily streaks", () => {
  const day = (date: string, points: number) => ({ ...emptyDay(date), points });

  it("keeps the best streak as a high-water mark across sessions", () => {
    let store: HistoryStore = { version: 1, days: {} };
    store = upsertToday(store, {
      points: 10, goodSeconds: 60, slouchSeconds: 0, roastCount: 0, bestStreakSeconds: 120,
    });
    store = upsertToday(store, {
      points: 20, goodSeconds: 120, slouchSeconds: 0, roastCount: 0, bestStreakSeconds: 30,
    });
    expect(store.days[todayKey()]!.bestStreakSeconds).toBe(120);
    expect(store.days[todayKey()]!.points).toBe(20);
  });

  it("fills gaps in the 7-day window with empty days", () => {
    const days = recentDays({ version: 1, days: {} }, 7, new Date("2026-03-10T12:00:00"));
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.points === 0)).toBe(true);
    expect(days[6]!.date).toBe("2026-03-10");
  });

  it("counts consecutive days that met the goal", () => {
    const today = new Date("2026-03-10T12:00:00");
    const store: HistoryStore = {
      version: 1,
      days: {
        "2026-03-10": day("2026-03-10", 150),
        "2026-03-09": day("2026-03-09", 150),
        "2026-03-08": day("2026-03-08", 150),
        "2026-03-06": day("2026-03-06", 150), // gap on the 7th breaks it
      },
    };
    expect(dailyStreak(store, 100, today)).toBe(3);
  });

  it("does not break the streak just because today is unfinished", () => {
    const today = new Date("2026-03-10T09:00:00");
    const store: HistoryStore = {
      version: 1,
      days: {
        "2026-03-10": day("2026-03-10", 5), // barely started
        "2026-03-09": day("2026-03-09", 150),
        "2026-03-08": day("2026-03-08", 150),
      },
    };
    expect(dailyStreak(store, 100, today)).toBe(2);
  });
});

describe("posture metrics", () => {
  const kp = (name: string, x: number, y: number, score = 0.9) => ({ name, x, y, score });

  /** Head sits well above the shoulders: upright. */
  const upright = [
    kp("left_shoulder", 220, 300), kp("right_shoulder", 420, 300),
    kp("left_ear", 280, 180), kp("right_ear", 360, 180),
  ];

  /** Same shoulders, head dropped toward them: slouching. */
  const slumped = [
    kp("left_shoulder", 220, 300), kp("right_shoulder", 420, 300),
    kp("left_ear", 280, 265), kp("right_ear", 360, 265),
  ];

  it("scores an upright pose as good", () => {
    const metrics = computeMetrics(upright, T.minKeypointScore);
    expect(metrics).not.toBeNull();
    expect(classifyPosture(metrics, T).state).toBe("good");
  });

  it("scores a dropped head as slouching", () => {
    const metrics = computeMetrics(slumped, T.minKeypointScore);
    expect(metrics!.headHeightRatio).toBeLessThan(
      computeMetrics(upright, T.minKeypointScore)!.headHeightRatio,
    );
    expect(classifyPosture(metrics, T).state).toBe("slouching");
  });

  it("is scale-invariant, so sitting closer to the camera is not a cheat", () => {
    const scaled = upright.map((k) => kp(k.name, k.x * 2, k.y * 2));
    const near = computeMetrics(scaled, T.minKeypointScore)!;
    const far = computeMetrics(upright, T.minKeypointScore)!;
    expect(near.headHeightRatio).toBeCloseTo(far.headHeightRatio, 5);
    expect(near.neckAngleDeg).toBeCloseTo(far.neckAngleDeg, 5);
  });

  it("returns null when keypoints are missing or low confidence", () => {
    expect(computeMetrics([], T.minKeypointScore)).toBeNull();
    const unsure = upright.map((k) => kp(k.name, k.x, k.y, 0.1));
    expect(computeMetrics(unsure, T.minKeypointScore)).toBeNull();
  });

  it("reports unknown rather than guessing when metrics are unavailable", () => {
    expect(classifyPosture(null, T).state).toBe("unknown");
  });

  it("uses a calibrated baseline in preference to the fixed threshold", () => {
    const metrics = computeMetrics(upright, T.minKeypointScore)!;
    // Calibrating while sitting far taller makes the same pose count as a slouch.
    expect(classifyPosture(metrics, T, metrics.headHeightRatio * 1.5).state).toBe("slouching");
    expect(classifyPosture(metrics, T, metrics.headHeightRatio).state).toBe("good");
  });

  it("smooths jitter across frames", () => {
    const frames = [upright, slumped, upright, upright, upright].map(
      (f) => computeMetrics(f, T.minKeypointScore)!,
    );
    const smoothed = smoothMetrics(frames, 5)!;
    const uprightRatio = computeMetrics(upright, T.minKeypointScore)!.headHeightRatio;
    // One bad frame in five pulls the average down but must not flip the verdict.
    expect(smoothed.headHeightRatio).toBeLessThan(uprightRatio);
    expect(classifyPosture(smoothed, T).state).toBe("good");
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "45s"],
    [90, "1m 30s"],
    [3700, "1h 1m"],
  ])("formats %is as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
