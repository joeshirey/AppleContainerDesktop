import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useContainers } from "../../hooks/useContainers";

const mock = vi.mocked(invoke);

describe("useContainers", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("fetches on mount", async () => {
    mock.mockResolvedValue([{ id: "a", name: "nginx", image: "nginx:latest", status: "running" }]);
    const { result } = renderHook(() => useContainers());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.containers).toHaveLength(1);
  });

  it("polls every 5s", async () => {
    mock.mockResolvedValue([]);
    renderHook(() => useContainers());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("sets error on failure", async () => {
    mock.mockRejectedValue(new Error("CLI not found"));
    const { result } = renderHook(() => useContainers());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBeTruthy();
    expect(typeof result.current.error).toBe("string");
  });

  it("refresh() re-fetches immediately", async () => {
    mock.mockResolvedValue([]);
    const { result } = renderHook(() => useContainers());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mock).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
