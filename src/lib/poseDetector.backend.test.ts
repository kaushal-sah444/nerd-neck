/**
 * Backend selection.
 *
 * Regression tests for a bug that shipped: `tf.setBackend()` resolves to `false`
 * when a backend cannot start — it does not throw. The original code wrapped it in
 * try/catch, so on a machine without WebGL the CPU fallback never ran and the app
 * died with "Could not initialize any backends, all backend initializations
 * failed" while the camera sat there streaming.
 *
 * TensorFlow is mocked so these run in milliseconds with no GPU and no downloads.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const setBackend = vi.fn<(name: string) => Promise<boolean>>();
const ready = vi.fn(async () => undefined);
const disposeMock = vi.fn();
const createDetectorMock = vi.fn(async () => ({ dispose: disposeMock }));

vi.mock("@tensorflow/tfjs-core", () => ({ setBackend, ready }));
vi.mock("@tensorflow/tfjs-backend-webgl", () => ({}));
vi.mock("@tensorflow/tfjs-backend-cpu", () => ({}));
vi.mock("@tensorflow-models/pose-detection", () => ({
  createDetector: createDetectorMock,
  SupportedModels: { MoveNet: "MoveNet" },
  movenet: { modelType: { SINGLEPOSE_LIGHTNING: "SinglePose.Lightning" } },
}));

const { createDetector } = await import("./poseDetector");

beforeEach(() => {
  setBackend.mockReset();
  ready.mockClear();
  createDetectorMock.mockClear();
});

describe("backend selection", () => {
  it("prefers WebGL when it is available", async () => {
    setBackend.mockResolvedValue(true);

    const { backend } = await createDetector();

    expect(backend).toBe("webgl");
    expect(setBackend).toHaveBeenCalledWith("webgl");
    expect(setBackend).toHaveBeenCalledTimes(1); // no need to try anything else
  });

  it("falls back to CPU when WebGL reports unavailable without throwing", async () => {
    // The exact shape of the shipped bug: a falsy resolve, not a rejection.
    setBackend.mockImplementation(async (name) => name === "cpu");

    const { backend } = await createDetector();

    expect(backend).toBe("cpu");
    expect(setBackend).toHaveBeenCalledWith("webgl");
    expect(setBackend).toHaveBeenCalledWith("cpu");
  });

  it("falls back to CPU when WebGL throws outright", async () => {
    setBackend.mockImplementation(async (name) => {
      if (name === "webgl") throw new Error("WebGL context lost");
      return true;
    });

    expect((await createDetector()).backend).toBe("cpu");
  });

  it("reports something actionable when no backend works at all", async () => {
    setBackend.mockResolvedValue(false);

    await expect(createDetector()).rejects.toThrow(/hardware acceleration/i);
    // The message must name what was tried, not just say it failed.
    await expect(createDetector()).rejects.toThrow(/webgl.*cpu/is);
  });

  it("does not build a detector when no backend came up", async () => {
    setBackend.mockResolvedValue(false);

    await expect(createDetector()).rejects.toThrow();
    expect(createDetectorMock).not.toHaveBeenCalled();
  });

  it("waits for the backend to be ready before creating the detector", async () => {
    const order: string[] = [];
    setBackend.mockImplementation(async () => {
      order.push("setBackend");
      return true;
    });
    ready.mockImplementation(async () => {
      order.push("ready");
    });
    createDetectorMock.mockImplementation(async () => {
      order.push("createDetector");
      return { dispose: disposeMock };
    });

    await createDetector();

    expect(order).toEqual(["setBackend", "ready", "createDetector"]);
  });
});
