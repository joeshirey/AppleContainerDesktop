import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MachineDetail } from "../../panels/MachineDetail";
import type { Machine } from "../../types";

vi.mock("../../api", () => ({
  stopMachine: vi.fn(),
  deleteMachine: vi.fn(),
  setDefaultMachine: vi.fn(),
  setMachineConfig: vi.fn(),
}));

// The tab bodies each have their own tests; here we only care that the right
// one is mounted with the right target.
vi.mock("../../panels/LogsPanel", () => ({
  LogsPanel: ({ source }: any) => <div data-testid="logs">{JSON.stringify(source)}</div>,
}));
vi.mock("../../panels/ExecPanel", () => ({
  ExecPanel: ({ target }: any) => <div data-testid="shell">{JSON.stringify(target)}</div>,
}));

import { stopMachine, deleteMachine, setDefaultMachine, setMachineConfig } from "../../api";
const mockStop = vi.mocked(stopMachine);
const mockDelete = vi.mocked(deleteMachine);
const mockSetDefault = vi.mocked(setDefaultMachine);
const mockSetConfig = vi.mocked(setMachineConfig);

const MACHINE: Machine = { name: "test", status: "running", isDefault: false, cpus: 4, memoryMB: 4096 };

describe("MachineDetail", () => {
  const onAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStop.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockSetDefault.mockResolvedValue(undefined);
    mockSetConfig.mockResolvedValue(undefined);
  });

  it("opens the shell against the machine, not a container", async () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    await userEvent.click(screen.getByRole("tab", { name: /shell/i }));
    expect(screen.getByTestId("shell")).toHaveTextContent('{"kind":"machine","name":"test"}');
  });

  it("opens logs against the machine", async () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    await userEvent.click(screen.getByRole("tab", { name: /logs/i }));
    expect(screen.getByTestId("logs")).toHaveTextContent('{"kind":"machine","name":"test"}');
  });

  it("applies only the settings that were changed", async () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    await userEvent.click(screen.getByRole("tab", { name: /settings/i }));
    const memory = screen.getByLabelText(/memory/i);
    await userEvent.clear(memory);
    await userEvent.type(memory, "8G");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledWith("test", { memory: "8G" }));
  });

  it("does not call the CLI when Apply is pressed with nothing changed", async () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    await userEvent.click(screen.getByRole("tab", { name: /settings/i }));
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  // `machine set` only takes effect on the next boot, and the CLI says so.
  // Not repeating that in the GUI would leave people thinking it did nothing.
  it("says a restart is needed after applying", async () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    await userEvent.click(screen.getByRole("tab", { name: /settings/i }));
    const cpus = screen.getByLabelText(/cpus/i);
    await userEvent.clear(cpus);
    await userEvent.type(cpus, "8");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(screen.getByText(/^Saved\./)).toBeInTheDocument());
    expect(screen.getByText(/for the restart to pick it up/i)).toBeInTheDocument();
  });

  it("shows machine name and status", () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("shows CPU and memory info", () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    expect(screen.getByText("4 CPUs")).toBeInTheDocument();
    expect(screen.getByText("4096 MB")).toBeInTheDocument();
  });

  it("shows Set Default button when not default", () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    expect(screen.getByText("Set Default")).toBeInTheDocument();
  });

  it("calls setDefaultMachine and onAction on Set Default click", async () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    await userEvent.click(screen.getByText("Set Default"));
    await waitFor(() => expect(mockSetDefault).toHaveBeenCalledWith("test"));
    expect(onAction).toHaveBeenCalled();
  });

  it("shows Stop button for running machine", () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("shows inline delete confirmation before deleting", async () => {
    render(<MachineDetail machine={MACHINE} onAction={onAction} />);
    await userEvent.click(screen.getByText("Delete"));
    expect(screen.getByText("Confirm Delete")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Confirm Delete"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("test"));
  });
});
