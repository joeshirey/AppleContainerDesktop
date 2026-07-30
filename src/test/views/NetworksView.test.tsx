import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworksView } from "../../views/NetworksView";
import type { Network } from "../../types";

vi.mock("../../api", () => ({
  listNetworks: vi.fn(),
  createNetwork: vi.fn(),
  deleteNetwork: vi.fn(),
  pruneNetworks: vi.fn(),
}));

import { listNetworks, createNetwork, deleteNetwork, pruneNetworks } from "../../api";
const mockList = vi.mocked(listNetworks);
const mockCreate = vi.mocked(createNetwork);
const mockDelete = vi.mocked(deleteNetwork);
const mockPrune = vi.mocked(pruneNetworks);

const BUILTIN: Network = {
  name: "default", mode: "nat", plugin: "container-network-vmnet",
  subnet: "192.168.64.0/24", gateway: "192.168.64.1",
  created: "2026-07-29T00:00:00Z", isBuiltin: true, inUseBy: ["web"],
};
const CUSTOM: Network = {
  name: "lab", mode: "nat", plugin: "container-network-vmnet",
  subnet: "10.1.0.0/24", gateway: "10.1.0.1",
  created: "2026-07-29T00:00:00Z", isBuiltin: false, inUseBy: [],
};

describe("NetworksView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([BUILTIN, CUSTOM]);
    mockCreate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockPrune.mockResolvedValue("");
  });

  it("lists networks with their subnet and gateway", async () => {
    render(<NetworksView />);
    expect(await screen.findByText("default")).toBeInTheDocument();
    expect(screen.getByText("192.168.64.0/24")).toBeInTheDocument();
    expect(screen.getByText("192.168.64.1")).toBeInTheDocument();
  });

  // `container network delete default` fails with "cannot delete a builtin
  // network", so a Delete button there would only ever produce an error.
  it("offers no delete at all for a builtin network", async () => {
    render(<NetworksView />);
    await screen.findByText("default");
    const row = screen.getAllByRole("row").find(r => r.textContent?.includes("default"))!;
    expect(within(row).queryByRole("button", { name: /delete/i })).toBeNull();
    expect(within(row).getByText(/built-?in/i)).toBeInTheDocument();
  });

  it("deletes a user-created network after a confirmation", async () => {
    render(<NetworksView />);
    await screen.findByText("lab");
    const row = screen.getAllByRole("row").find(r => r.textContent?.includes("lab"))!;
    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    expect(mockDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("lab"));
  });

  it("will not offer to delete a network with containers attached", async () => {
    mockList.mockResolvedValue([{ ...CUSTOM, inUseBy: ["api"] }]);
    render(<NetworksView />);
    await screen.findByText("lab");
    const row = screen.getAllByRole("row").find(r => r.textContent?.includes("lab"))!;
    expect(within(row).getByRole("button", { name: /^delete$/i })).toBeDisabled();
    expect(within(row).getByText(/api/)).toBeInTheDocument();
  });

  it("creates a network with a subnet and the internal flag", async () => {
    render(<NetworksView />);
    await userEvent.click(screen.getByRole("button", { name: /\+ create/i }));
    await userEvent.type(screen.getByLabelText(/name/i), "lab2");
    await userEvent.type(screen.getByLabelText(/subnet/i), "10.2.0.0/24");
    await userEvent.click(screen.getByLabelText(/host-only|internal/i));
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith("lab2", { subnet: "10.2.0.0/24", internal: true })
    );
  });

  it("leaves subnet unset when the field is empty", async () => {
    render(<NetworksView />);
    await userEvent.click(screen.getByRole("button", { name: /\+ create/i }));
    await userEvent.type(screen.getByLabelText(/name/i), "lab2");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith("lab2", { subnet: undefined, internal: false })
    );
  });

  it("prunes unconnected networks after a confirmation", async () => {
    render(<NetworksView />);
    await userEvent.click(screen.getByRole("button", { name: /prune unused/i }));
    expect(mockPrune).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm prune/i }));
    await waitFor(() => expect(mockPrune).toHaveBeenCalled());
  });

  it("surfaces a failure from the CLI", async () => {
    mockDelete.mockRejectedValue(new Error("cannot delete a builtin network"));
    render(<NetworksView />);
    await screen.findByText("lab");
    const row = screen.getAllByRole("row").find(r => r.textContent?.includes("lab"))!;
    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(await screen.findByText(/cannot delete a builtin network/)).toBeInTheDocument();
  });
});
