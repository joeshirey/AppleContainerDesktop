import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkSystemStatus, listContainers, listImages, listMachines, listNetworks, listVolumes } from "../api";
import containers from "./fixtures/container-1.4.1/containers.json";
import images from "./fixtures/container-1.4.1/images.json";
import machines from "./fixtures/container-1.4.1/machines.json";
import networks from "./fixtures/container-1.4.1/networks.json";
import volumes from "./fixtures/container-1.4.1/volumes.json";
import status from "./fixtures/container-1.4.1/system-running.json";

const mock = vi.mocked(invoke);

describe("captured container 1.4.1 JSON", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads container state and published ports", async () => {
    mock.mockResolvedValue(containers);
    expect((await listContainers())[0]).toMatchObject({
      id: "compat-test", status: "running", image: "docker.io/library/alpine:latest", ports: "18741→8080",
    });
  });

  it("reads native image size and reference", async () => {
    mock.mockResolvedValue(images);
    expect((await listImages())[0]).toMatchObject({ reference: "docker.io/library/alpine:latest", size: "4 MB" });
  });

  it("reads flat machine resource fields", async () => {
    mock.mockResolvedValue(machines);
    expect((await listMachines())[0]).toMatchObject({
      name: "compat-test-vm", cpus: 2, memoryMB: 2048, isDefault: true, status: "running",
    });
  });

  it("reads volume capacity and source", async () => {
    mock.mockResolvedValue(volumes);
    expect((await listVolumes())[0]).toMatchObject({ name: "compat-test", provisioned: "1.1 GB", format: "ext4" });
  });

  it("reads network configuration and addressing", async () => {
    mock.mockResolvedValue(networks);
    expect((await listNetworks()).find(n => n.name === "default")).toMatchObject({
      mode: "nat", subnet: "192.168.64.0/24", gateway: "192.168.64.1",
    });
  });

  it("accepts the expanded system status payload", async () => {
    mock.mockResolvedValue(status);
    expect((await checkSystemStatus()).status).toBe("running");
  });
});
