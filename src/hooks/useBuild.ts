import { createContext, createElement, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getBuildState } from "../api";
import type { BuildLine, BuildState, BuildStatus } from "../types";

const BUILD_OUTPUT_EVENT = "build-output";
const BUILD_DONE_EVENT = "build-done";

/// Matches MAX_LINES in src-tauri/src/build.rs. Holding more here than the
/// backend keeps would only ever show lines a reload could not reproduce.
const MAX_LINES = 5000;

export const IDLE_BUILD: BuildState = {
  buildId: 0,
  status: "idle",
  tag: "",
  exitCode: null,
  lines: [],
  nextSeq: 0,
  dropped: 0,
};

/// A `build-output` payload: a line, plus the id of the build that produced
/// it. The backend flattens the line into the event, so `seq`, `stream` and
/// `line` sit alongside `buildId` rather than nested.
interface BuildOutput extends BuildLine {
  buildId: number;
}

interface BuildDone {
  buildId: number;
  status: BuildStatus;
  tag: string;
  exitCode: number | null;
}

/// Add a line to the build it belongs to.
///
/// Three cases, and the id is what separates them. Sequence numbers restart at
/// 0 for each build, so seq alone cannot tell a stale line from a fresh one.
///
/// A line from an older build is dropped. That happens for real: if the
/// backend cannot start both reader threads it abandons the build, and a
/// reader that did start keeps emitting until its pipe closes. Those lines
/// carry an id no snapshot will ever mention, and without this check they
/// would be spliced into the next build's transcript at overlapping seqs.
///
/// A line from a newer build means a build started that this state has not
/// seen yet, so the transcript restarts rather than appending to the old one.
///
/// Within one build, a seq already accounted for is a duplicate. Those are
/// expected: the listener is attached before the snapshot is read, so anything
/// printed in that window arrives twice.
export function appendLine(state: BuildState, incoming: BuildOutput): BuildState {
  if (incoming.buildId < state.buildId) return state;
  if (incoming.buildId > state.buildId) {
    return {
      ...IDLE_BUILD,
      buildId: incoming.buildId,
      status: "running",
      lines: [incoming],
      nextSeq: incoming.seq + 1,
    };
  }
  if (incoming.seq < state.nextSeq) return state;
  return {
    ...state,
    lines: [...state.lines, incoming].slice(-MAX_LINES),
    nextSeq: incoming.seq + 1,
  };
}

/// Fold a freshly read snapshot into what the live events have already built.
///
/// Neither side is complete on its own. The snapshot holds the authoritative
/// status, tag and backlog; the event stream may already have carried the view
/// past the moment the snapshot was taken on the backend. Taking either one
/// wholesale loses lines, which is what makes this worth its own function.
export function reconcile(current: BuildState, snapshot: BuildState): BuildState {
  // Events already showed a newer build than this snapshot describes, so the
  // snapshot is the stale one.
  if (current.buildId > snapshot.buildId) return current;
  if (current.buildId < snapshot.buildId) return snapshot;

  const ahead = current.lines.filter(l => l.seq >= snapshot.nextSeq);
  if (ahead.length === 0) return snapshot;
  return {
    ...snapshot,
    lines: [...snapshot.lines, ...ahead].slice(-MAX_LINES),
    nextSeq: ahead[ahead.length - 1].seq + 1,
  };
}

interface BuildContextValue {
  build: BuildState;
  /// Re-read the backend's state. The modal calls this after starting a build
  /// so the tag and the running status appear immediately: `build-output`
  /// events carry lines, not status, so without this the whole build would
  /// stream in while the UI still said idle and offered no Cancel.
  refresh: () => Promise<void>;
}

const BuildContext = createContext<BuildContextValue>({
  build: IDLE_BUILD,
  refresh: async () => {},
});

export function BuildProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BuildState>(IDLE_BUILD);

  const refresh = useCallback(async () => {
    const snapshot = await getBuildState();
    setState(s => reconcile(s, snapshot));
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    // `listen` is async, so a cleanup that fires while one is in flight would
    // run against an array the subscription had not been added to yet and the
    // listener would outlive the provider. StrictMode does exactly that on
    // every mount in development, so detach on the spot instead.
    async function attach<T>(name: string, handle: (payload: T) => void) {
      const off = await listen<T>(name, e => handle(e.payload));
      if (disposed) off();
      else unlisteners.push(off);
    }

    (async () => {
      // Subscribe first. Reading the snapshot first would lose whatever the
      // build printed between the read and the listener being attached.
      // Events can apply straight away because `reconcile` merges the snapshot
      // into them when it lands, rather than overwriting.
      await attach<BuildOutput>(BUILD_OUTPUT_EVENT, payload => {
        setState(s => appendLine(s, payload));
      });
      await attach<BuildDone>(BUILD_DONE_EVENT, payload => {
        setState(s =>
          // A done from an abandoned build must not finish the current one.
          payload.buildId !== s.buildId
            ? s
            : { ...s, status: payload.status, tag: payload.tag, exitCode: payload.exitCode },
        );
      });

      if (disposed) return;
      // A snapshot that cannot be read leaves the view on IDLE_BUILD, which is
      // the truth on a machine that has not built anything. Anything else the
      // next event or the modal's own refresh will correct, so there is no
      // error worth surfacing from a mount.
      await refresh().catch(() => {});
    })();

    return () => {
      disposed = true;
      unlisteners.forEach(off => off());
    };
  }, [refresh]);

  return createElement(BuildContext.Provider, { value: { build: state, refresh } }, children);
}

export function useBuild(): BuildContextValue {
  return useContext(BuildContext);
}
