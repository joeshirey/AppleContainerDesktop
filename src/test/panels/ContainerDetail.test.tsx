import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ContainerDetail } from "../../panels/ContainerDetail";
import type { Container } from "../../types";

const mock = vi.mocked(invoke);
const running: Container = { id: "abc", name: "nginx", image: "nginx:latest", status: "running" };
const stopped: Container = { id: "def", name: "redis", image: "redis:7", status: "stopped" };

describe("ContainerDetail", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.mockResolvedValue({}); });

  it("warns about missing bind-mount sources and names each path", () => {
    const broken: Container = {
      ...stopped,
      missingBindMounts: ["/Users/me/gone", "/tmp/also-gone"],
    };
    render(<ContainerDetail container={broken} onAction={() => {}} />);
    expect(screen.getByText(/bind mount/i)).toBeInTheDocument();
    expect(screen.getByText("/Users/me/gone")).toBeInTheDocument();
    expect(screen.getByText("/tmp/also-gone")).toBeInTheDocument();
  });

  it("shows no bind-mount warning when every source is present", () => {
    render(<ContainerDetail container={stopped} onAction={() => {}} />);
    expect(screen.queryByText(/bind mount/i)).not.toBeInTheDocument();
  });

  it("shows container name", () => {
    render(<ContainerDetail container={running} onAction={() => {}} />);
    expect(screen.getByText("nginx")).toBeInTheDocument();
  });

  it("shows Running badge for running container", () => {
    render(<ContainerDetail container={running} onAction={() => {}} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows Stop button for running container", () => {
    render(<ContainerDetail container={running} onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("shows Start button for stopped container", () => {
    render(<ContainerDetail container={stopped} onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("fetches stats on mount for running container", async () => {
    mock.mockResolvedValue({ cpu: "0.5%", memory: "48 MB" });
    render(<ContainerDetail container={running} onAction={() => {}} />);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("get_stats", { id: "abc" }));
  });
});
