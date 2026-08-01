import { describe, it, expect } from "vitest";
import { appendLine, reconcile, IDLE_BUILD } from "../../hooks/useBuild";
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
  });

  // A reader thread that outlived an abandoned build keeps emitting. Its seqs
  // restart from 0 just like the current build's, so without the id check its
  // lines would be spliced into the middle of a transcript they do not belong
  // to.
  it("drops a line from a build that has already been replaced", () => {
    const state = running([line(0, "current")], 1);
    expect(appendLine(state, event(0, "orphan", BUILD - 1))).toBe(state);
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
});
