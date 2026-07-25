/**
 * Local persistence for daily history and streaks.
 *
 * localStorage rather than IndexedDB on purpose: the entire dataset is a few
 * numbers per day, which is nowhere near needing a transactional database, and a
 * synchronous read keeps the first paint simple. Every access is guarded — Safari
 * private mode and some enterprise policies make localStorage throw on write.
 */

export interface DayRecord {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  points: number;
  goodSeconds: number;
  slouchSeconds: number;
  roastCount: number;
  bestStreakSeconds: number;
}

export interface HistoryStore {
  version: 1;
  days: Record<string, DayRecord>;
  /** Baseline head-height ratio from calibration, if the user has calibrated. */
  baselineRatio?: number;
}

const STORAGE_KEY = "nerdneck.history.v1";

/** Local calendar date. Deliberately not UTC — "today" should mean your today. */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyStore(): HistoryStore {
  return { version: 1, days: {} };
}

export function loadHistory(): HistoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as HistoryStore;
    if (parsed.version !== 1 || typeof parsed.days !== "object") return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

export function saveHistory(store: HistoryStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Out of quota or storage blocked — the session still works, it just won't
    // survive a reload. Not worth interrupting the user over.
  }
}

export function emptyDay(date: string): DayRecord {
  return {
    date,
    points: 0,
    goodSeconds: 0,
    slouchSeconds: 0,
    roastCount: 0,
    bestStreakSeconds: 0,
  };
}

/** Write today's totals into the store, returning the updated copy. */
export function upsertToday(store: HistoryStore, day: Omit<DayRecord, "date">): HistoryStore {
  const date = todayKey();
  const existing = store.days[date] ?? emptyDay(date);
  return {
    ...store,
    days: {
      ...store.days,
      [date]: {
        ...existing,
        ...day,
        date,
        // Best streak is a high-water mark across every session in the day.
        bestStreakSeconds: Math.max(existing.bestStreakSeconds, day.bestStreakSeconds),
      },
    },
  };
}

/** The last `days` calendar days, oldest first, with gaps filled by empty records. */
export function recentDays(store: HistoryStore, days = 7, today = new Date()): DayRecord[] {
  const out: DayRecord[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    out.push(store.days[key] ?? emptyDay(key));
  }
  return out;
}

/**
 * Consecutive days up to today meeting the points goal.
 *
 * Today not yet meeting the goal does not break the streak — it just hasn't been
 * added to it, so the number doesn't flicker to 0 every morning.
 */
export function dailyStreak(
  store: HistoryStore,
  goalPoints: number,
  today = new Date(),
): number {
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const record = store.days[todayKey(d)];
    const met = (record?.points ?? 0) >= goalPoints;

    if (met) {
      streak += 1;
      continue;
    }
    if (i === 0) continue; // today is still in progress
    break;
  }
  return streak;
}
