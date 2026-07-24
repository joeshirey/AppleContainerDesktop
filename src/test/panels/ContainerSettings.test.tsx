import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContainerSettings } from "../../panels/ContainerSettings";
import type { Container } from "../../types";

vi.mock("../../api", () => ({
  inspectContainer: vi.fn(),
  removeContainer: vi.fn(),
  runContainer: vi.fn(),
}));

import { inspectContainer, removeContainer, runContainer } from "../../api";
const mockInspect = vi.mocked(inspectContainer);
const mockRemove = vi.mocked(removeContainer);
const mockRun = vi.mocked(runContainer);

const STOPPED_CONTAINER: Container = {
  id: "my-app", name: "my-app", image: "nginx:latest", status: "stopped",
};
const RUNNING_CONTAINER: Container = {
  id: "my-app", name: "my-app", image: "nginx:latest", status: "running",
};

const INSPECT_DATA = {
  id: "my-app",
  configuration: {
    image: { reference: "nginx:latest" },
    cpus: 2,
    memoryInBytes: 2147483648,
    hostname: "my-host",
    publishedPorts: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }],
    environment: ["FOO=bar"],
  },
  status: { state: "stopped" },
};

describe("ContainerSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInspect.mockResolvedValue(INSPECT_DATA as any);
    mockRemove.mockResolvedValue(undefined);
    mockRun.mockResolvedValue(undefined);
  });

  it("shows a loading state then renders fields", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => expect(screen.getByDisplayValue("2")).toBeInTheDocument());
    expect(screen.getByDisplayValue("2g")).toBeInTheDocument();
    expect(screen.getByDisplayValue("my-host")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8080:80")).toBeInTheDocument();
    expect(screen.getByDisplayValue("FOO=bar")).toBeInTheDocument();
  });

  it("shows notice and disables inputs when container is running", async () => {
    render(<ContainerSettings container={RUNNING_CONTAINER} />);
    await waitFor(() => screen.getByText(/stop the container/i));
    const inputs = screen.getAllByRole("textbox");
    inputs.forEach(input => expect(input).toBeDisabled());
  });

  it("Apply Changes button disabled when no changes made", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getByDisplayValue("2"));
    expect(screen.getByText("Apply Changes")).toBeDisabled();
  });

  it("shows diff confirmation when Apply Changes is clicked after a change", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getByDisplayValue("2"));
    const cpuInput = screen.getByDisplayValue("2");
    await userEvent.clear(cpuInput);
    await userEvent.type(cpuInput, "4");
    expect(screen.getByText("Apply Changes")).not.toBeDisabled();
    await userEvent.click(screen.getByText("Apply Changes"));
    expect(screen.getByText(/confirm/i)).toBeInTheDocument();
    expect(screen.getByText(/cpus/i)).toBeInTheDocument();
  });

  it("calls removeContainer and runContainer on confirm", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getByDisplayValue("2"));
    await userEvent.clear(screen.getByDisplayValue("2"));
    await userEvent.type(screen.getByDisplayValue(""), "4");
    await userEvent.click(screen.getByText("Apply Changes"));
    await userEvent.click(screen.getByText("Confirm & Recreate"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("my-app"));
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({
      image: "nginx:latest",
      name: "my-app",
    }));
  });

  it("can add a new port mapping", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getAllByText("+ Add", { selector: "button" }));
    const addBtns = screen.getAllByText("+ Add");
    await userEvent.click(addBtns[0]); // first + Add is for ports
    const portInputs = screen.getAllByPlaceholderText(/hostPort:containerPort/i);
    expect(portInputs.length).toBe(2); // existing + new empty
  });
});
