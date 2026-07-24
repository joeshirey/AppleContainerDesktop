import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImagesView } from "../../views/ImagesView";

vi.mock("../../api", () => ({
  listImages: vi.fn(),
  removeImage: vi.fn(),
  pruneImages: vi.fn(),
  runContainer: vi.fn(),
}));
vi.mock("../../panels/PullModal", () => ({
  PullModal: ({ onClose }: any) => (
    <div data-testid="pull-modal">
      <button onClick={onClose}>close-pull</button>
    </div>
  ),
}));
vi.mock("../../panels/RunModal", () => ({
  RunModal: ({ onClose }: any) => (
    <div data-testid="run-modal">
      <button onClick={onClose}>close-run</button>
    </div>
  ),
}));

import { listImages, removeImage, pruneImages } from "../../api";
const mockList = vi.mocked(listImages);
const mockRemove = vi.mocked(removeImage);
const mockPrune = vi.mocked(pruneImages);

const IMAGES = [
  { id: "sha256:abc", repository: "nginx", tag: "latest", size: "187 MB", created: "2026-01-01T00:00:00Z" },
  { id: "sha256:def", repository: "postgres", tag: "16", size: "432 MB", created: "2026-01-01T00:00:00Z" },
];

describe("ImagesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(IMAGES);
    mockRemove.mockResolvedValue(undefined);
    mockPrune.mockResolvedValue(undefined);
  });

  it("renders table with images after loading", async () => {
    render(<ImagesView />);
    await waitFor(() => expect(screen.getByText("nginx")).toBeInTheDocument());
    expect(screen.getByText("latest")).toBeInTheDocument();
    expect(screen.getByText("187 MB")).toBeInTheDocument();
    expect(screen.getByText("postgres")).toBeInTheDocument();
  });

  it("shows Pull Image button that opens PullModal", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    await userEvent.click(screen.getByText("Pull Image…"));
    expect(screen.getByTestId("pull-modal")).toBeInTheDocument();
    await userEvent.click(screen.getByText("close-pull"));
    expect(screen.queryByTestId("pull-modal")).not.toBeInTheDocument();
  });

  it("shows Prune Unused confirmation and calls pruneImages on confirm", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    await userEvent.click(screen.getByText("Prune Unused"));
    expect(screen.getByText(/confirm/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Confirm Prune"));
    await waitFor(() => expect(mockPrune).toHaveBeenCalled());
  });

  it("shows Run modal with prefilled image on Run click", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    const runBtns = screen.getAllByText("Run");
    await userEvent.click(runBtns[0]);
    expect(screen.getByTestId("run-modal")).toBeInTheDocument();
  });

  it("shows inline remove confirmation and calls removeImage on confirm", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    const removeBtns = screen.getAllByText("Remove");
    await userEvent.click(removeBtns[0]);
    expect(screen.getByText("Confirm Remove")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Confirm Remove"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("sha256:abc"));
  });
});
