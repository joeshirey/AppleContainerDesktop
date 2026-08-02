import { describe, it, expect, vi, beforeEach } from "vitest";
import { act as reactAct, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuilderView } from "../../views/BuilderView";
import { builderStatus, builderStart, builderStop, builderDelete } from "../../api";
import { IDLE_BUILD } from "../../hooks/useBuild";
import type { BuilderState, BuildState } from "../../types";

vi.mock("../../api", () => ({
  builderStatus: vi.fn(),
  builderStart: vi.fn(),
  builderStop: vi.fn(),
  builderDelete: vi.fn(),
  // Unused by this view, but the real `useBuild` imports it and this factory
  // replaces the whole module.
  getBuildState: vi.fn(),
}));

vi.mock("../../hooks/useBuild", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/useBuild")>("../../hooks/useBuild");
  return { ...actual, useBuild: () => ({ build: mockBuild, refresh: vi.fn() }) };
});

let mockBuild: BuildState = IDLE_BUILD;

beforeEach(() => {
  vi.clearAllMocks();
  mockBuild = IDLE_BUILD;
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

  // M11: act must call refresh after a successful action so the view does not
  // stay stuck on the pre-action state.
  it("updates the state after an action completes", async () => {
    vi.mocked(builderStatus)
      .mockResolvedValueOnce(STOPPED)
      .mockResolvedValue(RUNNING);
    render(<BuilderView />);
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText("Running")).toBeInTheDocument();
  });

  // M12: finally must clear confirmDelete so the prompt does not stay open
  // after a failed delete. The user needs the Delete button back to retry.
  it("resets the delete confirm after a failed delete", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    vi.mocked(builderDelete).mockRejectedValue(new Error("cannot delete"));
    render(<BuilderView />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  // M13: StatusDot status prop is driven by the running flag, not hardcoded.
  // A stopped builder must display the stopped colour (#8e8e93), not the green
  // running colour.
  it("shows a stopped colour on the status dot when the builder is stopped", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    render(<BuilderView />);
    await screen.findByText("Stopped");
    const dot = screen.getByTestId("dot");
    expect(dot).toHaveStyle({ background: "#8e8e93" });
  });

  // Fix A: the CPUs validation error lives in its own state slot so that a
  // status refresh landing while the invalid value is still in the box cannot
  // wipe the message. Before the split, refresh's setError(null) cleared it.
  it("keeps the validation error visible when a status refresh lands", async () => {
    let resolveStatus!: (s: BuilderState) => void;
    vi.mocked(builderStatus).mockReturnValue(
      new Promise<BuilderState>(r => { resolveStatus = r; }),
    );
    render(<BuilderView />);
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("CPUs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    // The pending mount refresh now lands — must not wipe the validation error.
    await reactAct(async () => { resolveStatus(ABSENT); });
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    expect(builderStart).not.toHaveBeenCalled();
  });

  // Fix A: act() must clear cpuError so the validation message does not linger
  // when the user starts a different action (e.g. Delete) without first editing
  // the CPUs field. The onChange clear covers the "edit and retry" path; act()
  // covers the "abandon and do something else" path.
  it("clears the validation error when any action starts", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    render(<BuilderView />);
    await screen.findByText("Stopped");
    // Type an invalid CPUs value → validation error appears.
    await userEvent.type(screen.getByLabelText("CPUs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    // Now start a delete flow — act() must clear the validation error
    // even though the CPUs field was never edited.
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));
    await waitFor(() =>
      expect(screen.queryByText(/whole number of 1 or more/i)).not.toBeInTheDocument(),
    );
  });

  // Fix A: editing the CPUs field clears the validation error so the message
  // does not linger after the user has already started correcting the value.
  it("clears the validation error when the CPUs field is edited", async () => {
    vi.mocked(builderStatus).mockResolvedValue(ABSENT);
    render(<BuilderView />);
    await userEvent.type(await screen.findByLabelText("CPUs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    // Clearing the field must dismiss the validation error.
    await userEvent.clear(screen.getByLabelText("CPUs"));
    expect(screen.queryByText(/whole number of 1 or more/i)).not.toBeInTheDocument();
  });

  // Item 1: handleStart must call setError(null) in the validation path.
  // Without it, a stale CLI error lurks under the validation message and
  // resurfaces when the user later clears the CPUs field (which clears cpuError
  // via onChange but leaves error untouched).
  it("does not resurrect a stale CLI error when the CPUs validation is cleared", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    vi.mocked(builderStart).mockRejectedValue(new Error("insufficient memory"));
    render(<BuilderView />);
    await screen.findByText("Stopped");
    // First Start fails → CLI error set.
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("insufficient memory")).toBeInTheDocument();
    // Type invalid CPUs → validation error replaces CLI error; error cleared.
    await userEvent.type(screen.getByLabelText("CPUs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    // Clearing the field removes the validation message. The stale CLI error
    // must not reappear — clicking Start was a new attempt.
    await userEvent.clear(screen.getByLabelText("CPUs"));
    expect(screen.queryByText("insufficient memory")).not.toBeInTheDocument();
    expect(screen.queryByText(/whole number of 1 or more/i)).not.toBeInTheDocument();
  });

  // Item 2: cpuError must be tied to the CPUs field's visibility. Once the
  // builder is running the field unmounts; the banner must follow it.
  it("hides the validation error when the builder starts running and the CPUs field unmounts", async () => {
    let resolveStatus!: (s: BuilderState) => void;
    vi.mocked(builderStatus).mockReturnValue(
      new Promise<BuilderState>(r => { resolveStatus = r; }),
    );
    render(<BuilderView />);
    // During "Checking…" the field is visible because running defaults false.
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("CPUs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    // Status resolves as Running → field unmounts; banner must clear.
    await reactAct(async () => { resolveStatus(RUNNING); });
    expect(screen.queryByText(/whole number of 1 or more/i)).not.toBeInTheDocument();
  });

  // C3: cpuError must win over error when both are set. The mount refresh can
  // fail while cpuError is set (status lands after the validation branch runs),
  // putting both slots in a non-null state simultaneously.
  it("shows the validation error over a CLI error when both are set", async () => {
    let rejectStatus!: (e: Error) => void;
    vi.mocked(builderStatus).mockReturnValue(
      new Promise<BuilderState>((_, reject) => { rejectStatus = reject; }),
    );
    render(<BuilderView />);
    // During "Checking…" type invalid CPUs and click Start.
    // handleStart calls setError(null) then sets cpuError.
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("CPUs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    // The pending mount refresh now rejects — both cpuError and error are set.
    await reactAct(async () => { rejectStatus(new Error("status timeout")); });
    // Validation message must win; the CLI error must not surface.
    expect(screen.getByText(/whole number of 1 or more/i)).toBeInTheDocument();
    expect(screen.queryByText("status timeout")).not.toBeInTheDocument();
  });

  // M16 + M17: blank cpus must become undefined (not 0), blank memory must
  // become undefined (not ""), so the CLI uses its own defaults.
  it("passes undefined for both args when cpus and memory are blank", async () => {
    vi.mocked(builderStatus).mockResolvedValue(ABSENT);
    render(<BuilderView />);
    await screen.findByText("Not created");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(builderStart).toHaveBeenCalledWith(undefined, undefined),
    );
  });

  // M18: exists must default false during the loading window, not true. A true
  // default would show a Delete button for a builder that may not exist.
  it("does not show Delete during the initial status check", async () => {
    vi.mocked(builderStatus).mockReturnValue(new Promise<BuilderState>(() => {}));
    render(<BuilderView />);
    // Anchor: confirm we are in the loading window before the negative check.
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  // M19: running must default false during loading. A true default would show
  // Stop and hide the CPUs / Memory inputs before the status is known.
  it("shows Start not Stop during the initial status check", async () => {
    vi.mocked(builderStatus).mockReturnValue(new Promise<BuilderState>(() => {}));
    render(<BuilderView />);
    // Anchor: confirm we are in the loading window before the negative check.
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  // M20: the Cancel button in the delete confirm must call setConfirmDelete(false)
  // so the Delete button comes back. Without this the user has no way to exit.
  it("shows Delete again after cancelling the confirm", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    render(<BuilderView />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  // M21: act must call setError(null) before the async action so a previous
  // error is cleared immediately, not left visible while the action runs.
  it("clears the previous error as soon as an action starts", async () => {
    vi.mocked(builderStatus)
      .mockRejectedValueOnce(new Error("first error"))
      .mockResolvedValue(STOPPED);
    let resolve!: () => void;
    vi.mocked(builderStart).mockReturnValue(new Promise<void>(r => { resolve = r; }));
    render(<BuilderView />);
    expect(await screen.findByText("first error")).toBeInTheDocument();
    // Click without awaiting so the action stays in-flight.
    userEvent.click(screen.getByRole("button", { name: "Start" }));
    // The error must be gone before builderStart resolves.
    await waitFor(() => expect(screen.queryByText("first error")).not.toBeInTheDocument());
    // Settle the pending action to avoid act() warnings.
    await reactAct(async () => { resolve(); });
  });

  // Validates the shared positiveInt path now wired into BuilderView: a
  // fractional or negative CPU count must not silently reach builderStart.
  it("refuses a cpu count that is not a positive integer", async () => {
    vi.mocked(builderStatus).mockResolvedValue(ABSENT);
    render(<BuilderView />);
    await userEvent.type(await screen.findByLabelText("CPUs"), "3.5");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/whole number of 1 or more/i)).toBeInTheDocument();
    expect(builderStart).not.toHaveBeenCalled();
  });

  // New: token guard (success path) — a stale response that arrives after a
  // newer one has already landed must be dropped rather than overwriting state.
  it("ignores a status response superseded by a newer refresh", async () => {
    let resolveStale!: (s: BuilderState) => void;
    let callCount = 0;
    vi.mocked(builderStatus).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Mount's request is intentionally slow.
        return new Promise<BuilderState>(r => { resolveStale = r; });
      }
      // Action's refresh resolves quickly.
      return Promise.resolve(RUNNING);
    });
    render(<BuilderView />);
    // State is null while mount's status is pending — Start is still shown.
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    // Action's refresh resolved; state is now RUNNING.
    expect(await screen.findByText("Running")).toBeInTheDocument();
    // The stale mount response arrives carrying STOPPED — must be ignored.
    await reactAct(async () => { resolveStale(STOPPED); });
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  // N2: token guard (catch path) — a stale rejection that arrives after a
  // newer refresh has already succeeded must not push an error banner onto the
  // updated view.
  it("ignores a status error from a superseded refresh", async () => {
    let rejectStale!: (e: Error) => void;
    let callCount = 0;
    vi.mocked(builderStatus).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Mount's request will reject late.
        return new Promise<BuilderState>((_, reject) => { rejectStale = reject; });
      }
      // Action's refresh resolves with RUNNING.
      return Promise.resolve(RUNNING);
    });
    render(<BuilderView />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Running")).toBeInTheDocument();
    // The stale mount request now rejects — must not push an error banner.
    await reactAct(async () => { rejectStale(new Error("network down")); });
    expect(screen.queryByText("network down")).not.toBeInTheDocument();
  });

  // New: keepError — a failed action must leave its error visible after the
  // subsequent refresh. Without keepError=true the refresh would wipe it.
  it("keeps the action error visible after a failed Start", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    vi.mocked(builderStart).mockRejectedValue(new Error("insufficient memory"));
    render(<BuilderView />);
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText("insufficient memory")).toBeInTheDocument();
  });

  // Fix B: keepError must be honoured in the catch path of refresh too. If the
  // follow-up status call itself fails, the action error must not be replaced
  // by an unrelated network error.
  it("keeps the action error when the post-failure status also fails", async () => {
    vi.mocked(builderStatus)
      .mockResolvedValueOnce(STOPPED)                         // mount refresh
      .mockRejectedValue(new Error("network down"));          // post-action refresh
    vi.mocked(builderStart).mockRejectedValue(new Error("insufficient memory"));
    render(<BuilderView />);
    await screen.findByText("Stopped");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("insufficient memory")).toBeInTheDocument();
    expect(screen.queryByText("network down")).not.toBeInTheDocument();
  });

  // N8: act must call refresh({ keepError: true }) after a failed action. A
  // mutation that removes the call leaves the user seeing state that is out of
  // date: e.g., the builder was partially created and they need Delete to
  // recover, but the view still says "Not created".
  it("re-checks builder state after a failed action", async () => {
    vi.mocked(builderStatus)
      .mockResolvedValueOnce(ABSENT)   // mount refresh
      .mockResolvedValue(STOPPED);     // post-action refresh (keepError=true)
    vi.mocked(builderStart).mockRejectedValue(new Error("boot failed"));
    render(<BuilderView />);
    await screen.findByText("Not created");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("boot failed")).toBeInTheDocument();
    // Post-failure refresh found the builder now exists → Delete button appears.
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  // N13: Stop must carry disabled={acting}. While a stop is in flight the
  // button must not be clickable a second time.
  it("disables Stop while a stop is in flight", async () => {
    vi.mocked(builderStatus).mockResolvedValue(RUNNING);
    let resolve!: () => void;
    vi.mocked(builderStop).mockReturnValue(new Promise<void>(r => { resolve = r; }));
    render(<BuilderView />);
    await screen.findByText("Running");
    userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled());
    await reactAct(async () => { resolve(); });
  });

  // N14: Confirm Delete must carry disabled={acting}. The user can open the
  // confirm dialog and then click Start: while Start is running the Confirm
  // Delete button must be frozen so it cannot race the in-flight action.
  it("disables Confirm Delete while a start is in flight", async () => {
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    let resolve!: () => void;
    vi.mocked(builderStart).mockReturnValue(new Promise<void>(r => { resolve = r; }));
    render(<BuilderView />);
    await screen.findByText("Stopped");
    // Expand the confirm dialog, then click Start while it is visible.
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeDisabled());
    await reactAct(async () => { resolve(); });
  });

  // Closing the build modal leaves the build running, and this view is the
  // next click along in the sidebar. It showed "Running" and a live Stop
  // button with nothing to say a build was using the builder, and stopping it
  // is invisible from here: the Images strip goes on saying "Building …" and
  // the modal's builder re-check is keyed on a status that never moves.
  const buildingState = { ...IDLE_BUILD, buildId: 1, status: "running" as const, tag: "app:latest" };

  it("will not stop the builder while a build is running", async () => {
    mockBuild = buildingState;
    vi.mocked(builderStatus).mockResolvedValue(RUNNING);
    render(<BuilderView />);
    await screen.findByText("Running");
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
    expect(screen.getByText(/build is in progress/i)).toBeInTheDocument();
  });

  // A builder stopped from outside while a build was in flight leaves this
  // view offering Delete over a build that has not noticed yet.
  it("will not delete the builder while a build is running", async () => {
    mockBuild = buildingState;
    vi.mocked(builderStatus).mockResolvedValue(STOPPED);
    render(<BuilderView />);
    await screen.findByText("Stopped");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  // The anchor for the two above: with no build in flight the buttons work as
  // they always did and the note stays out of the way.
  it("leaves Stop alone and says nothing when no build is running", async () => {
    vi.mocked(builderStatus).mockResolvedValue(RUNNING);
    render(<BuilderView />);
    await screen.findByText("Running");
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.queryByText(/build is in progress/i)).not.toBeInTheDocument();
  });

  // New: acting disable — controls must be disabled while an action is in
  // flight so the user cannot queue up a second concurrent call.
  it("disables Start and inputs while a start is in flight", async () => {
    vi.mocked(builderStatus).mockResolvedValue(ABSENT);
    let resolve!: () => void;
    vi.mocked(builderStart).mockReturnValue(new Promise<void>(r => { resolve = r; }));
    render(<BuilderView />);
    await screen.findByText("Not created");
    userEvent.click(screen.getByRole("button", { name: "Start" }));
    // Label changes and button becomes disabled while in-flight.
    expect(await screen.findByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(screen.getByLabelText("CPUs")).toBeDisabled();
    expect(screen.getByLabelText("Memory")).toBeDisabled();
    await reactAct(async () => { resolve(); });
  });
});
