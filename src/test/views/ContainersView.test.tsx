import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContainersView } from "../../views/ContainersView";
import type { Container } from "../../types";

// `useContainers` stays real — only the call it makes is stubbed. `getStats`
// is stubbed too because the detail panel polls it on mount, and the global
// `invoke` mock returns undefined rather than a promise.
vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listContainers: vi.fn(),
  getStats: vi.fn(),
}));

import { listContainers, getStats } from "../../api";
const mockList = vi.mocked(listContainers);
const mockStats = vi.mocked(getStats);

const CONTAINERS: Container[] = [
  { id: "aaa1", name: "web", image: "nginx:latest", status: "running", ports: "8080:80" },
  { id: "bbb2", name: "db", image: "postgres:16", status: "stopped" },
  {
    id: "ccc3",
    name: "broken",
    image: "alpine:3.22",
    status: "stopped",
    missingBindMounts: ["/Users/someone/gone"],
  },
];

describe("ContainersView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(CONTAINERS);
    mockStats.mockResolvedValue({});
  });

  it("splits containers into running and stopped, with counts", async () => {
    render(<ContainersView />);
    expect(await screen.findByText("Running · 1")).toBeInTheDocument();
    expect(screen.getByText("Stopped · 2")).toBeInTheDocument();
  });

  it("shows the image and published ports under the name", async () => {
    render(<ContainersView />);
    expect(await screen.findByText("nginx:latest · 8080:80")).toBeInTheDocument();
    // No ports on this one, so nothing is appended.
    expect(screen.getByText("postgres:16")).toBeInTheDocument();
  });

  it("filters by name", async () => {
    render(<ContainersView />);
    await screen.findByText("web");

    await userEvent.type(screen.getByPlaceholderText("Filter..."), "db");

    expect(screen.getByText("db")).toBeInTheDocument();
    expect(screen.queryByText("web")).not.toBeInTheDocument();
  });

  it("filters by image as well as name", async () => {
    render(<ContainersView />);
    await screen.findByText("web");

    await userEvent.type(screen.getByPlaceholderText("Filter..."), "postgres");

    expect(screen.getByText("db")).toBeInTheDocument();
    expect(screen.queryByText("web")).not.toBeInTheDocument();
  });

  it("says so when the filter matches nothing", async () => {
    render(<ContainersView />);
    await screen.findByText("web");

    await userEvent.type(screen.getByPlaceholderText("Filter..."), "nothing-matches-this");

    expect(screen.getByText("No containers.")).toBeInTheDocument();
  });

  it("says so when there are no containers at all", async () => {
    mockList.mockResolvedValue([]);
    render(<ContainersView />);
    expect(await screen.findByText("No containers.")).toBeInTheDocument();
  });

  // A container that bind-mounts a host path that has since been deleted stays
  // listed and removable, but is badged so it is obvious why it will not start.
  it("badges a container whose bind mount source is gone", async () => {
    render(<ContainersView />);
    const badge = await screen.findByText("mount missing");
    expect(badge).toHaveAttribute("title", "A bind mount source is missing");
  });

  it("leaves unbroken containers unbadged", async () => {
    mockList.mockResolvedValue([CONTAINERS[0]]);
    render(<ContainersView />);
    await screen.findByText("web");
    expect(screen.queryByText("mount missing")).not.toBeInTheDocument();
  });

  it("waits for a selection before showing any detail", async () => {
    render(<ContainersView />);
    await screen.findByText("web");
    expect(screen.getByText("Select a container")).toBeInTheDocument();
  });

  it("opens the detail panel for the container that was clicked", async () => {
    render(<ContainersView />);
    await userEvent.click(await screen.findByText("web"));

    expect(screen.queryByText("Select a container")).not.toBeInTheDocument();
    expect(await screen.findByText("aaa1")).toBeInTheDocument();
  });

  it("opens the run dialog from the toolbar", async () => {
    render(<ContainersView />);
    await screen.findByText("web");

    await userEvent.click(screen.getByRole("button", { name: "+ Run" }));

    expect(screen.getByText("Run New Container")).toBeInTheDocument();
  });

  // A missing binary is not a transient error worth a red strip — nothing in
  // the view can work, so it is replaced with instructions.
  it("replaces the whole view when the CLI is missing", async () => {
    mockList.mockRejectedValue(new Error("CLI not found: no such file"));
    render(<ContainersView />);

    expect(await screen.findByText("Container CLI not found")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter...")).not.toBeInTheDocument();
  });
});
