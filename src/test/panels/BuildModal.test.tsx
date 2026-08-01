import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-dialog";
import { BuildModal } from "../../panels/BuildModal";
import { startBuild, cancelBuild, builderStatus, builderStart } from "../../api";
import { IDLE_BUILD } from "../../hooks/useBuild";
import type { BuilderState, BuildState } from "../../types";

vi.mock("../../api", () => ({
  startBuild: vi.fn(),
  cancelBuild: vi.fn(),
  builderStatus: vi.fn(),
  builderStart: vi.fn(),
  // Unused by the modal, but the real `useBuild` imports it and this factory
  // replaces the whole module. Without it, wrapping the modal in a
  // <BuildProvider> would call undefined and `useBuild`'s own catch would
  // swallow it into a provider stuck permanently on IDLE_BUILD.
  getBuildState: vi.fn(),
}));

vi.mock("../../hooks/useBuild", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/useBuild")>("../../hooks/useBuild");
  return { ...actual, useBuild: () => ({ build: mockState, refresh: mockRefresh }) };
});

let mockState: BuildState = IDLE_BUILD;
const mockRefresh = vi.fn(async () => {});

/// jsdom does no layout, so scrollHeight is 0 and an autoscroll assertion
/// would hold no matter what the component did. setup.ts stubs scrollIntoView
/// for the same reason.
const SCROLL_HEIGHT = 9999;
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get: () => SCROLL_HEIGHT,
});

const BUILDER_UP = { exists: true, running: true, cpus: 2, memoryMb: 2048, raw: "running" };
const BUILDER_DOWN = { exists: false, running: false, cpus: null, memoryMb: null, raw: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mockState = IDLE_BUILD;
  // clearAllMocks drops recorded calls but keeps implementations, so every
  // resolved and rejected value a test installs is re-established here.
  vi.mocked(startBuild).mockResolvedValue(undefined);
  vi.mocked(cancelBuild).mockResolvedValue(undefined);
  vi.mocked(builderStart).mockResolvedValue(undefined);
  vi.mocked(open).mockResolvedValue(null);
  vi.mocked(builderStatus).mockResolvedValue(BUILDER_UP);
});

async function fillRequired() {
  await userEvent.type(await screen.findByLabelText("Build context"), "/src/app");
  await userEvent.type(screen.getByLabelText("Tag"), "app:latest");
}

describe("BuildModal", () => {
  it("keeps Build disabled until a context and a tag are set", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    const build = await screen.findByRole("button", { name: "Build" });
    expect(build).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Build context"), "/src/app");
    expect(build).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Tag"), "app:latest");
    expect(build).toBeEnabled();
  });

  it("sends the whole form as build options, trimmed", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("Build context"), "  /src/app  ");
    await userEvent.type(screen.getByLabelText("Dockerfile"), "  /x/Dockerfile  ");
    await userEvent.type(screen.getByLabelText("Tag"), "  app:latest  ");
    await userEvent.click(screen.getByLabelText("No cache"));
    await userEvent.type(screen.getByLabelText("Target stage"), "  runtime  ");

    const addArg = screen.getByRole("button", { name: "Add build argument" });
    await userEvent.click(addArg);
    await userEvent.type(screen.getByLabelText("Build argument name 1"), "VERSION");
    await userEvent.type(screen.getByLabelText("Build argument value 1"), "2");
    // A half-filled form is the normal state of one still being edited, so the
    // blank second row must not go out as `--build-arg =`.
    await userEvent.click(addArg);

    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    await userEvent.type(screen.getByLabelText("Platform"), "  linux/amd64  ");
    await userEvent.click(screen.getByLabelText("Always pull base images"));
    await userEvent.click(screen.getByRole("button", { name: "Add label" }));
    await userEvent.type(screen.getByLabelText("Label name 1"), "org.opencontainers.image.source");
    await userEvent.type(screen.getByLabelText("Label value 1"), "https://example.test");
    await userEvent.type(screen.getByLabelText("Builder CPUs"), "4");
    await userEvent.type(screen.getByLabelText("Builder memory"), "  8G  ");

    await userEvent.click(screen.getByRole("button", { name: "Build" }));

    await waitFor(() => expect(startBuild).toHaveBeenCalled());
    expect(vi.mocked(startBuild).mock.calls[0][0]).toEqual({
      context: "/src/app",
      tag: "app:latest",
      dockerfile: "/x/Dockerfile",
      noCache: true,
      buildArgs: [{ key: "VERSION", value: "2" }],
      target: "runtime",
      platform: "linux/amd64",
      labels: [{ key: "org.opencontainers.image.source", value: "https://example.test" }],
      pull: true,
      cpus: 4,
      memory: "8G",
    });
    // The tag, the build id and the running status only exist on the backend,
    // and none of them arrive on `build-output`. Without this refresh the
    // build streams in with the modal still idle and offering no Cancel.
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("omits every optional field left blank", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: "Build" }));

    await waitFor(() => expect(startBuild).toHaveBeenCalled());
    expect(vi.mocked(startBuild).mock.calls[0][0]).toEqual({
      context: "/src/app",
      tag: "app:latest",
      dockerfile: undefined,
      noCache: false,
      buildArgs: [],
      target: undefined,
      platform: undefined,
      labels: [],
      pull: false,
      cpus: undefined,
      memory: undefined,
    });
  });

  // NaN would serialise to JSON null and build at the default allocation
  // without saying so; a fractional count reaches serde instead and comes back
  // as a raw deserialiser string.
  it("refuses a builder CPU count the backend cannot use", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    await userEvent.type(screen.getByLabelText("Builder CPUs"), "3.5");
    await userEvent.click(screen.getByRole("button", { name: "Build" }));

    expect(await screen.findByText(/whole number of 1 or more/i)).toBeInTheDocument();
    expect(startBuild).not.toHaveBeenCalled();
  });

  // Start Builder is the other door onto the same field. Unguarded, a count
  // positiveInt rejects arrives at builderStart as undefined, the builder comes
  // up at the default allocation and the notice disappears as though the typed
  // count had been honoured.
  it("refuses a builder CPU count when starting the builder too", async () => {
    vi.mocked(builderStatus).mockResolvedValue(BUILDER_DOWN);
    render(<BuildModal onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Start Builder" });
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    await userEvent.type(screen.getByLabelText("Builder CPUs"), "3.5");
    await userEvent.click(screen.getByRole("button", { name: "Start Builder" }));

    expect(await screen.findByText(/whole number of 1 or more/i)).toBeInTheDocument();
    expect(builderStart).not.toHaveBeenCalled();
  });

  it("surfaces a build the backend refuses to start", async () => {
    vi.mocked(startBuild).mockRejectedValue(new Error("No Dockerfile or Containerfile in /src/app"));
    render(<BuildModal onClose={vi.fn()} />);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: "Build" }));

    expect(await screen.findByText("No Dockerfile or Containerfile in /src/app")).toBeInTheDocument();
  });

  it("adds and removes build arguments", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add build argument" }));
    await userEvent.type(screen.getByLabelText("Build argument name 1"), "VERSION");
    await userEvent.type(screen.getByLabelText("Build argument value 1"), "2");
    expect(screen.getByLabelText("Build argument name 1")).toHaveValue("VERSION");

    await userEvent.click(screen.getByRole("button", { name: "Remove build argument 1" }));
    expect(screen.queryByLabelText("Build argument name 1")).not.toBeInTheDocument();
  });

  it("fills the context and the Dockerfile from the file pickers", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    const [pickContext, pickDockerfile] = await screen.findAllByRole("button", { name: "Choose…" });

    vi.mocked(open).mockResolvedValue("/picked/ctx");
    await userEvent.click(pickContext);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(screen.getByLabelText("Build context")).toHaveValue("/picked/ctx");

    vi.mocked(open).mockResolvedValue("/picked/Dockerfile");
    await userEvent.click(pickDockerfile);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: false }));
    expect(screen.getByLabelText("Dockerfile")).toHaveValue("/picked/Dockerfile");
  });

  it("surfaces a picker that fails instead of doing nothing", async () => {
    vi.mocked(open).mockRejectedValue(new Error("dialog.open not allowed"));
    render(<BuildModal onClose={vi.fn()} />);
    const [pickContext] = await screen.findAllByRole("button", { name: "Choose…" });
    await userEvent.click(pickContext);

    expect(await screen.findByText("dialog.open not allowed")).toBeInTheDocument();
  });

  it("hides the advanced options until asked", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Platform")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Advanced/ }));
    expect(screen.getByLabelText("Platform")).toBeInTheDocument();
  });

  it("renders build output and offers Cancel while running", async () => {
    mockState = {
      ...IDLE_BUILD,
      status: "running",
      tag: "app:latest",
      lines: [
        { seq: 0, stream: "stdout", line: "step 1/3" },
        { seq: 1, stream: "stderr", line: "step 2/3" },
      ],
      nextSeq: 2,
    };
    render(<BuildModal onClose={vi.fn()} />);
    expect(await screen.findByText("step 1/3")).toBeInTheDocument();
    expect(screen.getByText("step 2/3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel Build" }));
    expect(cancelBuild).toHaveBeenCalled();
  });

  // Cancel can lose the race with a build that has already finished. Without
  // clearing, the rejection sits in red beside the success banner for good,
  // and the modal has no control that dismisses it.
  it("clears a stale error once the build's status moves on", async () => {
    vi.mocked(cancelBuild).mockRejectedValue(new Error("no build is running"));
    mockState = { ...IDLE_BUILD, status: "running", tag: "app:latest" };
    const { rerender } = render(<BuildModal onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Cancel Build" }));
    expect(await screen.findByText("no build is running")).toBeInTheDocument();

    mockState = { ...mockState, status: "succeeded" };
    rerender(<BuildModal onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.queryByText("no build is running")).not.toBeInTheDocument());
    expect(screen.getByText(/Built app:latest/)).toBeInTheDocument();
  });

  it("clears the previous error when Cancel is retried", async () => {
    vi.mocked(cancelBuild).mockRejectedValueOnce(new Error("cancel failed once"));
    mockState = { ...IDLE_BUILD, status: "running", tag: "app:latest" };
    render(<BuildModal onClose={vi.fn()} />);

    const cancel = await screen.findByRole("button", { name: "Cancel Build" });
    await userEvent.click(cancel);
    expect(await screen.findByText("cancel failed once")).toBeInTheDocument();

    await userEvent.click(cancel);
    await waitFor(() =>
      expect(screen.queryByText("cancel failed once")).not.toBeInTheDocument());
  });

  // The ring buffer in useBuild caps the transcript, so past the cap it evicts
  // one line for every line it appends and the array length stops moving.
  // Anything keyed on that length stops firing exactly when a long build needs
  // it, and the tail scrolls away under the user.
  it("keeps following the tail after the line cap starts evicting", async () => {
    const CAP = 5000;
    const at = (n: number) => ({ seq: n, stream: "stdout" as const, line: `line ${n}` });
    const full = Array.from({ length: CAP }, (_, i) => at(i));
    mockState = { ...IDLE_BUILD, status: "running", tag: "app:latest", lines: full, nextSeq: CAP };

    const { rerender } = render(<BuildModal onClose={vi.fn()} />);
    const pane = (await screen.findByText(`line ${CAP - 1}`)).parentElement!;
    pane.scrollTop = 0;

    mockState = { ...mockState, lines: [...full.slice(1), at(CAP)], nextSeq: CAP + 1 };
    rerender(<BuildModal onClose={vi.fn()} />);

    expect(screen.getByText(`line ${CAP}`)).toBeInTheDocument();
    expect(pane.scrollTop).toBe(SCROLL_HEIGHT);
  });

  // Closing is not cancelling. The build keeps running and the strip in the
  // Images view is what brings you back to it.
  it("closing does not cancel the build", async () => {
    mockState = { ...IDLE_BUILD, status: "running", tag: "app:latest" };
    const onClose = vi.fn();
    render(<BuildModal onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(cancelBuild).not.toHaveBeenCalled();
  });

  // Both "stopped" and "never created" get the same offer here: the modal only
  // cares whether the builder is up, and Start covers either way of not being.
  it("offers to start a builder that is not running instead of starting it silently", async () => {
    vi.mocked(builderStatus).mockResolvedValue(BUILDER_DOWN);
    render(<BuildModal onClose={vi.fn()} />);
    const start = await screen.findByRole("button", { name: "Start Builder" });
    expect(builderStart).not.toHaveBeenCalled();
    await userEvent.click(start);
    expect(builderStart).toHaveBeenCalled();
  });

  it("does not let Start Builder be pressed twice", async () => {
    vi.mocked(builderStatus).mockResolvedValue(BUILDER_DOWN);
    let release = () => {};
    vi.mocked(builderStart).mockReturnValue(new Promise<void>(r => { release = () => r(); }));
    render(<BuildModal onClose={vi.fn()} />);

    const start = await screen.findByRole("button", { name: "Start Builder" });
    await userEvent.click(start);
    expect(start).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Start Builder" })).not.toBeInTheDocument());
    expect(builderStart).toHaveBeenCalledTimes(1);
  });

  it("re-enables Start Builder after a start that failed", async () => {
    vi.mocked(builderStatus).mockResolvedValue(BUILDER_DOWN);
    vi.mocked(builderStart).mockRejectedValue(new Error("insufficient host memory"));
    render(<BuildModal onClose={vi.fn()} />);

    const start = await screen.findByRole("button", { name: "Start Builder" });
    await userEvent.click(start);

    expect(await screen.findByText("insufficient host memory")).toBeInTheDocument();
    // The resolve path unmounts the notice, so this is the only path on which
    // the button is still on screen to be retried once the memory is freed.
    expect(start).toBeEnabled();
  });

  // `builderRunning` is a tri-state and null is not false. This is the window
  // while `container builder status` is still spawning, where the answer is
  // not known yet: `!builderRunning` would announce "The builder is not
  // running" for those few hundred milliseconds on every open, builder up or
  // down. Never resolving holds the modal in that window for the assertion.
  it("says nothing about the builder until the status has landed", async () => {
    vi.mocked(builderStatus).mockReturnValue(new Promise<BuilderState>(() => {}));
    render(<BuildModal onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Build" });

    expect(screen.queryByRole("button", { name: "Start Builder" })).not.toBeInTheDocument();
    expect(screen.queryByText(/builder is not running/i)).not.toBeInTheDocument();
  });

  it("re-checks the builder when the build's status changes", async () => {
    mockState = { ...IDLE_BUILD, status: "running", tag: "app:latest" };
    const { rerender } = render(<BuildModal onClose={vi.fn()} />);
    await waitFor(() => expect(builderStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Start Builder" })).not.toBeInTheDocument();

    // Stopped from the Builder view while this modal sat open. Read once at
    // mount, the modal would fail the build with a raw CLI error and never
    // re-offer Start.
    vi.mocked(builderStatus).mockResolvedValue(BUILDER_DOWN);
    mockState = { ...mockState, status: "failed" };
    rerender(<BuildModal onClose={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Start Builder" })).toBeInTheDocument();
  });

  it("ignores a builder status that lands after the modal has moved on", async () => {
    let landSlow: (s: BuilderState) => void = () => {};
    vi.mocked(builderStatus)
      .mockReturnValueOnce(new Promise<BuilderState>(r => { landSlow = r; }))
      .mockResolvedValueOnce(BUILDER_UP);

    mockState = { ...IDLE_BUILD, status: "running", tag: "app:latest" };
    const { rerender } = render(<BuildModal onClose={vi.fn()} />);

    mockState = { ...mockState, status: "succeeded" };
    rerender(<BuildModal onClose={vi.fn()} />);
    await waitFor(() => expect(builderStatus).toHaveBeenCalledTimes(2));

    // The mount's request finally answers, carrying the stale reading.
    await act(async () => { landSlow(BUILDER_DOWN); });

    expect(screen.queryByRole("button", { name: "Start Builder" })).not.toBeInTheDocument();
  });

  it("shows the exit code when a build fails", async () => {
    mockState = { ...IDLE_BUILD, status: "failed", tag: "app:latest", exitCode: 1 };
    render(<BuildModal onClose={vi.fn()} />);
    expect(await screen.findByText(/exit code 1/i)).toBeInTheDocument();
  });

  // A build killed by a signal reports no code at all.
  it("says unknown when a failed build reports no exit code", async () => {
    mockState = { ...IDLE_BUILD, status: "failed", tag: "app:latest", exitCode: null };
    render(<BuildModal onClose={vi.fn()} />);
    expect(await screen.findByText(/exit code unknown/i)).toBeInTheDocument();
  });

  it("reports a cancelled build", async () => {
    mockState = { ...IDLE_BUILD, status: "cancelled", tag: "app:latest" };
    render(<BuildModal onClose={vi.fn()} />);
    expect(await screen.findByText("Build cancelled.")).toBeInTheDocument();
  });

  it("names the image a succeeded build produced", async () => {
    mockState = { ...IDLE_BUILD, status: "succeeded", tag: "app:latest" };
    render(<BuildModal onClose={vi.fn()} />);
    expect(await screen.findByText(/Built app:latest/)).toBeInTheDocument();
  });

  it("says how much earlier output was dropped", async () => {
    mockState = {
      ...IDLE_BUILD,
      status: "running",
      tag: "app:latest",
      lines: [{ seq: 12, stream: "stdout", line: "step 9/9" }],
      nextSeq: 13,
      dropped: 12,
    };
    render(<BuildModal onClose={vi.fn()} />);
    expect(await screen.findByText(/dropped: 12 lines/i)).toBeInTheDocument();
  });
});
