import { invoke } from "@tauri-apps/api/core";
import type { Container, ContainerStats, Image, Machine } from "./types";

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
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function normalizeImage(raw: any): Image {
  const fullName: string = raw.configuration?.name ?? "";
  const lastColon = fullName.lastIndexOf(":");
  const repository = lastColon > 0 ? fullName.slice(0, lastColon) : fullName;
  const tag = lastColon > 0 ? fullName.slice(lastColon + 1) : "latest";
  return {
    id: raw.id ?? "",
    repository,
    tag,
    size: formatSize(raw.configuration?.descriptor?.size ?? 0),
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
export const listImages = (): Promise<Image[]> =>
  invoke<any[]>("list_images").then(arr => (arr ?? []).map(normalizeImage));
export const removeImage = (id: string): Promise<void> => invoke("remove_image", { id });
export const pullImage = (name: string): Promise<void> => invoke("pull_image", { name });
export const pruneImages = (): Promise<void> => invoke("prune_images");
export const listMachines = (): Promise<Machine[]> => invoke("list_machines");
export const checkSystemStatus = (): Promise<{ status: string }> => invoke("check_system_status");
export const startSystem = (): Promise<void> => invoke("start_system");
