/**
 * Skeleton overlay drawn on top of the video.
 *
 * SVG rather than a canvas: a handful of points and lines per frame is nothing for
 * the DOM, and it scales with the container for free via `viewBox`.
 */

import type { Keypoint } from "@tensorflow-models/pose-detection";

/** Upper-body connections only — legs are off-camera at a desk. */
const SKELETON: ReadonlyArray<[string, string]> = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["right_shoulder", "right_elbow"],
  ["left_ear", "left_shoulder"],
  ["right_ear", "right_shoulder"],
  ["left_ear", "right_ear"],
  ["nose", "left_eye"],
  ["nose", "right_eye"],
];

const HIGHLIGHTED = new Set(["left_shoulder", "right_shoulder", "left_ear", "right_ear"]);

interface Props {
  keypoints: Keypoint[];
  width: number;
  height: number;
  minScore: number;
}

export function PostureOverlay({ keypoints, width, height, minScore }: Props) {
  if (keypoints.length === 0) return null;

  const byName = new Map(keypoints.map((k) => [k.name ?? "", k]));
  const visible = (k?: Keypoint) => k && (k.score ?? 0) >= minScore;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      // Matches the mirrored video so the skeleton lands on the body.
      className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100"
      aria-hidden="true"
    >
      {SKELETON.map(([from, to]) => {
        const a = byName.get(from);
        const b = byName.get(to);
        if (!visible(a) || !visible(b)) return null;
        return (
          <line
            key={`${from}-${to}`}
            x1={a!.x}
            y1={a!.y}
            x2={b!.x}
            y2={b!.y}
            stroke="rgb(56 189 248 / 0.75)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      })}
      {keypoints.map((k) =>
        visible(k) ? (
          <circle
            key={k.name ?? `${k.x},${k.y}`}
            cx={k.x}
            cy={k.y}
            r={HIGHLIGHTED.has(k.name ?? "") ? 6 : 3.5}
            fill={HIGHLIGHTED.has(k.name ?? "") ? "rgb(34 211 238)" : "rgb(148 163 184 / 0.8)"}
          />
        ) : null,
      )}
    </svg>
  );
}
