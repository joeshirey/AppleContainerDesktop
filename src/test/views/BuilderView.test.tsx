import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuilderView } from "../../views/BuilderView";
import { builderStatus, builderStart, builderStop, builderDelete } from "../../api";

vi.mock("../../api", () => ({
  builderStatus: vi.fn(),
  builderStart: vi.fn(),
  builderStop: vi.fn(),
  builderDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(builderStart).mockResolvedValue(undefined);
  vi.mocked(builderStop).mockResolvedValue(undefined);
  vi.mocked(builderDelete).mockResolvedValue(undefined);
});

const ABSENT = { exists: false, running: false, cpus: null, memoryMb: null, raw: "" };
const STOPPED = { exists: true, running: false, cpus: 2, memoryMb: 2048, raw: "stopped" };
const RUNNING = { exists: true, running: true, cpus: 2, memoryMb: 2048, raw: "running" };

describe("BuilderView", () => {
  // A machine that has never built anything has no builder container. Delete
  // must not be offered for something that is not there.
  it("offers only Start when no builder exists yet", async () => {
    vi.mocked(builderStatus).mockResolvedValue(ABSENT);
    render(<BuilderView />);
    expect(await screen.findByText("Not created")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    // cpus and memoryMb are null — no allocation span should appear.
    expect(screen.queryByText(/null CPUs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/null MB/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(builderStart).toHaveBeenCalled());
  });

  // A stopped builder still exists, so it can be deleted and it still knows
  // what it was allocated.
  it("offers Start and Delete when the builder is stopped", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    render(<BuilderView />);
    expect(await screen.findByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("2 CPUs · 2048 MB")).toBeInTheDocument();
    // The raw "stopped" string must not appear as a separate span — "Stopped"
    // is the recognised label and suppresses the raw display.
    expect(screen.queryByText("stopped")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(builderStart).toHaveBeenCalled());
  });

  it("forwards cpus and memory when starting", async () => {
    vi.mocked(builderStatus).mockResolvedValue(ABSENT);
    render(<BuilderView />);
    await userEvent.type(await screen.findByLabelText("CPUs"), "4");
    await userEvent.type(screen.getByLabelText("Memory"), "8G");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(builderStart).toHaveBeenCalledWith(4, "8G"));
  });

  // Delete is absent here on purpose: the CLI refuses to delete a running
  // builder without --force, and the confirm gives no warning that it would
  // kill a live VM. Stop first.
  it("offers Stop but not Delete when the builder is running", async () => {
    vi.mocked(builderStatus).mockResolvedValue(RUNNING);
    render(<BuilderView />);
    expect(await screen.findByText("Running")).toBeInTheDocument();
    // The raw "running" string must not appear as a separate span — "Running"
    // is the recognised label and suppresses the raw display.
    expect(screen.queryByText("running")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(builderStop).toHaveBeenCalled());
  });

  // Same inline confirm the Images and Volumes views use for destructive
  // actions, rather than a dialog this app does not otherwise have.
  it("confirms before deleting", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    render(<BuilderView />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(builderDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));
    await waitFor(() => expect(builderDelete).toHaveBeenCalled());
  });

  // A state this build does not know about must not be silently presented as
  // "Stopped" with nothing else said.
  it("shows what the CLI said when the status is unrecognised", async () => {
    vi.mocked(builderStatus).mockResolvedValue({ ...STOPPED, raw: "restarting" });
    render(<BuilderView />);
    expect(await screen.findByText("restarting")).toBeInTheDocument();
  });

  it("surfaces an error from the CLI", async () => {
    vi.mocked(builderStatus).mockRejectedValue(new Error("container not found"));
    render(<BuilderView />);
    expect(await screen.findByText("container not found")).toBeInTheDocument();
  });
});
