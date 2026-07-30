import { invoke } from "@tauri-apps/api/core";
import type { Container, ContainerEdits, ContainerStats, Image, Machine, RecreatePlan } from "./types";

// The Apple container CLI returns deeply nested JSON. These helpers normalize
// the raw CLI output into our flat types.

function normalizeContainer(raw: any): Container {
  const ports = (raw.configuration?.publishedPorts ?? []) as any[];
  const portStr = ports.length
    ? ports.map((p: any) => `${p.hostPort ?? p.containerPort}→${p.containerPort}`).join(", ")
    : undefined;
  return {
    id: raw.id ?? "",
    name: raw.id ?? "",
    image: raw.configuration?.image?.reference ?? "",
    status: raw.status?.state ?? "stopped",
    created: raw.configuration?.creationDate,
    ports: portStr,
  };
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

/// `container` only runs on Apple silicon, so the variant that will actually
/// be used is always the arm64 one.
const HOST_ARCH = "arm64";

/// The download size of the variant this Mac would run.
///
/// `configuration.descriptor.size` is the size of the OCI index — a few KB no
/// matter how large the image — so it is never the right number to show. A
/// multi-arch image carries one variant per platform plus "unknown/unknown"
/// attestation manifests, which are not images and must be skipped.
function imageSize(raw: any): number {
  const linux = (raw.variants ?? []).filter((v: any) => v?.platform?.os === "linux");
  const native = linux.find((v: any) => v.platform.architecture === HOST_ARCH);
  return (native ?? linux[0])?.size ?? 0;
}

/// Docker Hub images are conventionally written without their registry, and
/// the CLI prints them that way too. Only affects display — every action uses
/// the untouched `reference`.
function shortenRepository(repository: string): string {
  if (repository.startsWith("docker.io/library/")) return repository.slice(18);
  if (repository.startsWith("docker.io/")) return repository.slice(10);
  return repository;
}

function normalizeImage(raw: any): Image {
  const fullName: string = raw.configuration?.name ?? "";
  // A registry may carry a port ("localhost:5000/app"), so only a colon that
  // comes after the last slash separates the tag.
  const lastColon = fullName.lastIndexOf(":");
  const hasTag = lastColon > 0 && lastColon > fullName.lastIndexOf("/");
  const repository = hasTag ? fullName.slice(0, lastColon) : fullName;
  const tag = hasTag ? fullName.slice(lastColon + 1) : "latest";
  return {
    id: raw.id ?? "",
    reference: fullName ? (hasTag ? fullName : `${fullName}:${tag}`) : "",
    repository: shortenRepository(repository),
    tag,
    size: formatSize(imageSize(raw)),
    created: raw.configuration?.creationDate ?? "",
  };
}

export const listContainers = (): Promise<Container[]> =>
  invoke<any[]>("list_containers").then(arr => (arr ?? []).map(normalizeContainer));

export const startContainer = (id: string): Promise<void> => invoke("start_container", { id });
export const stopContainer = (id: string): Promise<void> => invoke("stop_container", { id });
export const removeContainer = (id: string): Promise<void> => invoke("remove_container", { id });
export const getLogs = (id: string, lines: number): Promise<string> => invoke("get_logs", { id, lines });
export const execInContainer = (id: string, command: string): Promise<string> => invoke("exec_in_container", { id, command });
export const getStats = (id: string): Promise<ContainerStats> => invoke("get_stats", { id });
export const inspectContainer = (id: string): Promise<Record<string, unknown>> => invoke("inspect_container", { id });
export const runContainer = (opts: {
  image: string; name?: string; ports?: string[]; env?: string[];
  cpus?: number; memory?: string; detach: boolean;
}): Promise<void> => invoke("run_container", { opts });

/// Preview the recreate of a container without changing anything.
export const planRecreate = (id: string, edits: ContainerEdits): Promise<RecreatePlan> =>
  invoke("plan_recreate", { id, edits });

/// Replace a container, applying `edits` and carrying over every other setting.
export const recreateContainer = (id: string, edits: ContainerEdits): Promise<void> =>
  invoke("recreate_container", { id, edits });
export const listImages = (): Promise<Image[]> =>
  invoke<any[]>("list_images").then(arr => (arr ?? []).map(normalizeImage));
export const removeImage = (reference: string): Promise<void> =>
  invoke("remove_image", { reference });
export const pullImage = (name: string): Promise<void> => invoke("pull_image", { name });
export const pruneImages = (): Promise<void> => invoke("prune_images");
function normalizeMachine(raw: any): Machine {
  return {
    name: raw.id ?? raw.name ?? "",
    status: raw.status?.state ?? (typeof raw.status === "string" ? raw.status : "stopped"),
    isDefault: raw.isDefault ?? raw.default ?? false,
    cpus: raw.configuration?.cpus,
    memoryMB: raw.configuration?.memoryInBytes
      ? Math.round(raw.configuration.memoryInBytes / (1024 * 1024))
      : undefined,
  };
}

export const listMachines = (): Promise<Machine[]> =>
  invoke<any[]>("list_machines").then(arr => (arr ?? []).map(normalizeMachine));
export const inspectMachine = (name: string): Promise<Record<string, unknown>> =>
  invoke("inspect_machine", { name });
export const createMachine = (opts: { image: string; name?: string; cpus?: number; memory?: string }): Promise<void> =>
  invoke("create_machine", { image: opts.image, name: opts.name, cpus: opts.cpus, memory: opts.memory });
export const stopMachine = (name: string): Promise<void> => invoke("stop_machine", { name });
export const deleteMachine = (name: string): Promise<void> => invoke("delete_machine", { name });
export const setDefaultMachine = (name: string): Promise<void> => invoke("set_default_machine", { name });
export const checkSystemStatus = (): Promise<{ status: string }> => invoke("check_system_status");
export const startSystem = (): Promise<void> => invoke("start_system");
export const stopSystem = (): Promise<void> => invoke("stop_system");
export const searchHub = (query: string): Promise<{ results: any[] }> =>
  invoke("search_hub", { query });
export const getHubTags = (name: string): Promise<{ results: { name: string }[] }> =>
  invoke("get_hub_tags", { name });
