import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ExecPanel } from "../../panels/ExecPanel";

const mock = vi.mocked(invoke);

describe("ExecPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a command input", () => {
    render(<ExecPanel containerId="abc" />);
    expect(screen.getByPlaceholderText(/command/i)).toBeInTheDocument();
  });

  it("calls exec_in_container on submit", async () => {
    mock.mockResolvedValue("hello\n");
    render(<ExecPanel containerId="abc" />);
    fireEvent.change(screen.getByPlaceholderText(/command/i), { target: { value: "echo hello" } });
    fireEvent.submit(screen.getByPlaceholderText(/command/i).closest("form")!);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("exec_in_container", { id: "abc", command: "echo hello" }));
  });

  it("shows command output", async () => {
    mock.mockResolvedValue("hello\n");
    render(<ExecPanel containerId="abc" />);
    fireEvent.change(screen.getByPlaceholderText(/command/i), { target: { value: "echo hello" } });
    fireEvent.submit(screen.getByPlaceholderText(/command/i).closest("form")!);
    await waitFor(() => expect(screen.getByText(/hello/)).toBeInTheDocument());
  });
});
