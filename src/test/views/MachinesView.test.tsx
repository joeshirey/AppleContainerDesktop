import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MachinesView } from "../../views/MachinesView";

vi.mock("../../api", () => ({
  listMachines: vi.fn(),
  createMachine: vi.fn(),
  stopMachine: vi.fn(),
  deleteMachine: vi.fn(),
  setDefaultMachine: vi.fn(),
}));

import { listMachines, createMachine } from "../../api";
const mockList = vi.mocked(listMachines);
const mockCreate = vi.mocked(createMachine);

const MACHINES = [
  { name: "default", status: "running", isDefault: true, cpus: 4, memoryMB: 4096 },
  { name: "test-machine", status: "stopped", isDefault: false, cpus: 2, memoryMB: 2048 },
];

describe("MachinesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(MACHINES);
    mockCreate.mockResolvedValue(undefined);
  });

  it("renders list of machines", async () => {
    render(<MachinesView />);
    await waitFor(() => expect(screen.getByText("default")).toBeInTheDocument());
    expect(screen.getByText("test-machine")).toBeInTheDocument();
  });

  it("shows default badge on default machine", async () => {
    render(<MachinesView />);
    await waitFor(() => screen.getByText("default"));
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("shows detail panel when machine is selected", async () => {
    render(<MachinesView />);
    await waitFor(() => screen.getByText("default"));
    await userEvent.click(screen.getByText("default"));
    expect(screen.getByText("4 CPUs")).toBeInTheDocument();
  });

  it("shows Create Machine form on + Create button click", async () => {
    render(<MachinesView />);
    await userEvent.click(screen.getByText("+ Create"));
    expect(screen.getByPlaceholderText(/alpine/i)).toBeInTheDocument();
  });

  it("calls createMachine and refreshes on form submit", async () => {
    render(<MachinesView />);
    await userEvent.click(screen.getByText("+ Create"));
    await userEvent.type(screen.getByPlaceholderText(/alpine/i), "alpine:3.22");
    await userEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ image: "alpine:3.22" })));
  });
});
