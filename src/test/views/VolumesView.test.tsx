import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VolumesView } from "../../views/VolumesView";
import type { Volume } from "../../types";

vi.mock("../../api", () => ({
  listVolumes: vi.fn(),
  createVolume: vi.fn(),
  deleteVolume: vi.fn(),
  pruneVolumes: vi.fn(),
}));

import { listVolumes, createVolume, deleteVolume, pruneVolumes } from "../../api";
const mockList = vi.mocked(listVolumes);
const mockCreate = vi.mocked(createVolume);
const mockDelete = vi.mocked(deleteVolume);
const mockPrune = vi.mocked(pruneVolumes);

const FREE: Volume = {
  name: "scratch", driver: "local", format: "ext4",
  provisioned: "1.1 GB", onDisk: "2 MB", source: "/vol/scratch/volume.img",
  created: "2026-07-01T00:00:00Z", inUseBy: [],
};
const IN_USE: Volume = {
  name: "pgdata", driver: "local", format: "ext4",
  provisioned: "549.8 GB", onDisk: "137 MB", source: "/vol/pgdata/volume.img",
  created: "2026-04-27T00:00:00Z", inUseBy: ["db", "backup"],
};

describe("VolumesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([FREE, IN_USE]);
    mockCreate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockPrune.mockResolvedValue("Reclaimed 2 MB in disk space");
  });

  it("lists volumes", async () => {
    render(<VolumesView />);
    expect(await screen.findByText("scratch")).toBeInTheDocument();
    expect(screen.getByText("pgdata")).toBeInTheDocument();
  });

  // The CLI's own size field is the sparse image's ceiling. Showing it alone
  // would tell someone a small database is eating half a terabyte.
  it("shows provisioned size and real disk use as separate figures", async () => {
    render(<VolumesView />);
    expect(await screen.findByText("137 MB")).toBeInTheDocument();
    expect(screen.getByText("549.8 GB")).toBeInTheDocument();
  });

  it("names the containers holding a volume", async () => {
    render(<VolumesView />);
    expect(await screen.findByText(/db, backup/)).toBeInTheDocument();
  });

  // `volume delete` on a mounted volume fails with "currently in use and
  // cannot be accessed by another container, or deleted".
  it("will not offer to delete a volume that is in use", async () => {
    render(<VolumesView />);
    await screen.findByText("pgdata");
    const rows = screen.getAllByRole("row");
    const inUseRow = rows.find(r => r.textContent?.includes("pgdata"))!;
    expect(within(inUseRow).getByRole("button", { name: /delete/i })).toBeDisabled();
  });

  it("deletes an unused volume after a confirmation", async () => {
    render(<VolumesView />);
    await screen.findByText("scratch");
    const rows = screen.getAllByRole("row");
    const freeRow = rows.find(r => r.textContent?.includes("scratch"))!;
    await userEvent.click(within(freeRow).getByRole("button", { name: /^delete$/i }));
    expect(mockDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("scratch"));
  });

  it("creates a volume with the size that was typed", async () => {
    render(<VolumesView />);
    await userEvent.click(screen.getByRole("button", { name: /\+ create/i }));
    await userEvent.type(screen.getByLabelText(/name/i), "cache");
    await userEvent.type(screen.getByLabelText(/size/i), "5G");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("cache", "5G"));
  });

  it("creates a volume without a size when the field is left empty", async () => {
    render(<VolumesView />);
    await userEvent.click(screen.getByRole("button", { name: /\+ create/i }));
    await userEvent.type(screen.getByLabelText(/name/i), "cache");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("cache", undefined));
  });

  // Prune destroys the contents of every unreferenced volume. Saying only
  // "prune unused" reads like cleaning up bookkeeping, which it is not.
  it("warns that pruning destroys data before doing it", async () => {
    render(<VolumesView />);
    await userEvent.click(screen.getByRole("button", { name: /prune unused/i }));
    expect(screen.getByText(/delete.*data|data.*delete|contents/i)).toBeInTheDocument();
    expect(mockPrune).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm prune/i }));
    await waitFor(() => expect(mockPrune).toHaveBeenCalled());
  });

  it("reports what pruning reclaimed", async () => {
    render(<VolumesView />);
    await userEvent.click(screen.getByRole("button", { name: /prune unused/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm prune/i }));
    expect(await screen.findByText(/Reclaimed 2 MB/)).toBeInTheDocument();
  });

  it("surfaces a failure from the CLI", async () => {
    mockDelete.mockRejectedValue(new Error("volume 'scratch' is currently in use"));
    render(<VolumesView />);
    await screen.findByText("scratch");
    const freeRow = screen.getAllByRole("row").find(r => r.textContent?.includes("scratch"))!;
    await userEvent.click(within(freeRow).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(await screen.findByText(/currently in use/)).toBeInTheDocument();
  });
});
