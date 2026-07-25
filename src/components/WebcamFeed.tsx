/**
 * Webcam capture plus the pose-detection loop.
 *
 * Owns the `<video>` element and the inference interval; reports readings upward.
 * The stream is torn down on unmount so the camera light actually goes out.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type * as poseDetection from "@tensorflow-models/pose-detection";

import {
  classifyPosture,
  computeMetrics,
  createDetector,
  smoothMetrics,
  type Backend,
  type PostureMetrics,
  type PostureReading,
} from "../lib/poseDetector";
import type { PostureThresholds } from "../lib/config";
import { PostureOverlay } from "./PostureOverlay";

export type CameraStatus = "idle" | "starting" | "running" | "denied" | "error";

interface Props {
  thresholds: PostureThresholds;
  baselineRatio?: number;
  active: boolean;
  onReading: (reading: PostureReading) => void;
  onStatusChange: (status: CameraStatus, detail?: string) => void;
  onBackend: (backend: Backend | null) => void;
}

export function WebcamFeed({
  thresholds,
  baselineRatio,
  active,
  onReading,
  onStatusChange,
  onBackend,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const historyRef = useRef<PostureMetrics[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastInferenceRef = useRef(0);

  // Kept in refs so the animation loop reads current values without being
  // re-created (and thus restarting the camera) on every prop change.
  const thresholdsRef = useRef(thresholds);
  const baselineRef = useRef(baselineRatio);
  const onReadingRef = useRef(onReading);
  thresholdsRef.current = thresholds;
  baselineRef.current = baselineRatio;
  onReadingRef.current = onReading;

  const [keypoints, setKeypoints] = useState<poseDetection.Keypoint[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });

  const detect = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;

    if (!video || !detector || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(() => void detect());
      return;
    }

    // Throttle to the configured fps: MoveNet can run far faster than we need,
    // and there is no point burning battery to measure posture 60 times a second.
    const now = performance.now();
    const interval = 1000 / thresholdsRef.current.targetFps;
    if (now - lastInferenceRef.current < interval) {
      rafRef.current = requestAnimationFrame(() => void detect());
      return;
    }
    lastInferenceRef.current = now;

    try {
      const poses = await detector.estimatePoses(video, { flipHorizontal: false });
      const points = poses[0]?.keypoints ?? [];
      setKeypoints(points);

      const raw = computeMetrics(points, thresholdsRef.current.minKeypointScore);
      if (raw) {
        historyRef.current = [...historyRef.current.slice(-9), raw];
      } else {
        historyRef.current = [];
      }

      const smoothed = smoothMetrics(historyRef.current);
      const { state, reason } = classifyPosture(
        smoothed,
        thresholdsRef.current,
        baselineRef.current,
      );
      onReadingRef.current({ state, metrics: smoothed, keypoints: points, reason });
    } catch (error) {
      if (import.meta.env.DEV) console.warn("Pose estimation failed:", error);
    }

    rafRef.current = requestAnimationFrame(() => void detect());
  }, []);

  useEffect(() => {
    if (!active) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      onStatusChange("starting");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setVideoSize({
          width: video.videoWidth || 640,
          height: video.videoHeight || 480,
        });

        const { detector, backend } = await createDetector();
        if (cancelled) {
          detector.dispose();
          return;
        }
        detectorRef.current = detector;
        onBackend(backend);

        onStatusChange("running");
        rafRef.current = requestAnimationFrame(() => void detect());
      } catch (error) {
        if (cancelled) return;
        const err = error as DOMException;

        // Release the camera. Otherwise the feed keeps streaming behind an error
        // message, the indicator light stays on, and the UI contradicts itself.
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        onBackend(null);

        if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
          onStatusChange("denied", "Camera permission was denied.");
        } else {
          onStatusChange("error", err?.message ?? String(error));
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // Stopping every track is what turns the camera indicator off.
      stream?.getTracks().forEach((track) => track.stop());
      detectorRef.current?.dispose();
      detectorRef.current = null;
      historyRef.current = [];
      onBackend(null);
    };
  }, [active, detect, onStatusChange, onBackend]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
      <video
        ref={videoRef}
        playsInline
        muted
        // Mirrored so moving left on screen matches moving left in the room.
        className="w-full -scale-x-100"
      />
      <PostureOverlay
        keypoints={keypoints}
        width={videoSize.width}
        height={videoSize.height}
        minScore={thresholds.minKeypointScore}
      />
      {!active && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/90 text-slate-400">
          Camera off
        </div>
      )}
    </div>
  );
}
