import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ExecPanel } from "../../panels/ExecPanel";

const mock = vi.mocked(invoke);

describe("ExecPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a command input", () => {
    render(<ExecPanel containerId="abc" />);
    expect(screen.getByRole("textbox", { name: /command/i })).toBeInTheDocument();
  });

  it("calls exec_in_container on submit", async () => {
    mock.mockResolvedValue("hello\n");
    render(<ExecPanel containerId="abc" />);
    fireEvent.change(screen.getByRole("textbox", { name: /command/i }), { target: { value: "echo hello" } });
    fireEvent.submit(screen.getByRole("textbox", { name: /command/i }).closest("form")!);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("exec_in_container", { id: "abc", command: "echo hello" }));
  });

  it("shows command output", async () => {
    mock.mockResolvedValue("hello\n");
    render(<ExecPanel containerId="abc" />);
    fireEvent.change(screen.getByRole("textbox", { name: /command/i }), { target: { value: "echo hello" } });
    fireEvent.submit(screen.getByRole("textbox", { name: /command/i }).closest("form")!);
    await waitFor(() => expect(screen.getByText(/hello/)).toBeInTheDocument());
  });

  it("input is disabled while busy", async () => {
    // mock a slow resolve so we can check mid-flight state
    let resolve: () => void;
    mock.mockReturnValue(new Promise<string>(r => { resolve = () => r("done"); }));
    render(<ExecPanel containerId="abc" />);
    const input = screen.getByRole("textbox", { name: /command/i });
    fireEvent.change(input, { target: { value: "sleep 1" } });
    fireEvent.submit(input.closest("form")!);
    expect(input).toBeDisabled();
    resolve!();
  });

  it("Run button disabled when input empty", () => {
    render(<ExecPanel containerId="abc" />);
    expect(screen.getByRole("button", { name: /run/i })).toBeDisabled();
  });

  it("shows empty state hint before any commands", () => {
    render(<ExecPanel containerId="abc" />);
    expect(screen.getByText(/run a command/i)).toBeInTheDocument();
  });

  it("shows error in terminal on exec failure", async () => {
    mock.mockRejectedValue(new Error("permission denied"));
    render(<ExecPanel containerId="abc" />);
    const input = screen.getByRole("textbox", { name: /command/i });
    fireEvent.change(input, { target: { value: "cat /root/secret" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument());
  });

  it("clears input after submit", async () => {
    mock.mockResolvedValue("ok");
    render(<ExecPanel containerId="abc" />);
    const input = screen.getByRole("textbox", { name: /command/i });
    fireEvent.change(input, { target: { value: "echo hi" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(input).toHaveValue(""));
  });
});
