import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { RunModal } from "../../panels/RunModal";

const mock = vi.mocked(invoke);

describe("RunModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders image input", () => {
    render(<RunModal onClose={() => {}} onRun={() => {}} />);
    expect(screen.getByLabelText(/image/i)).toBeInTheDocument();
  });

  it("Run button disabled when image empty", () => {
    render(<RunModal onClose={() => {}} onRun={() => {}} />);
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();
  });

  it("calls run_container on submit", async () => {
    mock.mockResolvedValue(undefined);
    render(<RunModal onClose={() => {}} onRun={() => {}} />);
    fireEvent.change(screen.getByLabelText(/image/i), { target: { value: "nginx:latest" } });
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("run_container", expect.objectContaining({ opts: expect.objectContaining({ image: "nginx:latest" }) })));
  });

  it("Cancel calls onClose", () => {
    const fn = vi.fn();
    render(<RunModal onClose={fn} onRun={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fn).toHaveBeenCalled();
  });
});
