/**
 * The roast toast.
 *
 * Auto-dismisses, but is also dismissible — a joke you can't get rid of stops
 * being a joke the third time it covers something you're reading.
 */

import { useEffect } from "react";

export interface RoastMessage {
  id: number;
  text: string;
  source: "llm" | "fallback";
}

interface Props {
  roast: RoastMessage | null;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function RoastToast({ roast, onDismiss, autoDismissMs = 8000 }: Props) {
  useEffect(() => {
    if (!roast) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
    // Keyed on id so a new roast restarts the timer rather than inheriting the
    // remaining time from the previous one.
  }, [roast?.id, autoDismissMs, onDismiss, roast]);

  if (!roast) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 w-[min(28rem,90vw)] -translate-x-1/2 animate-[slideUp_180ms_ease-out] rounded-xl border border-rose-500/40 bg-slate-900/95 p-4 shadow-2xl shadow-rose-500/10 backdrop-blur"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">
          🪑
        </span>
        <div className="flex-1">
          <p className="text-slate-100">{roast.text}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
            {roast.source === "llm" ? "freshly generated" : "from the vault"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
