export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  ports?: string;
  created?: string;
  /// Host paths the container bind-mounts that no longer exist. It will not
  /// start until they are restored.
  missingBindMounts?: string[];
}

export interface ContainerStats {
  id?: string;
  cpu?: string;
  memory?: string;
}

export interface Image {
  id: string;
  /// The name the CLI answers to — `image delete` and `run` take this, not `id`.
  reference: string;
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

/// Settings a user may change on an existing container. An omitted key means
/// "leave as recorded" — the backend rebuilds it from the container's own
/// configuration rather than from what the UI displayed.
export interface ContainerEdits {
  cpus?: string;
  memory?: string;
  ports?: string[];
  env?: string[];
}

/// The `container run` command that will replace a container, plus the settings
/// the run CLI has no flag for and that recreating will therefore drop.
export interface RecreatePlan {
  args: string[];
  unsupported: string[];
}

/// One pullable repository from a Docker Hub search.
export interface HubResult {
  /// The path to pull, e.g. "library/nginx" or "grafana/grafana".
  name: string;
  /// What to show the user: "nginx" rather than "library/nginx".
  displayName: string;
  description: string;
  isOfficial: boolean;
  pullCount: number;
  starCount: number;
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
