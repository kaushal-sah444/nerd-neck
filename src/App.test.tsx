/**
 * Smoke test for the app shell.
 *
 * Renders the full component tree in jsdom with the camera off, which is the
 * state the app starts in. This catches the class of mistake a typecheck cannot:
 * a hook used wrongly, a Recharts prop that throws at mount, a component that
 * blows up on empty history.
 *
 * It deliberately does *not* start the camera — jsdom has no getUserMedia and no
 * WebGL, so pose detection itself can only be verified by a human with a webcam.
 */

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import App from "./App";

beforeAll(() => {
  // Recharts' ResponsiveContainer measures with ResizeObserver, which jsdom
  // does not implement.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("App", () => {
  it("renders with the camera off and no stored history", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /nerd neck/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /start tracking/i })).toBeDefined();
    // Appears twice by design: the status line and the overlay across the video.
    expect(screen.getAllByText(/camera off/i).length).toBeGreaterThan(0);
  });

  it("states the privacy guarantee on screen, not just in the docs", () => {
    render(<App />);
    expect(screen.getByText(/video never leaves this device/i)).toBeDefined();
  });

  it("shows a zeroed scoreboard rather than blank space on first run", () => {
    render(<App />);
    expect(screen.getByText(/points today/i)).toBeDefined();
    expect(screen.getByText(/daily streak/i)).toBeDefined();
    expect(screen.getByText(/last 7 days/i)).toBeDefined();
  });

  it("tells the user roasts are canned when no API key is configured", () => {
    render(<App />);
    expect(screen.getByText(/built-in list/i)).toBeDefined();
  });

  it("keeps calibration disabled until the camera can see you", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: /calibrate/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("restores thresholds from localStorage", () => {
    localStorage.setItem(
      "nerdneck.settings.v1",
      JSON.stringify({ dailyGoalPoints: 250 }),
    );
    render(<App />);
    expect(screen.getByText(/goal 250 pts\/day/i)).toBeDefined();
  });

  it("survives corrupt localStorage instead of white-screening", () => {
    localStorage.setItem("nerdneck.history.v1", "{not json");
    localStorage.setItem("nerdneck.settings.v1", "also not json");
    render(<App />);
    expect(screen.getByRole("heading", { name: /nerd neck/i })).toBeDefined();
  });
});
