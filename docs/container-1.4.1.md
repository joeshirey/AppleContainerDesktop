# Container 1.4.1 compatibility

The desktop app invokes the installed CLI; it does not embed Apple's Swift packages.
Use `container --version` to confirm the CLI version. Version 1.4.1 is the tested and
recommended version. Legacy JSON shapes remain covered where supported, but older CLI
releases have not been rerun through the live suite for this update.

## Changes

- Recognize tmpfs and named-volume mount types before checking host bind directories.
  Both legacy blank tmpfs sources and the current `"tmpfs"` source work.
- Preserve `system status` JSON for `not running` and `unregistered` responses with exit
  code 1. Other failures remain errors. Invalid status output is an error, and failed
  commands always produce a nonempty diagnostic.
- Show failed status checks as unavailable, with an error and Retry button.
- Read machine CPU and memory from the flat list fields, retaining the older nested
  resource fallback.
- Display numeric memory counters and calculate CPU utilization from successive
  cumulative samples. CPU is unavailable until two samples arrive; 100% is one core.
  The Info tab requests another sample five seconds after the preceding call finishes,
  never overlaps requests, and stops polling when closed or the container stops.

Apple's [1.4.1 release notes](https://github.com/apple/container/releases/tag/1.4.1)
describe the expanded system status, JSON slash encoding, security fixes, and new clean
command. The status field remains at the top level. JSON parsers accept both slash
encodings. The [1.3.0 release](https://github.com/apple/container/releases/tag/1.3.0)
removed `--scheme auto`; the app does not emit that flag. The new clean command is not
exposed by this update.

## Automated checks

From the repository root:

```sh
npm ci
npm test
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --locked
```

Fixtures under `src/test/fixtures/container-1.4.1/` were captured from the installed
1.4.1 CLI on Apple silicon. Personal paths and disposable resource names are replaced
with test values. They cover system status, containers, stats, images, machines,
volumes, networks, and an existing stopped builder. Container and machine fixtures
come from disposable Alpine resources. The fixture tests run without the CLI in CI.

## Live smoke test

Use an Apple silicon Mac with container 1.4.1, virtualization support, network access
for image pulls, and enough memory for the test container, machine, and builder.
After building the frontend:

```sh
container system start
cd src-tauri
cargo test --locked --test cli_compatibility live_1_4_1_smoke -- --ignored --nocapture
```

The test exercises the app's Rust command functions for pull, container lifecycle,
logs, exec, stats, settings recreation, export, volume and network usage, machine
lifecycle/shell/logs/settings, and image build/removal. Recreation checks that the
mounts, environment, published ports, process, labels, and networks survive a CPU edit,
and that named-volume data survives too.

Resources have unique `acd-smoke-` names and are cleaned up, including on assertion
failure. Cleanup never prunes unrelated resources. The Alpine base image stays cached.
An existing stopped builder is started if necessary and stopped afterward. The service
is left running. If the process is forcibly killed, remove only its `acd-smoke-` resources.

For UI acceptance, run `npm run tauri dev` from the repository root. Check the service
banner, container mount warnings, changing CPU/memory stats, machine resource values,
and the settings preview and recreation flow using a disposable container.

## Upstream machine initialization limitation

In 1.4.1, the first noninteractive `machine run` immediately after creating a machine
can fail with `Operation not supported by device` or `Inappropriate ioctl for device`.
The CLI's [boot helper](https://github.com/apple/container/blob/1.4.1/Sources/ContainerCommands/Machine/MachineHelpers.swift)
requests a terminal when its snapshot still reports first-time user setup as incomplete.
Stopping the newly created machine before its first shell command lets the next boot
load the persisted setup state. This workaround passed the live test; the smoke test
includes that stop explicitly. The app surfaces CLI errors and does not automatically
retry shell commands, which could execute user work twice.

## Validation record

Validated September 17, 2026 on Apple silicon, macOS 27.0, container client/server 1.4.1:
295 frontend tests, 117 default Rust tests, formatting, Clippy with warnings denied,
frontend/native builds, and the opt-in live smoke test passed. The live test includes
the machine initialization workaround above. CI remains configured for macOS 26;
this local run does not substitute for that CI result.
