import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listContainers } from "../api";

const mockInvoke = vi.mocked(invoke);

describe("api", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listContainers calls invoke with list_containers", async () => {
    mockInvoke.mockResolvedValue([]);
    const result = await listContainers();
    expect(mockInvoke).toHaveBeenCalledWith("list_containers");
    expect(result).toEqual([]);
  });

  it("listContainers returns typed containers", async () => {
    mockInvoke.mockResolvedValue([{ id: "abc", name: "nginx", image: "nginx:latest", status: "running" }]);
    const result = await listContainers();
    expect(result[0].name).toBe("nginx");
  });
});
