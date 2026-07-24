import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { LogsPanel } from "../../panels/LogsPanel";

const mock = vi.mocked(invoke);

describe("LogsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only fake interval APIs so waitFor (which uses setTimeout internally) still works
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mock.mockResolvedValue("nginx started\nlistening on :80");
  });
  afterEach(() => vi.useRealTimers());

  it("fetches logs on mount", async () => {
    render(<LogsPanel containerId="abc" />);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("get_logs", { id: "abc", lines: 100 }));
  });

  it("displays log text", async () => {
    render(<LogsPanel containerId="abc" />);
    await waitFor(() => expect(screen.getByText(/nginx started/)).toBeInTheDocument());
  });

  it("polls when follow is checked", async () => {
    render(<LogsPanel containerId="abc" />);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("checkbox", { name: /follow/i }));
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
  });
});
