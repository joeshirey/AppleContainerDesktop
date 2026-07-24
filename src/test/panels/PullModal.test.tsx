import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PullModal } from "../../panels/PullModal";

vi.mock("../../api", () => ({
  pullImage: vi.fn(),
}));

import { pullImage } from "../../api";
const mockPull = vi.mocked(pullImage);

describe("PullModal", () => {
  const onClose = vi.fn();
  const onPulled = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPull.mockResolvedValue(undefined);
  });

  it("renders image name input and Pull button", () => {
    render(<PullModal onClose={onClose} onPulled={onPulled} />);
    expect(screen.getByPlaceholderText(/e\.g\./i)).toBeInTheDocument();
    expect(screen.getByText("Pull")).toBeInTheDocument();
  });

  it("disables Pull button when input is empty", () => {
    render(<PullModal onClose={onClose} onPulled={onPulled} />);
    expect(screen.getByText("Pull")).toBeDisabled();
  });

  it("calls pullImage and onPulled on submit", async () => {
    render(<PullModal onClose={onClose} onPulled={onPulled} />);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\./i), "nginx:latest");
    await userEvent.click(screen.getByText("Pull"));
    await waitFor(() => expect(mockPull).toHaveBeenCalledWith("nginx:latest"));
    expect(onPulled).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error message when pullImage rejects", async () => {
    mockPull.mockRejectedValue(new Error("not found"));
    render(<PullModal onClose={onClose} onPulled={onPulled} />);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\./i), "bad:image");
    await userEvent.click(screen.getByText("Pull"));
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  it("calls onClose when Cancel is clicked", async () => {
    render(<PullModal onClose={onClose} onPulled={onPulled} />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});
