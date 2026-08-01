import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuildModal } from "../../panels/BuildModal";
import { startBuild, cancelBuild, builderStatus, builderStart } from "../../api";
import { IDLE_BUILD } from "../../hooks/useBuild";
import type { BuildState } from "../../types";

vi.mock("../../api", () => ({
  startBuild: vi.fn(),
  cancelBuild: vi.fn(),
  builderStatus: vi.fn(),
  builderStart: vi.fn(),
}));

vi.mock("../../hooks/useBuild", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/useBuild")>("../../hooks/useBuild");
  return { ...actual, useBuild: () => ({ build: mockState, refresh: mockRefresh }) };
});

let mockState: BuildState = IDLE_BUILD;
const mockRefresh = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  mockState = IDLE_BUILD;
  vi.mocked(builderStatus).mockResolvedValue({
    exists: true, running: true, cpus: 2, memoryMb: 2048, raw: "running",
  });
});

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

  it("sends the form as build options", async () => {
    render(<BuildModal onClose={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("Build context"), "/src/app");
    await userEvent.type(screen.getByLabelText("Tag"), "app:latest");
    await userEvent.click(screen.getByLabelText("No cache"));

    // A half-filled form is the normal state of one the user is still editing,
    // so the blank second row must not go out as `--build-arg =`.
    const addArg = screen.getByRole("button", { name: "Add build argument" });
    await userEvent.click(addArg);
    await userEvent.type(screen.getByLabelText("Build argument name 1"), "VERSION");
    await userEvent.type(screen.getByLabelText("Build argument value 1"), "2");
    await userEvent.click(addArg);

    await userEvent.click(screen.getByRole("button", { name: "Build" }));

    await waitFor(() => expect(startBuild).toHaveBeenCalled());
    expect(vi.mocked(startBuild).mock.calls[0][0]).toMatchObject({
      context: "/src/app",
      tag: "app:latest",
      noCache: true,
      buildArgs: [{ key: "VERSION", value: "2" }],
    });
    // The tag, the build id and the running status only exist on the backend,
    // and none of them arrive on `build-output`. Without this refresh the
    // build streams in with the modal still idle and offering no Cancel.
    expect(mockRefresh).toHaveBeenCalled();
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
    vi.mocked(builderStatus).mockResolvedValue({
      exists: false, running: false, cpus: null, memoryMb: null, raw: "",
    });
    render(<BuildModal onClose={vi.fn()} />);
    const start = await screen.findByRole("button", { name: "Start Builder" });
    expect(builderStart).not.toHaveBeenCalled();
    await userEvent.click(start);
    expect(builderStart).toHaveBeenCalled();
  });

  it("shows the exit code when a build fails", async () => {
    mockState = { ...IDLE_BUILD, status: "failed", tag: "app:latest", exitCode: 1 };
    render(<BuildModal onClose={vi.fn()} />);
    expect(await screen.findByText(/exit code 1/i)).toBeInTheDocument();
  });
});
