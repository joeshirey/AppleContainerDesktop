export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  ports?: string;
  created?: string;
}

export interface ContainerStats {
  id?: string;
  cpu?: string;
  memory?: string;
}

export interface Image {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface Machine {
  name: string;
  status: string;
  isDefault: boolean;
  cpus?: number;
  memoryMB?: number;
}

export type NavSection = "containers" | "images" | "hub" | "machines" | "settings";

export interface Settings {
  pollInterval: number;    // milliseconds, default 5000
  defaultLogLines: number; // default 100
}

export const DEFAULT_SETTINGS: Settings = {
  pollInterval: 5000,
  defaultLogLines: 100,
};
