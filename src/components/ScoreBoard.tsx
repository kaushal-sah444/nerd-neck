/**
 * Dashboard: today's score, streaks, live metrics and a 7-day history chart.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DayRecord } from "../lib/storage";
import type { SessionState } from "../lib/postureScoring";
import { formatDuration, postureRatio } from "../lib/postureScoring";
import type { PostureMetrics, PostureState } from "../lib/poseDetector";

interface Props {
  todayPoints: number;
  dailyStreak: number;
  session: SessionState;
  history: DayRecord[];
  state: PostureState;
  metrics: PostureMetrics | null;
  reason: string;
  goalPoints: number;
}

const STATE_STYLES: Record<PostureState, { label: string; className: string }> = {
  good: { label: "Sitting tall", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  slouching: { label: "Slouching", className: "bg-rose-500/15 text-rose-300 border-rose-500/40" },
  unknown: { label: "Can't see you", className: "bg-slate-500/15 text-slate-300 border-slate-500/40" },
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-50">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function ScoreBoard({
  todayPoints,
  dailyStreak,
  session,
  history,
  state,
  metrics,
  reason,
  goalPoints,
}: Props) {
  const style = STATE_STYLES[state];
  const ratio = Math.round(postureRatio(session) * 100);
  const goalPct = Math.min(100, Math.round((todayPoints / goalPoints) * 100));

  const chartData = history.map((day) => ({
    // "Mon", "Tue", … Parsed as local time by appending a clock value, so the
    // label doesn't slip a day for anyone west of UTC.
    day: new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" }),
    points: day.points,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`flex items-center justify-between rounded-xl border px-4 py-3 ${style.className}`}
        role="status"
        aria-live="polite"
      >
        <span className="font-semibold">{style.label}</span>
        <span className="text-sm opacity-80">{reason}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Points today" value={String(todayPoints)} sub={`${goalPct}% of goal`} />
        <Stat label="Daily streak" value={`${dailyStreak}d`} sub={`goal ${goalPoints} pts/day`} />
        <Stat
          label="Current streak"
          value={formatDuration(session.currentStreakSeconds)}
          sub={`best ${formatDuration(session.bestStreakSeconds)}`}
        />
        <Stat label="Good posture" value={`${ratio}%`} sub={`${session.roastCount} roasts`} />
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Last 7 days</h2>
          <span className="text-xs text-slate-400">points per day</span>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(51 65 85)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: "rgb(148 163 184)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "rgb(148 163 184)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "rgb(51 65 85 / 0.4)" }}
                contentStyle={{
                  background: "rgb(15 23 42)",
                  border: "1px solid rgb(51 65 85)",
                  borderRadius: "0.5rem",
                  color: "rgb(226 232 240)",
                }}
              />
              <Bar dataKey="points" fill="rgb(56 189 248)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {metrics && (
        <dl className="grid grid-cols-3 gap-3 text-center text-xs text-slate-400">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
            <dt>Neck angle</dt>
            <dd className="text-base text-slate-200">{metrics.neckAngleDeg.toFixed(1)}°</dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
            <dt>Head height</dt>
            <dd className="text-base text-slate-200">{metrics.headHeightRatio.toFixed(2)}</dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
            <dt>Shoulder tilt</dt>
            <dd className="text-base text-slate-200">{metrics.shoulderTiltDeg.toFixed(1)}°</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
