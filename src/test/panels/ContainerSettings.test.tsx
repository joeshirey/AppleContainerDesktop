import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContainerSettings } from "../../panels/ContainerSettings";
import type { Container } from "../../types";

vi.mock("../../api", () => ({
  inspectContainer: vi.fn(),
  planRecreate: vi.fn(),
  recreateContainer: vi.fn(),
}));

import { inspectContainer, planRecreate, recreateContainer } from "../../api";
const mockInspect = vi.mocked(inspectContainer);
const mockPlan = vi.mocked(planRecreate);
const mockRecreate = vi.mocked(recreateContainer);

const STOPPED_CONTAINER: Container = {
  id: "my-app", name: "my-app", image: "nginx:latest", status: "stopped",
};
const RUNNING_CONTAINER: Container = {
  id: "my-app", name: "my-app", image: "nginx:latest", status: "running",
};

// Shaped exactly as `container inspect` reports it in container 1.2.0.
const INSPECT_DATA = [{
  id: "my-app",
  configuration: {
    id: "my-app",
    image: { reference: "nginx:latest" },
    resources: { cpuOverhead: 1, cpus: 2, memoryInBytes: 2147483648 },
    initProcess: {
      arguments: ["-c", "sleep 60"],
      environment: ["FOO=bar"],
      executable: "/bin/sh",
      rlimits: [],
      supplementalGroups: [],
      terminal: false,
      user: { id: { gid: 0, uid: 0 } },
      workingDirectory: "/srv",
    },
    publishedPorts: [
      { containerPort: 80, count: 1, hostAddress: "0.0.0.0", hostPort: 8080, proto: "tcp" },
    ],
    mounts: [], labels: {}, sysctls: {}, readOnly: false,
    networks: [{ network: "default", options: { hostname: "my-app", mtu: 1280 } }],
  },
  status: { state: "stopped" },
}];

/** Change CPUs from 2 to 4 and open the confirmation step. */
async function editCpusAndApply() {
  await waitFor(() => screen.getByDisplayValue("2"));
  await userEvent.clear(screen.getByDisplayValue("2"));
  await userEvent.type(screen.getByDisplayValue(""), "4");
  await userEvent.click(screen.getByText("Apply Changes"));
}

describe("ContainerSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInspect.mockResolvedValue(INSPECT_DATA as any);
    mockPlan.mockResolvedValue({
      args: ["run", "-d", "--name", "my-app", "nginx:latest"],
      unsupported: [],
    });
    mockRecreate.mockResolvedValue(undefined);
  });

  it("reads cpus and memory from the resources object", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => expect(screen.getByDisplayValue("2")).toBeInTheDocument());
    expect(screen.getByDisplayValue("2g")).toBeInTheDocument();
  });

  it("reads environment variables from the init process", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => expect(screen.getByDisplayValue("FOO=bar")).toBeInTheDocument());
  });

  it("renders a published port as a host:container mapping", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => expect(screen.getByDisplayValue("8080:80")).toBeInTheDocument());
  });

  it("offers no hostname field, which the run CLI cannot set", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getByDisplayValue("2"));
    expect(screen.queryByText(/hostname/i)).not.toBeInTheDocument();
  });

  it("shows notice and disables inputs when container is running", async () => {
    render(<ContainerSettings container={RUNNING_CONTAINER} />);
    await waitFor(() => screen.getByText(/stop the container/i));
    screen.getAllByRole("textbox").forEach(input => expect(input).toBeDisabled());
  });

  it("Apply Changes button disabled when no changes made", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getByDisplayValue("2"));
    expect(screen.getByText("Apply Changes")).toBeDisabled();
  });

  it("shows the diff and the exact command before recreating", async () => {
    mockPlan.mockResolvedValue({
      args: ["run", "-d", "--name", "my-app", "--cpus", "4", "nginx:latest"],
      unsupported: [],
    });
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await editCpusAndApply();

    await waitFor(() => expect(screen.getByText("CPUs: 2 → 4")).toBeInTheDocument());
    expect(
      screen.getByText(/container run -d --name my-app --cpus 4 nginx:latest/),
    ).toBeInTheDocument();
  });

  it("warns about settings the recreate cannot carry over", async () => {
    mockPlan.mockResolvedValue({
      args: ["run", "-d", "--name", "my-app", "nginx:latest"],
      unsupported: ["sysctls (net.ipv4.ip_forward)"],
    });
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await editCpusAndApply();

    await waitFor(() => expect(screen.getByText(/net\.ipv4\.ip_forward/)).toBeInTheDocument());
  });

  // Only changed fields are sent, so the backend rebuilds everything else from
  // the exact recorded values rather than from re-parsed display strings.
  it("sends only the edited field so untouched settings keep their exact values", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await editCpusAndApply();
    await waitFor(() => screen.getByText("Confirm & Recreate"));
    await userEvent.click(screen.getByText("Confirm & Recreate"));

    await waitFor(() => expect(mockRecreate).toHaveBeenCalledWith("my-app", { cpus: "4" }));
  });

  it("sends an edited port list without touching cpus or memory", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getByDisplayValue("8080:80"));
    await userEvent.clear(screen.getByDisplayValue("8080:80"));
    await userEvent.type(screen.getByDisplayValue(""), "9090:80");
    await userEvent.click(screen.getByText("Apply Changes"));
    await waitFor(() => screen.getByText("Confirm & Recreate"));
    await userEvent.click(screen.getByText("Confirm & Recreate"));

    await waitFor(() => expect(mockRecreate).toHaveBeenCalledWith("my-app", {
      ports: ["9090:80"],
    }));
  });

  it("surfaces a recreate failure instead of reporting success", async () => {
    mockRecreate.mockRejectedValue(new Error("boom: recreate with container run ..."));
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await editCpusAndApply();
    await waitFor(() => screen.getByText("Confirm & Recreate"));
    await userEvent.click(screen.getByText("Confirm & Recreate"));

    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
    expect(screen.queryByText(/recreated successfully/i)).not.toBeInTheDocument();
  });

  it("can add a new port mapping", async () => {
    render(<ContainerSettings container={STOPPED_CONTAINER} />);
    await waitFor(() => screen.getAllByText("+ Add", { selector: "button" }));
    await userEvent.click(screen.getAllByText("+ Add")[0]);
    expect(screen.getAllByPlaceholderText(/hostPort:containerPort/i).length).toBe(2);
  });
});
