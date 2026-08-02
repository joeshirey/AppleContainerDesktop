import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode, createElement } from "react";
import { appendLine, reconcile, IDLE_BUILD, BuildProvider, useBuild } from "../../hooks/useBuild";
import type { BuildLine, BuildState } from "../../types";

const BUILD = 7;

function line(seq: number, text: string): BuildLine {
  return { seq, stream: "stdout", line: text };
}

/// An event payload: a line tagged with the build that produced it.
function event(seq: number, text: string, buildId = BUILD) {
  return { ...line(seq, text), buildId };
}

function running(lines: BuildLine[], nextSeq: number, buildId = BUILD): BuildState {
  return { ...IDLE_BUILD, buildId, status: "running", lines, nextSeq };
}

describe("appendLine", () => {
  it("appends a line the state has not seen", () => {
    const next = appendLine(running([], 0), event(0, "step 1"));
    expect(next.lines.map(l => l.line)).toEqual(["step 1"]);
    expect(next.nextSeq).toBe(1);
  });

  // The snapshot and the event stream overlap on purpose: the listener is
  // attached before the snapshot is read so nothing is lost in between. That
  // makes duplicates normal, and dropping them is this function's job.
  it("discards a line the snapshot already covered", () => {
    const state = running([line(0, "step 1")], 1);
    expect(appendLine(state, event(0, "step 1"))).toBe(state);
  });

  it("keeps the newer line when sequence numbers jump", () => {
    const next = appendLine(running([line(0, "a")], 1), event(5, "f"));
    expect(next.lines.map(l => l.seq)).toEqual([0, 5]);
    expect(next.nextSeq).toBe(6);
  });

  it("caps the retained lines", () => {
    let state = running([], 0);
    for (let i = 0; i < 5010; i++) state = appendLine(state, event(i, `line ${i}`));
    expect(state.lines).toHaveLength(5000);
    expect(state.lines[0].line).toBe("line 10");
    expect(state.dropped).toBe(10);
  });

  // A reader thread that outlived an abandoned build keeps emitting. Its seqs
  // restart from 0 just like the current build's, so without the id check its
  // lines would be spliced into the middle of a transcript they do not belong
  // to.
  it("drops a line from a build that has already been replaced", () => {
    const state = running([line(0, "current")], 1);
    expect(appendLine(state, event(0, "orphan", BUILD - 1))).toBe(state);
    // A seq the current build has not reached, so only the id can reject it.
    // At seq 0 the dedupe would have refused the line anyway and this test
    // would hold with the id check deleted.
    expect(appendLine(state, event(5, "orphan", BUILD - 1))).toBe(state);
  });

  // The two reader threads assign seq under the buffer lock and emit after
  // releasing it, so the gap between the two is unsynchronised and stderr can
  // reach the dispatcher first with the higher number. Discarding the line that
  // lost the race loses it for good: nothing re-reads the snapshot mid-build.
  it("keeps a line that arrives after a higher sequence number", () => {
    const state = appendLine(running([line(0, "a")], 1), event(2, "c"));
    const next = appendLine(state, event(1, "b"));
    expect(next.lines.map(l => l.line)).toEqual(["a", "b", "c"]);
    // The highest seq seen still decides what comes next; the late line must
    // not wind the boundary back and re-admit lines already in the transcript.
    expect(next.nextSeq).toBe(3);
    expect(next.dropped).toBe(0);
  });

  // Dedupe is by seq, not by a monotone boundary, so a replayed line inside the
  // retained window is still recognised no matter where in it it lands.
  it("discards a duplicate of a line already inside the window", () => {
    const state = running([line(0, "a"), line(1, "b"), line(2, "c")], 3);
    expect(appendLine(state, event(1, "b"))).toBe(state);
  });

  // Below the oldest line held there is no way to tell a replay from a genuine
  // straggler, and the line the snapshot evicted is already counted in
  // `dropped`. Re-admitting it would put it at the head of the transcript,
  // under a "dropped" notice that says it is gone.
  it("drops a line older than the oldest one retained", () => {
    const state = { ...running([line(10, "k"), line(11, "l")], 12), dropped: 10 };
    expect(appendLine(state, event(3, "d"))).toBe(state);
  });

  // The first line of a new build arrives before any snapshot naming it, so
  // the transcript has to restart here rather than appending to the old one.
  it("starts a fresh transcript when a newer build appears", () => {
    const state = { ...running([line(0, "old"), line(1, "old")], 2), status: "failed" as const };
    const next = appendLine(state, event(0, "new", BUILD + 1));
    expect(next.buildId).toBe(BUILD + 1);
    expect(next.status).toBe("running");
    expect(next.lines.map(l => l.line)).toEqual(["new"]);
    expect(next.nextSeq).toBe(1);
    expect(next.exitCode).toBeNull();
  });
});

describe("reconcile", () => {
  it("takes the snapshot when no events have arrived", () => {
    const snapshot = running([line(0, "a"), line(1, "b")], 2);
    expect(reconcile(IDLE_BUILD, snapshot)).toBe(snapshot);
  });

  // The backlog is only in the snapshot and the newest lines are only in the
  // live state. Taking either one alone drops output the user watched arrive.
  it("keeps live lines the snapshot was taken too early to include", () => {
    const live = running([line(2, "c")], 3);
    const snapshot = running([line(0, "a"), line(1, "b")], 2);
    const next = reconcile(live, snapshot);
    expect(next.lines.map(l => l.line)).toEqual(["a", "b", "c"]);
    expect(next.nextSeq).toBe(3);
  });

  // Status and tag are only ever authoritative on the backend.
  it("takes status and tag from the snapshot", () => {
    const live = running([line(2, "c")], 3);
    const snapshot = { ...running([line(0, "a")], 1), status: "succeeded" as const, tag: "app:1" };
    const next = reconcile(live, snapshot);
    expect(next.status).toBe("succeeded");
    expect(next.tag).toBe("app:1");
  });

  it("ignores a snapshot describing a build the events have moved past", () => {
    const live = running([line(0, "new")], 1, BUILD + 1);
    expect(reconcile(live, running([line(0, "old")], 1, BUILD))).toBe(live);
  });

  // The snapshot is read over a different transport than the events, so one
  // taken while the build was still running can land after `build-done`. A
  // finished build must not go back to showing a spinner and a Cancel button.
  it("does not resurrect a build that has already finished", () => {
    const live = { ...running([line(0, "a")], 1), status: "failed" as const, exitCode: 1, tag: "app:1" };
    const next = reconcile(live, running([line(0, "a")], 1));
    expect(next.status).toBe("failed");
    expect(next.exitCode).toBe(1);
    expect(next.tag).toBe("app:1");
    // A build that prints right up to the moment `build-done` lands will have
    // live lines ahead of the snapshot, so the fix must hold in the merge
    // branch too — not only when ahead is empty.
    const withAhead = { ...live, lines: [line(0, "a"), line(1, "b")], nextSeq: 2 };
    const merged = reconcile(withAhead, running([line(0, "a")], 1));
    expect(merged.status).toBe("failed");
  });

  // The `finished` guard must be false when live is still running, or the
  // outcome spread would overwrite the snapshot's tag with the live empty one
  // and the modal header would stay blank for the whole build.
  it("takes tag from the snapshot when the build is still running", () => {
    const live = running([line(0, "a")], 1);
    const snapshot = { ...running([line(0, "a")], 1), tag: "app:1" };
    expect(reconcile(live, snapshot).tag).toBe("app:1");
  });

  // The merge reads the last element of `ahead` for the new boundary, which is
  // only the highest seq if the live lines are sorted. `appendLine` inserting
  // an out-of-order line in place is what makes that hold: append it at the end
  // instead and this reconcile hands back a nextSeq one line too low, so the
  // next event re-admits a line already on screen.
  it("takes the boundary from the highest seq after an out-of-order arrival", () => {
    let live = running([], 0);
    live = appendLine(live, event(0, "a"));
    live = appendLine(live, event(2, "c"));
    live = appendLine(live, event(1, "b"));
    const next = reconcile(live, running([line(0, "a")], 1));
    expect(next.lines.map(l => l.line)).toEqual(["a", "b", "c"]);
    expect(next.nextSeq).toBe(3);
  });

  // The backend counts its own evictions, so the snapshot's tally is the
  // truth at the moment it was taken; only what the merge itself pushes out
  // is added on top.
  it("counts lines the merge evicts on top of the snapshot's tally", () => {
    const backlog = Array.from({ length: 5000 }, (_, i) => line(i, `line ${i}`));
    const snapshot = { ...running(backlog, 5000), dropped: 12 };
    const live = running([line(5000, "a"), line(5001, "b")], 5002);
    const next = reconcile(live, snapshot);
    expect(next.lines).toHaveLength(5000);
    expect(next.dropped).toBe(14);
  });
});

describe("BuildProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("build-done id guard: drops older, applies matching, adopts newer", async () => {
    const handlers = new Map<string, (e: { payload: unknown }) => void>();
    vi.mocked(listen).mockImplementation(async (name, handler) => {
      handlers.set(String(name), handler as any);
      return vi.fn();
    });
    // getBuildState returns a running build so the provider has a known buildId.
    vi.mocked(invoke).mockResolvedValue({ ...IDLE_BUILD, buildId: 7, status: "running" });

    const { result } = renderHook(() => useBuild(), { wrapper: BuildProvider });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.build.buildId).toBe(7);

    const fire = (payload: object) =>
      act(() => { handlers.get("build-done")?.({ payload }); });

    // Older id: the state must not change.
    fire({ buildId: 6, status: "succeeded", tag: "old", exitCode: 0 });
    expect(result.current.build.buildId).toBe(7);
    expect(result.current.build.status).toBe("running");

    // Matching id: status, tag, and exitCode are taken from the event.
    fire({ buildId: 7, status: "failed", tag: "app:1", exitCode: 1 });
    expect(result.current.build.status).toBe("failed");
    expect(result.current.build.tag).toBe("app:1");
    expect(result.current.build.exitCode).toBe(1);

    // Newer id: the event is adopted, wiping the old transcript.
    fire({ buildId: 8, status: "succeeded", tag: "app:2", exitCode: 0 });
    expect(result.current.build.buildId).toBe(8);
    expect(result.current.build.status).toBe("succeeded");
    expect(result.current.build.lines).toHaveLength(0);
  });

  // `listen` is async, so cleanup that fires while a subscribe is still in
  // flight would leak the listener. StrictMode unmounts immediately after
  // mount in dev; this verifies the in-flight off() call closes that window.
  it("StrictMode leaves exactly one live subscription pair", async () => {
    const offs: ReturnType<typeof vi.fn>[] = [];
    vi.mocked(listen).mockImplementation(async () => {
      const off = vi.fn();
      offs.push(off);
      return off;
    });
    vi.mocked(invoke).mockResolvedValue(IDLE_BUILD);

    const { rerender } = render(
      createElement(StrictMode, null, createElement(BuildProvider, null, null)),
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // StrictMode mounts the effect twice; each mount attaches two listeners.
    expect(listen).toHaveBeenCalledTimes(4);
    // The first mount's in-flight promises resolve after cleanup; attach calls
    // their off() immediately so they do not outlive the component.
    expect(offs.filter(off => off.mock.calls.length > 0)).toHaveLength(2);

    // A re-render with identical props does not re-subscribe.
    rerender(createElement(StrictMode, null, createElement(BuildProvider, null, null)));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(listen).toHaveBeenCalledTimes(4);
  });
});
