/**
 * Points, streaks and history.
 *
 * Deliberately free of React and browser APIs: the session state is advanced by
 * feeding it elapsed time and a posture state, which makes the whole scoring model
 * unit-testable without a webcam. See `postureScoring.test.ts`.
 */

import type { PostureState } from "./poseDetector";
import type { PostureThresholds } from "./config";

export interface SessionState {
  /** Seconds observed in good posture this session. */
  goodSeconds: number;
  /** Seconds observed slouching this session. */
  slouchSeconds: number;
  /** Length of the current unbroken run of good posture, in seconds. */
  currentStreakSeconds: number;
  /** Longest run of good posture this session. */
  bestStreakSeconds: number;
  /** How long the current slouch has lasted, in seconds. Resets on sitting up. */
  currentSlouchSeconds: number;
  /** Times a roast has fired this session. */
  roastCount: number;
  /** Seconds since the last roast, used for the cooldown. */
  secondsSinceRoast: number;
}

export function createSession(): SessionState {
  return {
    goodSeconds: 0,
    slouchSeconds: 0,
    currentStreakSeconds: 0,
    bestStreakSeconds: 0,
    currentSlouchSeconds: 0,
    roastCount: 0,
    secondsSinceRoast: Number.POSITIVE_INFINITY,
  };
}

export interface TickResult {
  session: SessionState;
  /** True on the tick where a slouch crosses the grace period and is off cooldown. */
  shouldRoast: boolean;
}

/**
 * Advance the session by `deltaSeconds` given the posture seen.
 *
 * `unknown` (you left the desk, or the camera lost you) advances neither counter —
 * an empty chair is not good posture, and it is not slouching either.
 */
export function tick(
  session: SessionState,
  state: PostureState,
  deltaSeconds: number,
  thresholds: PostureThresholds,
): TickResult {
  const next: SessionState = { ...session };
  next.secondsSinceRoast += deltaSeconds;

  if (state === "good") {
    next.goodSeconds += deltaSeconds;
    next.currentStreakSeconds += deltaSeconds;
    next.bestStreakSeconds = Math.max(next.bestStreakSeconds, next.currentStreakSeconds);
    next.currentSlouchSeconds = 0;
    return { session: next, shouldRoast: false };
  }

  if (state === "slouching") {
    const wasBelowGrace = session.currentSlouchSeconds < thresholds.slouchGraceSeconds;
    next.slouchSeconds += deltaSeconds;
    next.currentSlouchSeconds += deltaSeconds;
    next.currentStreakSeconds = 0;

    // Fire once, on the tick that crosses the line — not on every tick after it.
    const crossedGrace =
      wasBelowGrace && next.currentSlouchSeconds >= thresholds.slouchGraceSeconds;
    const offCooldown = next.secondsSinceRoast >= thresholds.roastCooldownSeconds;

    if (crossedGrace && offCooldown) {
      next.roastCount += 1;
      next.secondsSinceRoast = 0;
      return { session: next, shouldRoast: true };
    }
    return { session: next, shouldRoast: false };
  }

  return { session: next, shouldRoast: false };
}

/** Points earned from good-posture time. */
export function pointsFor(goodSeconds: number, thresholds: PostureThresholds): number {
  return Math.floor((goodSeconds / 60) * thresholds.pointsPerMinute);
}

/** Share of *judged* time spent sitting well, 0–1. Unknown time is excluded. */
export function postureRatio(session: SessionState): number {
  const judged = session.goodSeconds + session.slouchSeconds;
  return judged === 0 ? 0 : session.goodSeconds / judged;
}

export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
