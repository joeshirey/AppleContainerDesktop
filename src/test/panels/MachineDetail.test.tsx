import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MachineDetail } from "../../panels/MachineDetail";
import type { Machine } from "../../types";

vi.mock("../../api", () => ({
  stopMachine: vi.fn(),
  deleteMachine: vi.fn(),
  setDefaultMachine: vi.fn(),
}));

import { stopMachine, deleteMachine, setDefaultMachine } from "../../api";
const mockStop = vi.mocked(stopMachine);
const mockDelete = vi.mocked(deleteMachine);
const mockSetDefault = vi.mocked(setDefaultMachine);

const MACHINE: Machine = { name: "test", status: "running", isDefault: false, cpus: 4, memoryMB: 4096 };

describe("MachineDetail", () => {
  const onAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStop.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockSetDefault.mockResolvedValue(undefined);
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
