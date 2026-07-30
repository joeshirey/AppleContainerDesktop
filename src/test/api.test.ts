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
  searchHub,
  machineRun,
  getMachineLogs,
  setMachineConfig,
  listVolumes,
  createVolume,
  deleteVolume,
  pruneVolumes,
  listNetworks,
  createNetwork,
  deleteNetwork,
  pruneNetworks,
} from "../api";

/// Trimmed to the fields we read, but the names and value shapes are copied
/// from a live `GET /api/search/v4?query=nginx` response.
const V4_NGINX = {
  id: "library/nginx",
  slug: "nginx",
  type: "image",
  badge: "official",
  short_description: "Official build of Nginx.",
  star_count: 21347,
  raw_pull_count: 13198322582,
  pull_count: "1B+",
  archived: false,
};

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
    expect(result[0].missingBindMounts).toEqual([]);
  });

  // The backend tags these rather than hiding them, so the UI can warn about
  // a container instead of pretending it does not exist.
  it("listContainers carries through missing bind-mount paths", async () => {
    mockInvoke.mockResolvedValue([{
      id: "broken",
      configuration: { image: { reference: "nginx:latest" } },
      status: { state: "stopped" },
      missingBindMounts: ["/Users/me/gone", "/tmp/also-gone"],
    }]);
    const result = await listContainers();
    expect(result[0].missingBindMounts).toEqual(["/Users/me/gone", "/tmp/also-gone"]);
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
      },
      variants: [{ platform: { os: "linux", architecture: "arm64" }, size: 49670752 }],
    }]);
    const result = await listImages();
    expect(result[0].id).toBe("sha256:35b8ff");
    expect(result[0].repository).toBe("debian");
    expect(result[0].tag).toBe("latest");
    expect(result[0].size).toBe("50 MB");
    expect(result[0].created).toBe("2026-04-21T00:00:00Z");
  });

  // The CLI's `image delete` takes a reference, not a digest, so the raw
  // `configuration.name` has to survive normalization intact.
  it("listImages keeps the full image reference for the CLI to act on", async () => {
    mockInvoke.mockResolvedValue([{
      id: "sha256:35b8ff",
      configuration: { name: "docker.io/library/debian:latest", descriptor: { size: 8933 } }
    }]);
    const result = await listImages();
    expect(result[0].reference).toBe("docker.io/library/debian:latest");
  });

  // `configuration.descriptor.size` is the size of the OCI *index* — a few KB
  // regardless of the image. The real figure lives on the platform variant.
  it("listImages sizes an image from its native variant, not the index", async () => {
    mockInvoke.mockResolvedValue([{
      id: "1",
      configuration: { name: "debian:latest", descriptor: { size: 8933 } },
      variants: [{ platform: { os: "linux", architecture: "arm64", variant: "v8" }, size: 49670752 }],
    }]);
    const result = await listImages();
    expect(result[0].size).toBe("50 MB");
  });

  it("listImages picks the arm64 variant out of a multi-arch image", async () => {
    mockInvoke.mockResolvedValue([{
      id: "1",
      configuration: { name: "postgres:latest", descriptor: { size: 10229 } },
      variants: [
        { platform: { os: "linux", architecture: "amd64" }, size: 162365458 },
        { platform: { os: "unknown", architecture: "unknown" }, size: 6010555 },
        { platform: { os: "linux", architecture: "arm64", variant: "v8" }, size: 160971905 },
        { platform: { os: "linux", architecture: "s390x" }, size: 177019044 },
      ],
    }]);
    const result = await listImages();
    expect(result[0].size).toBe("161 MB");
  });

  it("listImages falls back to another linux variant when there is no arm64", async () => {
    mockInvoke.mockResolvedValue([{
      id: "1",
      configuration: { name: "old:latest", descriptor: { size: 500 } },
      variants: [
        { platform: { os: "unknown", architecture: "unknown" }, size: 6010555 },
        { platform: { os: "linux", architecture: "amd64" }, size: 12000000 },
      ],
    }]);
    const result = await listImages();
    expect(result[0].size).toBe("12 MB");
  });

  it("listImages shows no size rather than the index size when no variant fits", async () => {
    mockInvoke.mockResolvedValue([{
      id: "1",
      configuration: { name: "weird:latest", descriptor: { size: 8933 } },
      variants: [{ platform: { os: "unknown", architecture: "unknown" }, size: 6010555 }],
    }]);
    const result = await listImages();
    expect(result[0].size).toBe("—");
  });

  it("listImages formats sizes past a gigabyte as GB", async () => {
    mockInvoke.mockResolvedValue([{
      id: "1",
      configuration: { name: "big:latest", descriptor: { size: 500 } },
      variants: [{ platform: { os: "linux", architecture: "arm64" }, size: 2_500_000_000 }],
    }]);
    const result = await listImages();
    expect(result[0].size).toBe("2.5 GB");
  });

  // The CLI itself prints "debian", not "docker.io/library/debian".
  it("listImages shortens Docker Hub names for display but keeps the reference", async () => {
    mockInvoke.mockResolvedValue([
      { id: "1", configuration: { name: "docker.io/library/debian:latest", descriptor: { size: 1 } } },
      { id: "2", configuration: { name: "docker.io/joeshirey/thing:v1", descriptor: { size: 1 } } },
      { id: "3", configuration: { name: "ghcr.io/astral-sh/uv:0.11.3", descriptor: { size: 1 } } },
    ]);
    const result = await listImages();
    expect(result[0].repository).toBe("debian");
    expect(result[0].reference).toBe("docker.io/library/debian:latest");
    expect(result[1].repository).toBe("joeshirey/thing");
    expect(result[1].reference).toBe("docker.io/joeshirey/thing:v1");
    // Other registries stay fully qualified, exactly as the CLI shows them.
    expect(result[2].repository).toBe("ghcr.io/astral-sh/uv");
  });

  // A registry port contains a colon, so the tag separator is the last colon
  // *after* the last slash — not simply the last colon.
  it("listImages does not mistake a registry port for a tag", async () => {
    mockInvoke.mockResolvedValue([
      { id: "1", configuration: { name: "localhost:5000/myapp", descriptor: { size: 100 } } },
      { id: "2", configuration: { name: "localhost:5000/myapp:v2", descriptor: { size: 100 } } },
    ]);
    const result = await listImages();
    expect(result[0].repository).toBe("localhost:5000/myapp");
    expect(result[0].tag).toBe("latest");
    expect(result[0].reference).toBe("localhost:5000/myapp:latest");
    expect(result[1].repository).toBe("localhost:5000/myapp");
    expect(result[1].tag).toBe("v2");
    expect(result[1].reference).toBe("localhost:5000/myapp:v2");
  });

  it("listImages falls back to repository:tag when the name has no tag", async () => {
    mockInvoke.mockResolvedValue([{
      id: "sha256:aaa",
      configuration: { name: "windharbor-base", descriptor: { size: 375 } }
    }]);
    const result = await listImages();
    expect(result[0].reference).toBe("windharbor-base:latest");
  });

  // pruneImages
  it("pruneImages calls invoke with prune_images", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await pruneImages();
    expect(mockInvoke).toHaveBeenCalledWith("prune_images");
  });

  // removeImage
  it("removeImage calls invoke with remove_image and a reference", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await removeImage("docker.io/library/debian:latest");
    expect(mockInvoke).toHaveBeenCalledWith("remove_image", {
      reference: "docker.io/library/debian:latest",
    });
  });

  // searchHub — Docker Hub search API v4
  it("searchHub maps a v4 result onto the fields the view renders", async () => {
    mockInvoke.mockResolvedValue({ results: [V4_NGINX] });
    const [r] = await searchHub("nginx");
    expect(mockInvoke).toHaveBeenCalledWith("search_hub", { query: "nginx" });
    expect(r).toEqual({
      name: "library/nginx",
      displayName: "nginx",
      description: "Official build of Nginx.",
      isOfficial: true,
      pullCount: 13198322582,
      starCount: 21347,
    });
  });

  it("searchHub reads official from the v4 badge, not is_official", async () => {
    mockInvoke.mockResolvedValue({
      results: [{ ...V4_NGINX, badge: "verified_publisher", id: "grafana/grafana", slug: "grafana/grafana" }],
    });
    const [r] = await searchHub("grafana");
    expect(r.isOfficial).toBe(false);
    expect(r.displayName).toBe("grafana/grafana");
  });

  it("searchHub drops hardened and extension results, which cannot be pulled", async () => {
    mockInvoke.mockResolvedValue({
      results: [
        { ...V4_NGINX, id: "dhi/nginx", slug: "dhi/nginx", type: "dhi", badge: "hardened" },
        { ...V4_NGINX, id: "extension/nginx/x", slug: "nginx/x", type: "extension" },
        V4_NGINX,
      ],
    });
    const results = await searchHub("nginx");
    expect(results.map(r => r.name)).toEqual(["library/nginx"]);
  });

  it("searchHub drops archived repositories", async () => {
    mockInvoke.mockResolvedValue({
      results: [{ ...V4_NGINX, id: "old/thing", slug: "old/thing", archived: true }, V4_NGINX],
    });
    const results = await searchHub("nginx");
    expect(results.map(r => r.name)).toEqual(["library/nginx"]);
  });

  it("searchHub sorts official first, then by pull count", async () => {
    mockInvoke.mockResolvedValue({
      results: [
        { ...V4_NGINX, id: "a/small", slug: "a/small", badge: "none", raw_pull_count: 10 },
        { ...V4_NGINX, id: "a/big", slug: "a/big", badge: "none", raw_pull_count: 999 },
        V4_NGINX,
      ],
    });
    const results = await searchHub("nginx");
    expect(results.map(r => r.displayName)).toEqual(["nginx", "a/big", "a/small"]);
  });

  it("searchHub survives a result missing every optional field", async () => {
    mockInvoke.mockResolvedValue({ results: [{ id: "bare/repo", type: "image" }] });
    const [r] = await searchHub("bare");
    expect(r).toEqual({
      name: "bare/repo",
      displayName: "bare/repo",
      description: "",
      isOfficial: false,
      pullCount: 0,
      starCount: 0,
    });
  });

  it("searchHub returns an empty list when the API sends no results array", async () => {
    mockInvoke.mockResolvedValue({ total: 0 });
    expect(await searchHub("xyzzy")).toEqual([]);
  });

  // machineRun / getMachineLogs / setMachineConfig
  it("machineRun sends the command to a named machine and returns its output", async () => {
    mockInvoke.mockResolvedValue("Linux\n");
    const out = await machineRun("gui-dev", "uname -a | tr a-z A-Z");
    expect(mockInvoke).toHaveBeenCalledWith("machine_run", {
      name: "gui-dev",
      command: "uname -a | tr a-z A-Z",
    });
    expect(out).toBe("Linux\n");
  });

  it("getMachineLogs asks for the stdio log by default", async () => {
    mockInvoke.mockResolvedValue("line\n");
    await getMachineLogs("gui-dev", 100, false);
    expect(mockInvoke).toHaveBeenCalledWith("get_machine_logs", {
      name: "gui-dev",
      lines: 100,
      boot: false,
    });
  });

  it("getMachineLogs can ask for the boot log", async () => {
    mockInvoke.mockResolvedValue("booting\n");
    await getMachineLogs("gui-dev", 50, true);
    expect(mockInvoke).toHaveBeenCalledWith("get_machine_logs", {
      name: "gui-dev",
      lines: 50,
      boot: true,
    });
  });

  it("setMachineConfig passes only the settings that were edited", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setMachineConfig("gui-dev", { memory: "8G" });
    expect(mockInvoke).toHaveBeenCalledWith("set_machine_config", {
      name: "gui-dev",
      cpus: undefined,
      memory: "8G",
      homeMount: undefined,
    });
  });

  it("setMachineConfig passes all three settings when all were edited", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setMachineConfig("gui-dev", { cpus: 4, memory: "8G", homeMount: "ro" });
    expect(mockInvoke).toHaveBeenCalledWith("set_machine_config", {
      name: "gui-dev",
      cpus: 4,
      memory: "8G",
      homeMount: "ro",
    });
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

  /// Field names and value shapes copied from a live `container volume ls
  /// --format json`, plus the two fields the Rust side annotates on.
  const RAW_VOLUME = {
    id: "pgdata",
    configuration: {
      creationDate: "2026-04-27T01:30:22Z",
      driver: "local",
      format: "ext4",
      labels: {},
      name: "pgdata",
      options: { size: "512G" },
      sizeInBytes: 549755813888,
      source: "/Users/me/Library/Application Support/com.apple.container/volumes/pgdata/volume.img",
    },
    inUseBy: ["db"],
    diskUsageBytes: 137400000,
  };

  it("listVolumes flattens the CLI's nested volume JSON", async () => {
    mockInvoke.mockResolvedValue([RAW_VOLUME]);
    const [v] = await listVolumes();
    expect(v.name).toBe("pgdata");
    expect(v.driver).toBe("local");
    expect(v.format).toBe("ext4");
    expect(v.source).toBe(RAW_VOLUME.configuration.source);
    expect(v.inUseBy).toEqual(["db"]);
  });

  // The single most misleading number in the CLI's output: a volume image is
  // sparse, so its declared size is a ceiling, not consumption.
  it("listVolumes keeps provisioned size and real disk use apart", async () => {
    mockInvoke.mockResolvedValue([RAW_VOLUME]);
    const [v] = await listVolumes();
    expect(v.provisioned).toBe("549.8 GB");
    expect(v.onDisk).toBe("137 MB");
  });

  it("listVolumes reports unknown disk use rather than guessing zero", async () => {
    mockInvoke.mockResolvedValue([{ ...RAW_VOLUME, diskUsageBytes: undefined }]);
    const [v] = await listVolumes();
    expect(v.onDisk).toBe("—");
  });

  it("createVolume sends the name, and a size only when one was given", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await createVolume("data", "10G");
    expect(mockInvoke).toHaveBeenCalledWith("create_volume", { name: "data", size: "10G" });
    await createVolume("data");
    expect(mockInvoke).toHaveBeenCalledWith("create_volume", { name: "data", size: undefined });
  });

  it("deleteVolume and pruneVolumes call their commands", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteVolume("data");
    expect(mockInvoke).toHaveBeenCalledWith("delete_volume", { name: "data" });
    mockInvoke.mockResolvedValue("Reclaimed 137.4 MB in disk space");
    expect(await pruneVolumes()).toContain("Reclaimed");
    expect(mockInvoke).toHaveBeenCalledWith("prune_volumes");
  });

  const RAW_NETWORK = {
    id: "default",
    configuration: {
      creationDate: "2026-07-29T20:58:18Z",
      labels: { "com.apple.container.resource.role": "builtin" },
      mode: "nat",
      name: "default",
      options: {},
      plugin: "container-network-vmnet",
    },
    status: {
      ipv4Gateway: "192.168.64.1",
      ipv4Subnet: "192.168.64.0/24",
      ipv6Subnet: "fd84:d933:bb9e:f441::/64",
    },
    inUseBy: ["web"],
    isBuiltin: true,
  };

  it("listNetworks flattens the CLI's nested network JSON", async () => {
    mockInvoke.mockResolvedValue([RAW_NETWORK]);
    const [n] = await listNetworks();
    expect(n.name).toBe("default");
    expect(n.mode).toBe("nat");
    expect(n.subnet).toBe("192.168.64.0/24");
    expect(n.gateway).toBe("192.168.64.1");
    expect(n.isBuiltin).toBe(true);
    expect(n.inUseBy).toEqual(["web"]);
  });

  // A network that has never come up has no `status` block at all.
  it("listNetworks copes with a network that has no status yet", async () => {
    mockInvoke.mockResolvedValue([{ ...RAW_NETWORK, status: undefined }]);
    const [n] = await listNetworks();
    expect(n.subnet).toBeUndefined();
    expect(n.gateway).toBeUndefined();
  });

  it("createNetwork sends subnet and internal only when set", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await createNetwork("web", { subnet: "10.1.0.0/24", internal: true });
    expect(mockInvoke).toHaveBeenCalledWith("create_network", {
      name: "web", subnet: "10.1.0.0/24", internal: true,
    });
    await createNetwork("web", {});
    expect(mockInvoke).toHaveBeenCalledWith("create_network", {
      name: "web", subnet: undefined, internal: false,
    });
  });

  it("deleteNetwork and pruneNetworks call their commands", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteNetwork("web");
    expect(mockInvoke).toHaveBeenCalledWith("delete_network", { name: "web" });
    mockInvoke.mockResolvedValue("");
    await pruneNetworks();
    expect(mockInvoke).toHaveBeenCalledWith("prune_networks");
  });
});
