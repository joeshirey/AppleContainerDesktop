import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkSystemStatus, listContainers, listImages, listMachines, listNetworks, listVolumes } from "../api";

const mock = vi.mocked(invoke);

// Each captured CLI version lives in fixtures/container-<version>/.
const fixtures = import.meta.glob<unknown>("./fixtures/container-*/*.json", { eager: true, import: "default" });
const versions = [...new Set(Object.keys(fixtures).map(path => path.split("/")[2].slice("container-".length)))];
const fixture = (version: string, name: string) => fixtures[`./fixtures/container-${version}/${name}.json`];

it("covers every supported CLI version", () => {
  expect(versions).toEqual(expect.arrayContaining(["1.4.1", "1.5.0"]));
});

describe.each(versions)("captured container %s JSON", version => {
  beforeEach(() => vi.clearAllMocks());

  it("reads container state and published ports", async () => {
    mock.mockResolvedValue(fixture(version, "containers"));
    expect((await listContainers())[0]).toMatchObject({
      id: "compat-test", status: "running", image: "docker.io/library/alpine:latest", ports: "18741→8080",
    });
  });

  it("reads native image size and reference", async () => {
    mock.mockResolvedValue(fixture(version, "images"));
    expect((await listImages())[0]).toMatchObject({ reference: "docker.io/library/alpine:latest", size: "4 MB" });
  });

  it("reads flat machine resource fields", async () => {
    mock.mockResolvedValue(fixture(version, "machines"));
    expect((await listMachines())[0]).toMatchObject({
      name: "compat-test-vm", cpus: 2, memoryMB: 2048, isDefault: true, status: "running",
    });
  });

  it("reads volume capacity and source", async () => {
    mock.mockResolvedValue(fixture(version, "volumes"));
    expect((await listVolumes())[0]).toMatchObject({ name: "compat-test", provisioned: "1.1 GB", format: "ext4" });
  });

  it("reads network configuration and addressing", async () => {
    mock.mockResolvedValue(fixture(version, "networks"));
    expect((await listNetworks()).find(n => n.name === "default")).toMatchObject({
      mode: "nat", subnet: "192.168.64.0/24", gateway: "192.168.64.1",
    });
  });

  it("accepts the expanded system status payload", async () => {
    mock.mockResolvedValue(fixture(version, "system-running"));
    expect((await checkSystemStatus()).status).toBe("running");
  });
});
