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

  // `container stats` samples for about two seconds before it can report a CPU
  // percentage. That is long enough that the panel has to say something for the
  // whole window, and long enough that showing the wrong container's numbers is
  // a real thing a person will read and believe.
  describe("stats while the CLI is still sampling", () => {
    it("reserves the row and shows a placeholder before any numbers arrive", async () => {
      mock.mockImplementation(() => new Promise(() => {}));
      render(<ContainerDetail container={running} onAction={() => {}} />);
      expect(await screen.findByText("CPU")).toBeInTheDocument();
      expect(screen.getByText("Memory")).toBeInTheDocument();
      expect(screen.getAllByText("…")).toHaveLength(2);
    });

    it("replaces the placeholder with the numbers once they land", async () => {
      mock.mockResolvedValue({ cpu: "0.5%", memory: "48 MB" });
      render(<ContainerDetail container={running} onAction={() => {}} />);
      expect(await screen.findByText("0.5%")).toBeInTheDocument();
      expect(screen.getByText("48 MB")).toBeInTheDocument();
      expect(screen.queryByText("…")).not.toBeInTheDocument();
    });

    // A failed call used to leave the row absent entirely. Leaving it on the
    // placeholder instead would be worse: it reads as "still working" forever.
    it("settles on a dash when the call fails", async () => {
      mock.mockRejectedValue(new Error("no such container"));
      render(<ContainerDetail container={running} onAction={() => {}} />);
      await waitFor(() => expect(screen.getAllByText("—")).toHaveLength(2));
    });

    it("drops the previous container's numbers the moment the selection changes", async () => {
      mock.mockResolvedValue({ cpu: "0.5%", memory: "48 MB" });
      const { rerender } = render(<ContainerDetail container={running} onAction={() => {}} />);
      expect(await screen.findByText("0.5%")).toBeInTheDocument();

      mock.mockImplementation(() => new Promise(() => {}));
      rerender(<ContainerDetail container={{ ...running, id: "xyz", name: "other" }} onAction={() => {}} />);

      expect(screen.queryByText("0.5%")).not.toBeInTheDocument();
      expect(screen.queryByText("48 MB")).not.toBeInTheDocument();
      expect(screen.getAllByText("…")).toHaveLength(2);
    });

    // The catch that swallows the error is what makes this reachable: nothing
    // overwrites `stats`, so a panel that did not clear it would settle back onto
    // the old container's numbers and present them as the new one's.
    it("does not fall back to the previous container's numbers when the new call fails", async () => {
      mock.mockResolvedValue({ cpu: "0.5%", memory: "48 MB" });
      const { rerender } = render(<ContainerDetail container={running} onAction={() => {}} />);
      expect(await screen.findByText("0.5%")).toBeInTheDocument();

      mock.mockRejectedValue(new Error("no such container"));
      rerender(<ContainerDetail container={{ ...running, id: "xyz", name: "other" }} onAction={() => {}} />);

      await waitFor(() => expect(screen.getAllByText("—")).toHaveLength(2));
      expect(screen.queryByText("0.5%")).not.toBeInTheDocument();
    });

    it("shows no stats row at all for a stopped container", () => {
      mock.mockImplementation(() => new Promise(() => {}));
      render(<ContainerDetail container={stopped} onAction={() => {}} />);
      expect(screen.queryByText("CPU")).not.toBeInTheDocument();
      expect(screen.queryByText("…")).not.toBeInTheDocument();
    });
  });
});
