import "@testing-library/jest-dom";
import { vi } from "vitest";

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));
