import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Only the three system calls are stubbed. Everything else in `api` goes
// through the globally mocked `invoke`, which resolves to undefined — enough
// for the views to render empty while these tests exercise the banner.
vi.mock("../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../api")>()),
  checkSystemStatus: vi.fn(),
  startSystem: vi.fn(),
  stopSystem: vi.fn(),
}));

import { checkSystemStatus, startSystem, stopSystem } from "../api";

const mockStatus = vi.mocked(checkSystemStatus);
const mockStart = vi.mocked(startSystem);
const mockStop = vi.mocked(stopSystem);

describe("App system banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus.mockResolvedValue({ status: "running" });
    mockStart.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
  });

  it("claims nothing about the system until the status check resolves", async () => {
    mockStatus.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText(/checking container system/i)).toBeInTheDocument();
    expect(screen.queryByText(/container system is running/i)).not.toBeInTheDocument();
  });

  it("reports a running system", async () => {
    render(<App />);
    expect(await screen.findByText(/container system is running/i)).toBeInTheDocument();
  });

  // The status call succeeds on a stopped system too — it returns a payload
  // saying so. Treating "the call resolved" as "the system is up" reports a
  // stopped system as running.
  it("reports a stopped system when the status says it is not running", async () => {
    mockStatus.mockResolvedValue({ status: "stopped" });
    render(<App />);
    expect(await screen.findByText(/container system is not running/i)).toBeInTheDocument();
  });

  it("treats a failed status check as a stopped system", async () => {
    mockStatus.mockRejectedValue("connection refused");
    render(<App />);
    expect(await screen.findByText(/container system is not running/i)).toBeInTheDocument();
  });

  it("surfaces the reason when starting the system fails", async () => {
    mockStatus.mockResolvedValue({ status: "stopped" });
    mockStart.mockRejectedValue("launchd refused to load the service");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Start Containers" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "launchd refused to load the service",
    );
    // Still stopped — a failed start must not flip the banner to running.
    expect(screen.getByText(/container system is not running/i)).toBeInTheDocument();
  });

  it("surfaces the reason when stopping the system fails", async () => {
    mockStop.mockRejectedValue("a container is still running");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Stop Containers" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("a container is still running");
    expect(screen.getByText(/container system is running/i)).toBeInTheDocument();
  });

  it("clears the error once a retry succeeds", async () => {
    mockStatus.mockResolvedValue({ status: "stopped" });
    mockStart.mockRejectedValueOnce("launchd refused to load the service");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Start Containers" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start Containers" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText(/container system is running/i)).toBeInTheDocument();
  });
});
