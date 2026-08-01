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

/// Settings `container machine set` can change. An omitted key is left alone.
export interface MachineEdits {
  cpus?: number;
  memory?: string;
  /// How the user's home directory is mounted inside the machine.
  homeMount?: "ro" | "rw" | "none";
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

export interface Volume {
  name: string;
  driver: string;
  format: string;
  /// The ceiling the sparse image was created with — not disk consumed.
  provisioned: string;
  /// Blocks actually allocated. "—" when the image could not be read.
  onDisk: string;
  /// Where the image lives on the host.
  source: string;
  created: string;
  /// Containers mounting this volume. `volume delete` fails while non-empty.
  inUseBy: string[];
}

export interface Network {
  name: string;
  mode: string;
  plugin: string;
  subnet?: string;
  gateway?: string;
  subnetV6?: string;
  created: string;
  /// A network the CLI owns. `network delete` refuses to touch one.
  isBuiltin: boolean;
  /// Containers attached to this network.
  inUseBy: string[];
}

/// Settings `container network create` accepts. Everything else it offers
/// (plugins, IPv6 prefixes, labels) is left at the CLI's default.
export interface NetworkOptions {
  subnet?: string;
  internal?: boolean;
}

export type NavSection =
  | "containers"
  | "images"
  | "builder"
  | "hub"
  | "machines"
  | "volumes"
  | "networks"
  | "settings";

export interface Settings {
  pollInterval: number;    // milliseconds, default 5000
  defaultLogLines: number; // default 100
}

export const DEFAULT_SETTINGS: Settings = {
  pollInterval: 5000,
  defaultLogLines: 100,
};

export interface KeyValue {
  key: string;
  value: string;
}

/// The options the build form collects. `--secret` and `--output` are left
/// out on purpose; see the design doc for why.
export interface BuildOptions {
  context: string;
  tag: string;
  dockerfile?: string;
  noCache: boolean;
  buildArgs: KeyValue[];
  target?: string;
  platform?: string;
  labels: KeyValue[];
  pull: boolean;
  cpus?: number;
  memory?: string;
}

export type BuildStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";

export interface BuildLine {
  seq: number;
  stream: "stdout" | "stderr";
  line: string;
}

export interface BuildState {
  /// Which build this is. Counts from 1; 0 means no build has run. Sequence
  /// numbers restart at 0 for every build, so the id is the only thing that
  /// tells two builds' lines apart.
  buildId: number;
  status: BuildStatus;
  tag: string;
  exitCode: number | null;
  lines: BuildLine[];
  /// The sequence number the next line will carry. Anything below it has
  /// already been seen, which is how replayed events are discarded.
  nextSeq: number;
  dropped: number;
}

export interface BuilderState {
  /// False when no builder container exists at all, which is what a machine
  /// that has never built anything reports. Not the same as stopped: Stop and
  /// Delete have nothing to act on, and there is no allocation to show.
  exists: boolean;
  running: boolean;
  cpus: number | null;
  memoryMb: number | null;
  /// The state string the CLI reported, shown when it is something this build
  /// does not recognise.
  raw: string;
}
