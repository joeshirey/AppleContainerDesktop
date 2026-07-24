import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  listContainers,
  startContainer,
  stopContainer,
  removeContainer,
  getLogs,
  execInContainer,
  getStats,
  inspectContainer,
  runContainer,
  listImages,
  removeImage,
  pullImage,
  listMachines,
  checkSystemStatus,
  startSystem,
} from "../api";

const mockInvoke = vi.mocked(invoke);

describe("api", () => {
  beforeEach(() => vi.clearAllMocks());

  // listContainers
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

  // startContainer
  it("startContainer calls invoke with start_container and id", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await startContainer("abc");
    expect(mockInvoke).toHaveBeenCalledWith("start_container", { id: "abc" });
  });

  // stopContainer
  it("stopContainer calls invoke with stop_container and id", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await stopContainer("abc");
    expect(mockInvoke).toHaveBeenCalledWith("stop_container", { id: "abc" });
  });

  // removeContainer
  it("removeContainer calls invoke with remove_container and id", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await removeContainer("abc");
    expect(mockInvoke).toHaveBeenCalledWith("remove_container", { id: "abc" });
  });

  // getLogs
  it("getLogs calls invoke with get_logs, id, and lines", async () => {
    mockInvoke.mockResolvedValue("log output");
    await getLogs("abc", 100);
    expect(mockInvoke).toHaveBeenCalledWith("get_logs", { id: "abc", lines: 100 });
  });

  // execInContainer
  it("execInContainer calls invoke with exec_in_container, id, and command", async () => {
    mockInvoke.mockResolvedValue("output");
    await execInContainer("abc", "ls -la");
    expect(mockInvoke).toHaveBeenCalledWith("exec_in_container", { id: "abc", command: "ls -la" });
  });

  // getStats
  it("getStats calls invoke with get_stats and id", async () => {
    mockInvoke.mockResolvedValue({ cpu_percent: 5.2, memory_usage: "128MiB" });
    await getStats("abc");
    expect(mockInvoke).toHaveBeenCalledWith("get_stats", { id: "abc" });
  });

  // inspectContainer
  it("inspectContainer calls invoke with inspect_container and id", async () => {
    mockInvoke.mockResolvedValue({ id: "abc", configuration: {} });
    await inspectContainer("abc");
    expect(mockInvoke).toHaveBeenCalledWith("inspect_container", { id: "abc" });
  });

  // runContainer
  it("runContainer calls invoke with run_container and opts", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await runContainer({ image: "nginx:latest", detach: true });
    expect(mockInvoke).toHaveBeenCalledWith("run_container", { opts: { image: "nginx:latest", detach: true } });
  });

  // listImages
  it("listImages calls invoke with list_images", async () => {
    mockInvoke.mockResolvedValue([]);
    const result = await listImages();
    expect(mockInvoke).toHaveBeenCalledWith("list_images");
    expect(result).toEqual([]);
  });

  // removeImage
  it("removeImage calls invoke with remove_image and id", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await removeImage("sha256:abc");
    expect(mockInvoke).toHaveBeenCalledWith("remove_image", { id: "sha256:abc" });
  });

  // pullImage
  it("pullImage calls invoke with pull_image and name", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await pullImage("nginx:latest");
    expect(mockInvoke).toHaveBeenCalledWith("pull_image", { name: "nginx:latest" });
  });

  // listMachines
  it("listMachines calls invoke with list_machines", async () => {
    mockInvoke.mockResolvedValue([]);
    const result = await listMachines();
    expect(mockInvoke).toHaveBeenCalledWith("list_machines");
    expect(result).toEqual([]);
  });

  // checkSystemStatus
  it("checkSystemStatus calls invoke with check_system_status", async () => {
    mockInvoke.mockResolvedValue({ status: "running" });
    const result = await checkSystemStatus();
    expect(mockInvoke).toHaveBeenCalledWith("check_system_status");
    expect(result.status).toBe("running");
  });

  // startSystem
  it("startSystem calls invoke with start_system", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await startSystem();
    expect(mockInvoke).toHaveBeenCalledWith("start_system");
  });
});
