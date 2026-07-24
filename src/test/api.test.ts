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
  pruneImages,
  listMachines,
  checkSystemStatus,
  startSystem,
  inspectMachine,
  createMachine,
  stopMachine,
  deleteMachine,
  setDefaultMachine,
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

  it("listContainers normalizes nested CLI JSON into flat Container", async () => {
    mockInvoke.mockResolvedValue([{
      id: "nginx",
      configuration: { image: { reference: "nginx:latest" }, creationDate: "2026-01-01T00:00:00Z", publishedPorts: [] },
      status: { state: "running" },
    }]);
    const result = await listContainers();
    expect(result[0].id).toBe("nginx");
    expect(result[0].name).toBe("nginx");
    expect(result[0].image).toBe("nginx:latest");
    expect(result[0].status).toBe("running");
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

  it("listImages normalizes nested CLI JSON into flat Image", async () => {
    mockInvoke.mockResolvedValue([{
      id: "sha256:35b8ff",
      configuration: {
        name: "docker.io/library/debian:latest",
        creationDate: "2026-04-21T00:00:00Z",
        descriptor: { size: 8933 }
      }
    }]);
    const result = await listImages();
    expect(result[0].id).toBe("sha256:35b8ff");
    expect(result[0].repository).toBe("docker.io/library/debian");
    expect(result[0].tag).toBe("latest");
    expect(result[0].size).toBe("9 KB");
  });

  // pruneImages
  it("pruneImages calls invoke with prune_images", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await pruneImages();
    expect(mockInvoke).toHaveBeenCalledWith("prune_images");
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

  // inspectMachine
  it("inspectMachine calls invoke with inspect_machine and name", async () => {
    mockInvoke.mockResolvedValue({});
    await inspectMachine("my-machine");
    expect(mockInvoke).toHaveBeenCalledWith("inspect_machine", { name: "my-machine" });
  });

  // createMachine
  it("createMachine calls invoke with create_machine and opts", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await createMachine({ image: "alpine:3.22", name: "test" });
    expect(mockInvoke).toHaveBeenCalledWith("create_machine", { image: "alpine:3.22", name: "test", cpus: undefined, memory: undefined });
  });

  // stopMachine
  it("stopMachine calls invoke with stop_machine and name", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await stopMachine("my-machine");
    expect(mockInvoke).toHaveBeenCalledWith("stop_machine", { name: "my-machine" });
  });

  // deleteMachine
  it("deleteMachine calls invoke with delete_machine and name", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteMachine("my-machine");
    expect(mockInvoke).toHaveBeenCalledWith("delete_machine", { name: "my-machine" });
  });

  // setDefaultMachine
  it("setDefaultMachine calls invoke with set_default_machine and name", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setDefaultMachine("my-machine");
    expect(mockInvoke).toHaveBeenCalledWith("set_default_machine", { name: "my-machine" });
  });

  // listMachines normalization
  it("listMachines normalizes nested CLI JSON into flat Machine", async () => {
    mockInvoke.mockResolvedValue([{
      id: "my-machine",
      configuration: { cpus: 4, memoryInBytes: 4294967296 },
      status: { state: "running" },
      isDefault: true,
    }]);
    const result = await listMachines();
    expect(result[0].name).toBe("my-machine");
    expect(result[0].status).toBe("running");
    expect(result[0].isDefault).toBe(true);
    expect(result[0].cpus).toBe(4);
    expect(result[0].memoryMB).toBe(4096);
  });
});
