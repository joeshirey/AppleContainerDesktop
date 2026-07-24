import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "../../views/SettingsView";

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders poll interval and log lines settings", async () => {
    render(<SettingsView />);
    await waitFor(() => expect(screen.getByText(/poll interval/i)).toBeInTheDocument());
    expect(screen.getByText(/log lines/i)).toBeInTheDocument();
  });

  it("shows default poll interval of 5 seconds", async () => {
    render(<SettingsView />);
    await waitFor(() => {
      const selects = screen.getAllByRole("combobox");
      expect(selects[0]).toHaveValue("5000");
    });
  });

  it("shows default log lines of 100", async () => {
    render(<SettingsView />);
    await waitFor(() => {
      const selects = screen.getAllByRole("combobox");
      expect(selects[1]).toHaveValue("100");
    });
  });

  it("updates poll interval when changed", async () => {
    render(<SettingsView />);
    await waitFor(() => screen.getAllByRole("combobox")[0]);
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "10000");
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("10000");
  });
});
