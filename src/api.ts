import { invoke } from "@tauri-apps/api/core";
import type { Container, ContainerStats, Image, Machine } from "./types";

export const listContainers = (): Promise<Container[]> => invoke("list_containers");
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
export const listImages = (): Promise<Image[]> => invoke("list_images");
export const removeImage = (id: string): Promise<void> => invoke("remove_image", { id });
export const pullImage = (name: string): Promise<void> => invoke("pull_image", { name });
export const listMachines = (): Promise<Machine[]> => invoke("list_machines");
export const checkSystemStatus = (): Promise<{ status: string }> => invoke("check_system_status");
export const startSystem = (): Promise<void> => invoke("start_system");
