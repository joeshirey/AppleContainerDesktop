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
    render(<LogsPanel source={{ kind: "container", id: "abc" }} />);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("get_logs", { id: "abc", lines: 100 }));
  });

  it("displays log text", async () => {
    render(<LogsPanel source={{ kind: "container", id: "abc" }} />);
    await waitFor(() => expect(screen.getByText(/nginx started/)).toBeInTheDocument());
  });

  it("polls when follow is checked", async () => {
    render(<LogsPanel source={{ kind: "container", id: "abc" }} />);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("checkbox", { name: /follow/i }));
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
  });

  it("reads a machine's stdio log by default", async () => {
    render(<LogsPanel source={{ kind: "machine", name: "gui-dev" }} />);
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith("get_machine_logs", { name: "gui-dev", lines: 100, boot: false })
    );
  });

  it("offers the boot log for a machine and refetches when it is picked", async () => {
    render(<LogsPanel source={{ kind: "machine", name: "gui-dev" }} />);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("checkbox", { name: /boot log/i }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith("get_machine_logs", { name: "gui-dev", lines: 100, boot: true })
    );
  });

  // A container has no boot log, so the toggle would do nothing there.
  it("does not offer a boot log for a container", async () => {
    render(<LogsPanel source={{ kind: "container", id: "abc" }} />);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox", { name: /boot log/i })).not.toBeInTheDocument();
  });
});
