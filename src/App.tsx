/**
 * App shell: owns session state, persistence and the roast trigger.
 *
 * The scoring clock is driven by wall time rather than by frame count, so a
 * backgrounded tab (where browsers throttle timers) cannot silently inflate your
 * score. Each tick measures the real elapsed interval.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WebcamFeed, type CameraStatus } from "./components/WebcamFeed";
import { ScoreBoard } from "./components/ScoreBoard";
import { RoastToast, type RoastMessage } from "./components/RoastToast";
import {
  DEFAULT_THRESHOLDS,
  loadThresholds,
  saveThresholds,
  type PostureThresholds,
} from "./lib/config";
import type { Backend, PostureReading } from "./lib/poseDetector";
import {
  createSession,
  pointsFor,
  tick,
  type SessionState,
} from "./lib/postureScoring";
import {
  dailyStreak,
  loadHistory,
  recentDays,
  saveHistory,
  upsertToday,
  type HistoryStore,
} from "./lib/storage";
import { configuredProvider, generateRoast } from "./lib/roastGenerator";

const STATUS_COPY: Record<CameraStatus, string> = {
  idle: "Camera off",
  starting: "Starting camera and loading the pose model…",
  running: "Tracking",
  denied: "Camera permission denied. Allow it in your browser's site settings and reload.",
  error: "Camera error",
};

export default function App() {
  const [thresholds, setThresholds] = useState<PostureThresholds>(() => loadThresholds());
  const [history, setHistory] = useState<HistoryStore>(() => loadHistory());
  const [session, setSession] = useState<SessionState>(() => createSession());
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string>();
  const [roast, setRoast] = useState<RoastMessage | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [backend, setBackend] = useState<Backend | null>(null);

  const readingRef = useRef<PostureReading>({
    state: "unknown",
    metrics: null,
    keypoints: [],
    reason: "Camera off",
  });
  const [reading, setReading] = useState<PostureReading>(readingRef.current);
  const recentRoastsRef = useRef<string[]>([]);
  const roastIdRef = useRef(0);

  const handleReading = useCallback((next: PostureReading) => {
    readingRef.current = next;
    setReading(next);
  }, []);

  const handleStatus = useCallback((next: CameraStatus, detail?: string) => {
    setStatus(next);
    setStatusDetail(detail);
    // A failed start leaves the toggle stuck reading "Stop" over a dead camera.
    if (next === "denied" || next === "error") setActive(false);
  }, []);

  const handleBackend = useCallback((next: Backend | null) => setBackend(next), []);

  // The scoring clock. One interval, driven by measured elapsed time.
  useEffect(() => {
    if (!active) return;
    let last = performance.now();

    const id = setInterval(() => {
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;

      // A tab restored after being backgrounded reports a huge delta. Clamp it:
      // we have no evidence about posture during that gap.
      const bounded = Math.min(delta, 2);

      setSession((prev) => {
        const { session: next, shouldRoast } = tick(
          prev,
          readingRef.current.state,
          bounded,
          thresholds,
        );
        if (shouldRoast) void fireRoast(next.currentSlouchSeconds);
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, thresholds]);

  const fireRoast = useCallback(
    async (slouchSeconds: number) => {
      const result = await generateRoast({
        slouchSeconds,
        neckAngleDeg: readingRef.current.metrics?.neckAngleDeg ?? 0,
        recent: recentRoastsRef.current,
      });
      recentRoastsRef.current = [...recentRoastsRef.current.slice(-9), result.text];
      roastIdRef.current += 1;
      setRoast({ id: roastIdRef.current, text: result.text, source: result.source });
    },
    [],
  );

  const todayPoints = pointsFor(session.goodSeconds, thresholds);

  // Persist on a timer rather than on every tick: localStorage writes are
  // synchronous and there is no reason to touch disk once a second.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setHistory((prev) => {
        const next = upsertToday(prev, {
          points: pointsFor(session.goodSeconds, thresholds),
          goodSeconds: session.goodSeconds,
          slouchSeconds: session.slouchSeconds,
          roastCount: session.roastCount,
          bestStreakSeconds: session.bestStreakSeconds,
        });
        saveHistory(next);
        return next;
      });
    }, 10_000);
    return () => clearInterval(id);
  }, [active, session, thresholds]);

  const calibrate = useCallback(() => {
    const ratio = readingRef.current.metrics?.headHeightRatio;
    if (ratio === undefined) return;
    setHistory((prev) => {
      const next = { ...prev, baselineRatio: ratio };
      saveHistory(next);
      return next;
    });
  }, []);

  const updateThreshold = useCallback(
    <K extends keyof PostureThresholds>(key: K, value: PostureThresholds[K]) => {
      setThresholds((prev) => {
        const next = { ...prev, [key]: value };
        saveThresholds(next);
        return next;
      });
    },
    [],
  );

  const days = useMemo(() => recentDays(history, 7), [history]);
  const streak = useMemo(
    () => dailyStreak(history, thresholds.dailyGoalPoints),
    [history, thresholds.dailyGoalPoints],
  );
  const provider = configuredProvider();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Nerd Neck <span aria-hidden="true">🦴</span>
            </h1>
            <p className="text-sm text-slate-400">
              Posture tracking that runs entirely in your browser. Video never leaves
              this device.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActive((a) => !a)}
              className={`rounded-lg px-4 py-2 font-medium transition ${
                active
                  ? "bg-rose-500/90 text-white hover:bg-rose-500"
                  : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
              }`}
            >
              {active ? "Stop" : "Start tracking"}
            </button>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              className="rounded-lg border border-slate-700 px-3 py-2 text-slate-300 transition hover:bg-slate-800"
              aria-expanded={showSettings}
            >
              Settings
            </button>
          </div>
        </header>

        {status === "error" || status === "denied" ? (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold text-amber-200">
              {status === "denied" ? "Camera blocked" : "Could not start pose detection"}
            </p>
            <p className="mt-1 text-amber-100/80">{statusDetail}</p>
            {status === "error" && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/70">
                <li>
                  Turn on hardware acceleration (Chrome: Settings → System) and
                  restart the browser.
                </li>
                <li>Check that WebGL works at <code>chrome://gpu</code>.</li>
                <li>Or try another browser — Firefox and Edge fall back differently.</li>
              </ul>
            )}
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-400">
            {STATUS_COPY[status]}
            {backend && (
              <span className="ml-2 text-slate-500">
                on {backend.toUpperCase()}
                {backend === "cpu" && " — no WebGL, so this will be slow"}
              </span>
            )}
            {provider === "none" && (
              <span className="ml-2 text-slate-500">
                (roasts from the built-in list — set an API key for fresh ones)
              </span>
            )}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <WebcamFeed
              thresholds={thresholds}
              baselineRatio={history.baselineRatio}
              active={active}
              onReading={handleReading}
              onStatusChange={handleStatus}
              onBackend={handleBackend}
            />
            <button
              type="button"
              onClick={calibrate}
              disabled={!active || reading.metrics === null}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition enabled:hover:bg-slate-800 disabled:opacity-40"
            >
              Sit up straight, then calibrate
              {history.baselineRatio !== undefined && (
                <span className="ml-2 text-cyan-400">
                  (calibrated at {history.baselineRatio.toFixed(2)})
                </span>
              )}
            </button>
          </div>

          <ScoreBoard
            todayPoints={todayPoints}
            dailyStreak={streak}
            session={session}
            history={days}
            state={reading.state}
            metrics={reading.metrics}
            reason={reading.reason}
            goalPoints={thresholds.dailyGoalPoints}
          />
        </div>

        {showSettings && (
          <section className="mt-6 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Thresholds</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Slider
                label="Slouch angle"
                unit="°"
                min={10}
                max={45}
                value={thresholds.slouchAngleDeg}
                onChange={(v) => updateThreshold("slouchAngleDeg", v)}
                hint="Higher = more forgiving"
              />
              <Slider
                label="Grace period"
                unit="s"
                min={3}
                max={60}
                value={thresholds.slouchGraceSeconds}
                onChange={(v) => updateThreshold("slouchGraceSeconds", v)}
                hint="Slouch this long before a roast"
              />
              <Slider
                label="Roast cooldown"
                unit="s"
                min={15}
                max={600}
                step={15}
                value={thresholds.roastCooldownSeconds}
                onChange={(v) => updateThreshold("roastCooldownSeconds", v)}
                hint="Minimum gap between roasts"
              />
              <Slider
                label="Points per minute"
                unit=""
                min={1}
                max={60}
                value={thresholds.pointsPerMinute}
                onChange={(v) => updateThreshold("pointsPerMinute", v)}
              />
              <Slider
                label="Daily goal"
                unit=" pts"
                min={10}
                max={1000}
                step={10}
                value={thresholds.dailyGoalPoints}
                onChange={(v) => updateThreshold("dailyGoalPoints", v)}
              />
              <Slider
                label="Detection rate"
                unit=" fps"
                min={2}
                max={30}
                value={thresholds.targetFps}
                onChange={(v) => updateThreshold("targetFps", v)}
                hint="Lower saves battery"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setThresholds({ ...DEFAULT_THRESHOLDS });
                saveThresholds({ ...DEFAULT_THRESHOLDS });
              }}
              className="mt-4 text-xs text-slate-400 underline hover:text-slate-200"
            >
              Reset to defaults
            </button>
          </section>
        )}
      </div>

      <RoastToast roast={roast} onDismiss={() => setRoast(null)} />
    </div>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  step = 1,
  value,
  onChange,
  hint,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between text-slate-300">
        {label}
        <span className="text-slate-400">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-cyan-400"
      />
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
