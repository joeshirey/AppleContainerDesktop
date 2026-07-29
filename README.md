# Apple Container Desktop

A native macOS desktop GUI for [Apple's `container`](https://github.com/apple/container) CLI.

`container` is a good tool with no graphical front end. This puts one on top of it: a
sidebar of your containers, images, and VMs, with logs, a shell, and an editable settings
panel behind each one. It shells out to the `container` binary you already have installed
and parses its JSON output — there is no daemon, no socket, and no second source of truth.
Anything you do here you could have done at the prompt.

<!-- Add a screenshot here once you have one — a GUI project's README really wants one:
![Apple Container Desktop](docs/screenshot.png)
-->

## Requirements

| | |
|---|---|
| **Mac** | Apple silicon. Required — `container` does not run on Intel. |
| **macOS** | 26 or later. Apple does not support `container` on older versions. |
| **`container` CLI** | Installed and on disk. Developed against 1.2.0. |
| **To build** | Node.js 18+, and a Rust toolchain via [rustup](https://rustup.rs). |

Install the CLI from [apple/container releases](https://github.com/apple/container/releases),
then start the service once:

```sh
container system start
```

The app looks for the binary at `/opt/homebrew/bin/container`, then `/usr/local/bin/container`,
then falls back to a plain `PATH` lookup. It probes those two paths explicitly because a Mac
app launched from Finder or the Dock inherits a minimal `PATH` that usually does not include
Homebrew.

## Building and running

```sh
git clone https://github.com/joeshirey/AppleContainerDesktop.git
cd AppleContainerDesktop
npm install

npm run tauri dev     # hot-reloading dev build
npm run tauri build   # release .app + .dmg
```

`tauri build` writes to `src-tauri/target/release/bundle/` — a `.app` under `macos/` and a
roughly 4 MB `.dmg` under `dmg/`.

## Distributing it

**Yes, you can ship a binary — but not the one `tauri build` gives you by default.**

The bundle it produces is *ad-hoc signed*: it has a signature, but no Apple team identity
behind it. It runs fine on the machine that built it and fails Gatekeeper anywhere else:

```
$ spctl -a -t install applecontainerdesktop.app
applecontainerdesktop.app: code has no resources but signature indicates they must be present
```

A user who downloads that `.dmg` gets told the app is damaged or from an unidentified
developer. They can get past it — right-click → Open, or `xattr -dr com.apple.quarantine
/Applications/applecontainerdesktop.app` — but asking strangers to strip quarantine
attributes off a binary is a bad habit to teach, and most people will just delete it.

To distribute properly you need:

1. **An Apple Developer Program membership** — $99/year. The free tier can sign for local
   development but cannot notarize, so downloads still show as unverified.
2. **A Developer ID Application certificate.** Only the account holder can create one. Set
   it as `APPLE_SIGNING_IDENTITY`, or in `tauri.conf.json` under
   `bundle.macOS.signingIdentity`.
3. **Notarization**, which uploads the signed bundle to Apple for an automated malware scan
   and staples the result. Configure with either the App Store Connect API
   (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or an Apple ID (`APPLE_ID`,
   `APPLE_PASSWORD` as an app-specific password, `APPLE_TEAM_ID`).

With those set, `npm run tauri build` signs and notarizes as part of the build.
[`tauri-action`](https://github.com/tauri-apps/tauri-action) does the same in GitHub Actions
and attaches the result to a release, so tagging a version publishes an installable `.dmg`.

Tauri's [macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) covers the whole
path. Until someone walks it, building from source is the honest answer.

## What's in it

**Containers** — running and stopped, grouped, with a list that refreshes on an interval.
Select one for four tabs:

- **Info** — image, status, ID, and published ports, plus live CPU and memory readings
  while the container is running.
- **Logs** — the last 100/500/1000 lines, configurable.
- **Exec** — a shell prompt against the container. Commands run through `sh -c`, so pipes,
  redirects, globs, and `&&` all work. Each command is independent, so `cd` does not persist
  between them.
- **Settings** — edit CPUs, memory, ports, and environment variables. Because `container`
  has no `update` command, applying a change removes and re-runs the container. The panel
  rebuilds the *entire* `container run` invocation from the container's own inspect output,
  so mounts, labels, networks, entrypoint, workdir, user, capabilities, and DNS all survive.
  It shows the exact command and a diff before touching anything, warns about the few
  settings `run` has no flag for, and if the re-run fails after the remove, hands you the
  full command line to recover with.

**+ Run** opens a dialog for image, name, ports, env vars, CPUs, and memory.

**Images** — list, run, remove, prune unused, and pull by name.

**Docker Hub** — search Hub without leaving the app; official images are badged and sorted
first, then by pull count. Pick a tag and pull it.

**Machines** — the VMs `container` runs on. List, create, stop, delete, and set the default,
with CPU and memory shown per machine.

**Settings** — poll interval and default log line count, persisted to `.settings.json`.

A banner across the top reports whether the container system is running and offers to start
or stop it.

## Development

```sh
npm test                    # 98 frontend tests (Vitest + Testing Library)
npm run test:watch
cd src-tauri && cargo test  # 32 Rust tests
npm run build               # tsc + vite, the typecheck gate
```

All four are expected to pass before a commit.

### Layout

```
src/
  api.ts          Typed wrappers over the Tauri IPC bridge; normalizes CLI JSON
  types.ts        Shared frontend types
  views/          Top-level screens (containers, images, hub, machines, settings)
  panels/         Detail panes and modals
  hooks/          Polling and persisted settings
src-tauri/src/
  cli.rs          Locates the binary, runs it, parses JSON, surfaces stderr
  containers.rs   The #[tauri::command] surface
  recreate.rs     Rebuilds a full `container run` line from inspect output
```

The split worth knowing: `cli.rs` is the only place that spawns a process, and `recreate.rs`
is pure — it takes inspect JSON plus edits, returns an argv, and touches nothing. That is
why it carries most of the Rust test suite.

## Known gaps

Being honest about what isn't done:

- **Image sizes are wrong.** The list reads `descriptor.size`, which is the size of the OCI
  index — a few kilobytes — not of the image. Debian shows as "9 KB".
- **No volumes or networks UI**, though `container` has full CRUD for both.
- **Image names show the full registry path**, so a Docker Hub image reads as
  `docker.io/library/debian` rather than `debian`.
- **Containers whose bind-mount sources have been deleted are hidden** from the list rather
  than shown as broken.
- **Hub search uses a deprecated Docker Hub endpoint** that may stop working.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

This project is not affiliated with or endorsed by Apple.
