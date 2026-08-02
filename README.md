# Apple Containers Desktop

[![CI](https://github.com/joeshirey/AppleContainerDesktop/actions/workflows/ci.yml/badge.svg)](https://github.com/joeshirey/AppleContainerDesktop/actions/workflows/ci.yml)

A Mac app for [Apple's `container`](https://github.com/apple/container) CLI.

`container` is a good tool with no GUI. This adds one. You get a sidebar of your
containers, images, VMs, volumes, and networks, and clicking any of them gives you logs,
a shell, and a settings panel you can edit.

It runs the `container` binary you already have installed and reads its JSON output.
There is no daemon, no socket, nothing keeping its own copy of the truth. Anything the
app does, you could have typed at the prompt yourself.

![The Containers view, with a running Postgres container selected and its log output on the Logs tab](docs/screenshot.png)

> **Early days. You build it yourself.**
> This is version 0.1, aimed at developers. There are no downloads and no release
> binaries. The [supported path](#build-and-run-it-locally) is cloning the repo and
> building it. Expect rough edges; [Known gaps](#known-gaps) is an honest list of them.
> It is useful day to day, but it has not been hardened, packaged, or tested anywhere
> beyond the machines of the people working on it.

## Requirements

| | |
|---|---|
| **Mac** | Apple silicon. `container` does not run on Intel. |
| **macOS** | 26 or newer. Apple does not support `container` below that. |
| **`container` CLI** | Installed. Built against 1.2.0. |
| **To build** | Node.js 20+ and Rust via [rustup](https://rustup.rs). |

Get the CLI from [apple/container releases](https://github.com/apple/container/releases),
then start the service once:

```sh
container system start
```

The app looks for the binary in `/opt/homebrew/bin`, then `/usr/local/bin`, then whatever
is on your `PATH`. It checks those two folders by hand because a Mac app launched from
Finder or the Dock gets a stripped down `PATH` that usually leaves Homebrew out.

## Build and run it locally

**Setup, once.** Install [Node.js](https://nodejs.org) 20 or newer, then Rust:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

You also need Xcode Command Line Tools for linking. Run `xcode-select --install` if you
have not already. Then:

```sh
git clone https://github.com/joeshirey/AppleContainerDesktop.git
cd AppleContainerDesktop
npm install
```

**Run it.** Two options, depending on what you are doing.

```sh
npm run tauri dev
```

Dev mode, with hot reload. Edit anything under `src/` and the window updates on its own.
Right-click and pick Inspect Element for a devtools console. The first launch compiles
the Rust side and takes a couple of minutes; after that it is seconds. Use this if you
are changing code.

```sh
npm run tauri build
```

Release mode. Builds an optimized copy and packages it, about a minute from cold. Two
things land in `src-tauri/target/release/bundle/`:

| Path | What it is |
|---|---|
| `macos/Apple Containers Desktop.app` | The app. Double-click it, or drag it to `/Applications`. |
| `dmg/Apple Containers Desktop_0.1.0_aarch64.dmg` | A ~4 MB disk image wrapping that same `.app`. |

To use it like a normal app:

```sh
cp -r "src-tauri/target/release/bundle/macos/Apple Containers Desktop.app" /Applications/
open "/Applications/Apple Containers Desktop.app"
```

That works on the Mac that built it, which is the supported case. Copying the `.app` to a
different Mac is messier. See below.

**If the app opens and shows nothing,** it could not find the `container` binary. Run
`which container`. If it lives somewhere other than `/opt/homebrew/bin` or
`/usr/local/bin`, symlink it into one of them.

## Sharing the build with someone else

**Short answer: don't. Have them build it.** Here is why, and what it would take to
change that.

`tauri build` really does produce a `.dmg`, so it looks like something you could send a
coworker. Not quite. The bundle is ad-hoc signed, meaning it carries a signature but no
Apple team identity, so Gatekeeper turns it down on any Mac except the one that built it:

```
$ spctl -a -t install "Apple Containers Desktop.app"
Apple Containers Desktop.app: code has no resources but signature indicates they must be present
```

Whoever downloads it gets told the app is damaged or comes from an unidentified developer.
There are ways around that, like right-click then Open, or
`xattr -dr com.apple.quarantine "/Applications/Apple Containers Desktop.app"`. But walking
strangers through stripping quarantine flags off a binary teaches a bad habit, and most
people will just delete it.

Three things would make it properly shareable:

1. **An Apple Developer Program membership**, $99/year. The free tier signs for local
   development but cannot notarize, so downloads still show up as unverified.
2. **A Developer ID Application certificate.** Only the account holder can create one.
   Point at it with `APPLE_SIGNING_IDENTITY` or `bundle.macOS.signingIdentity` in
   `tauri.conf.json`.
3. **Notarization**, which sends the signed bundle to Apple for an automated malware scan
   and staples the result onto it. You drive it with either the App Store Connect API
   (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or an Apple ID (`APPLE_ID`,
   `APPLE_PASSWORD` as an app-specific password, `APPLE_TEAM_ID`).

Set those in the environment and `npm run tauri build` signs and notarizes as part of the
build. [`tauri-action`](https://github.com/tauri-apps/tauri-action) does the same in
GitHub Actions, so tagging a version publishes a `.dmg` people can install. Tauri's
[macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) covers the whole path.

None of that is set up here. Everyone who can run this already had to install the
`container` CLI from a GitHub release, so building from source is a fair ask.

## What's in it

**Containers.** Running and stopped, grouped, refreshed on a timer. Pick one and you get
four tabs:

- **Info** — image, status, ID, published ports, and live CPU and memory while it runs.
- **Logs** — the last 100, 500, or 1000 lines.
- **Exec** — a shell prompt in the container. Commands go through `sh -c`, so pipes,
  redirects, globs, and `&&` all work. Each command runs on its own, so `cd` does not
  stick between them.
- **Settings** — change CPUs, memory, ports, and environment variables. `container` has no
  `update` command, so saving a change removes the container and runs it again. The panel
  rebuilds the whole `container run` line from the container's own inspect output, so
  mounts, labels, networks, entrypoint, workdir, user, capabilities, and DNS all come
  back. It shows you the command and a diff before touching anything, warns about the few
  settings `run` has no flag for, and if the re-run fails after the remove, hands you the
  full command line so you can recover.

If a bind mount's source folder gets deleted off your Mac, that container picks up a
**mount missing** badge in the list and a banner naming the paths. It will not start until
you put them back, but you can still see it, inspect it, and remove it.

**+ Run** opens a dialog for image, name, ports, env vars, CPUs, and memory.

**Images.** List, run, remove, prune unused, and pull by name. Names get shortened the way
the CLI shortens them, so a Docker Hub image reads as `debian` instead of
`docker.io/library/debian`. Every action still uses the full reference. The size column is
the compressed download size of the arm64 build, which is the only real number the CLI's
metadata records. What it unpacks to on disk is bigger.

**Build Image…** opens a dialog for building from a Dockerfile. Output streams into the
modal as it goes, and closing the modal leaves the build running. While a build is going,
a strip shows up in the view; click it to get the output back. Builds happen in a separate
BuildKit VM rather than the main container system, so the dialog checks that VM first and
offers to start it if it is off. You can set its CPUs and memory under Advanced. Stopping
or deleting that VM means `container builder stop` or `container builder delete` at the
prompt. There is no button for it.

**Docker Hub.** Search Hub without leaving the app. Official images get a badge and sort
first, then everything sorts by pull count. Pick a tag and pull it. Results you could not
actually pull here get filtered out: Hardened Images need a subscription, Docker Desktop
extensions are not containers, and archived repositories are dead ends.

**Machines.** Container machines are a different feature from containers, and the name
suggests something they are not, so they are worth a paragraph.

A container machine is a Linux VM that sticks around, built from a container image. You
make one from something like `alpine:3.22`, it boots, your home folder gets mounted inside
it (read-write by default), and you can open a shell and use it as a Linux box living on
your Mac. Containers are the opposite: throwaway, isolated, running one image's command.

You do not need one to run containers. `container run` never looks at them. If you have
never made one, this tab sits empty while everything else works, which is the normal state.
Think of it as "give me a Linux VM," offered by the same tool, rather than as the thing
containers run on top of.

The tab lists any machines you have with their CPU, memory, and state, and can create,
stop, delete, and pick the default one. Select a machine for four tabs:

- **Info** — CPUs and memory.
- **Logs** — the machine's stdio log, with a **Boot log** toggle for the VM's boot output.
  That is where you look when a machine will not come up.
- **Shell** — a prompt inside the machine, through `container machine run`. A stopped
  machine gets booted first. Unlike the container Exec tab, nothing wraps your command in
  `sh -c`, because `machine run` already evaluates it in a shell on the far side. Pipes,
  globs, and quoting work as typed.
- **Settings** — CPUs, memory, and how your home folder is mounted (`rw`, `ro`, or
  `none`), through `container machine set`. Only the fields you change get sent. The CLI
  reads these at boot, so the panel says plainly that you have to restart the machine
  before they do anything.

**Volumes.** Create, delete, and prune, with two size columns instead of one.
`container volume ls` reports a single `sizeInBytes`, and that number is the sparse
image's ceiling, not its contents. A 512 GB volume holding a small database reads as
512 GB while actually using a few hundred MB. The table puts that ceiling next to the
blocks really allocated, so **On disk** is the column that answers "what is this costing
me". Each volume also lists the containers mounting it. The CLI refuses to delete a
mounted volume, so Delete is disabled there instead of offered and then failing.

> Pruning a volume destroys what is inside it, not just the bookkeeping. The button says
> so before it does anything.

**Networks.** Create, delete, and prune, showing each network's subnet, gateway, and mode,
plus the containers attached to it. A new network can take a subnet and can be made
host-only (`--internal`), which shows up afterwards as mode `hostOnly`. The `default`
network is marked **Built-in** and has no Delete button at all, because
`container network delete default` just fails.

**Settings.** Poll interval and default log line count, saved to `.settings.json`.

A banner across the top tells you whether the container system is running and offers to
start or stop it.

## Development

```sh
npm test                    # 278 frontend tests (Vitest + Testing Library)
npm run test:watch
npm run build               # tsc + vite, the typecheck gate
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked         # 106 Rust tests
cargo build --locked
```

CI runs all of these on every push and pull request. See
[.github/workflows/ci.yml](.github/workflows/ci.yml). The job uses `macos-26`, the same
platform the app requires, and does not install the `container` CLI. No test needs it,
because the one test that shells out is checking the error path.

Order matters if you run them by hand. `npm run build` has to come before any `cargo`
command. `tauri-codegen` bakes `frontendDist` in at compile time and `dist/` is not
checked in, so without it the Rust build dies with *"the `frontendDist` configuration is
set to `../dist` but this path doesn't exist"*.

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

The split worth knowing: `cli.rs` is the only file that spawns a process, and
`recreate.rs` is pure. It takes inspect JSON plus your edits, returns an argv, and touches
nothing else. That is why most of the Rust tests live there.

### The icon

`app-icon.png` in the repo root is the master. 1024×1024, real transparency, with the tile
sized to 824×824 on Apple's macOS icon grid. Everything in `src-tauri/icons/` is generated
from it. Replace the master and re-run:

```sh
npm run tauri icon app-icon.png
```

That also writes `ios/` and `android/` folders this project does not use. Delete them. The
original generated artwork is kept at [docs/app-icon-source.jpg](docs/app-icon-source.jpg).

## Known gaps

- **Some `container build` flags.** The dialog covers tag, Dockerfile, `--no-cache`,
  `--build-arg`, `--target`, `--platform`, `--label`, `--pull`, and the builder's
  `--cpus` and `--memory`. Anything else the CLI accepts has to go through the terminal,
  including build secrets (`--secret`), non-image output (`--output type=tar|local`),
  `--arch`, `--os`, and the `--dns*` flags.
- **No registry logins.** `container registry login` is not wired up, so private
  registries only work if you already authenticated at the prompt.
- **No file copy in or out.** `container cp` and `container export` are missing.
- **Volume and network creation is partial on purpose.** Labels, driver options, the
  network plugin, and IPv6 prefixes all stay at the CLI's defaults. The panels expose
  size, subnet, and host-only because those are the ones that visibly change behaviour.

## License

Apache License 2.0. See [LICENSE](LICENSE).

This project is not affiliated with or endorsed by Apple.
