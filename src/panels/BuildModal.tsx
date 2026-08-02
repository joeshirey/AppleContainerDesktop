import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { startBuild, cancelBuild, builderStatus, builderStart } from "../api";
import { useBuild } from "../hooks/useBuild";
import { positiveInt, CPUS_INVALID } from "../lib/validation";
import type { BuildOptions, KeyValue } from "../types";
import styles from "./BuildModal.module.css";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/// Blank rows are the normal state of a form the user is still filling in, so
/// they are dropped rather than sent as `=`.
function filled(pairs: KeyValue[]): KeyValue[] {
  return pairs.filter(p => p.key.trim() !== "");
}

function trimmed(value: string): string | undefined {
  return value.trim() === "" ? undefined : value.trim();
}

/// The build form and the live transcript of the build it starts.
///
/// Closing is not cancelling: the build keeps running and only Cancel Build
/// stops it, so the modal can be dismissed and reopened over a running build.
export function BuildModal({ onClose }: { onClose: () => void }) {
  const { build, refresh } = useBuild();
  const [context, setContext] = useState("");
  const [dockerfile, setDockerfile] = useState("");
  const [tag, setTag] = useState("");
  const [noCache, setNoCache] = useState(false);
  const [buildArgs, setBuildArgs] = useState<KeyValue[]>([]);
  const [target, setTarget] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [platform, setPlatform] = useState("");
  const [labels, setLabels] = useState<KeyValue[]>([]);
  const [pull, setPull] = useState(false);
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  const [builderRunning, setBuilderRunning] = useState<boolean | null>(null);
  const [startingBuilder, setStartingBuilder] = useState(false);
  // Held for the whole of `start_build`, because nothing else covers that
  // window: `running` only turns true once the refresh behind it lands.
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const running = build.status === "running";

  // Re-checked whenever the build's status moves, because a builder stopped
  // from the Builder view while this modal is open would otherwise leave the
  // status read at mount standing: the build fails with a raw CLI error and
  // Start Builder is never re-offered short of closing and reopening.
  useEffect(() => {
    let live = true;
    builderStatus()
      .then(s => { if (live) setBuilderRunning(s.running); })
      // A builder we cannot ask about is one we should not claim is ready.
      .catch(() => { if (live) setBuilderRunning(false); });
    return () => { live = false; };
  }, [build.status]);

  // A failure belongs to the build that caused it. Cancel in particular can
  // lose the race with a build that has already finished, and without this the
  // rejected "no build is running" would sit in red beside the success banner
  // with no control to dismiss it.
  useEffect(() => {
    setError(null);
  }, [build.status]);

  // Depends on the array, not its length: past the line cap the ring buffer
  // evicts as fast as it appends, so the length stops changing while the
  // content keeps moving. Keying on the length would stop following the tail
  // at exactly the point a long build needs it.
  useEffect(() => {
    const pane = logRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [build.lines]);

  async function pickContext() {
    try {
      const chosen = await open({ directory: true, title: "Choose build context" });
      if (typeof chosen === "string") setContext(chosen);
    } catch (e) {
      setError(message(e));
    }
  }

  async function pickDockerfile() {
    try {
      const chosen = await open({ directory: false, title: "Choose Dockerfile" });
      if (typeof chosen === "string") setDockerfile(chosen);
    } catch (e) {
      setError(message(e));
    }
  }

  async function handleStartBuilder() {
    setError(null);
    if (cpus.trim() !== "" && positiveInt(cpus) === undefined) {
      setError(CPUS_INVALID);
      return;
    }
    setStartingBuilder(true);
    try {
      await builderStart(positiveInt(cpus), trimmed(memory));
      setBuilderRunning(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setStartingBuilder(false);
    }
  }

  async function handleBuild() {
    setError(null);
    if (cpus.trim() !== "" && positiveInt(cpus) === undefined) {
      setError(CPUS_INVALID);
      return;
    }
    const opts: BuildOptions = {
      context: context.trim(),
      tag: tag.trim(),
      dockerfile: trimmed(dockerfile),
      noCache,
      buildArgs: filled(buildArgs),
      target: trimmed(target),
      platform: trimmed(platform),
      labels: filled(labels),
      pull,
      cpus: positiveInt(cpus),
      memory: trimmed(memory),
    };
    setStarting(true);
    try {
      await startBuild(opts);
      // The backend now knows the tag, the id and that it is running, and
      // none of that arrives on `build-output`. Without this the build would
      // stream in with the modal still saying idle and offering no Cancel.
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    setError(null);
    try {
      await cancelBuild();
    } catch (e) {
      setError(message(e));
    }
  }

  // Called, not rendered as <PairRows />: a nested component is a new type on
  // every render, so React would remount these inputs on each keystroke and
  // focus would jump out of the field after the first character.
  function pairRows(
    pairs: KeyValue[],
    setPairs: (next: KeyValue[]) => void,
    noun: string,
  ) {
    return (
      <>
        {pairs.map((pair, i) => (
          <div className={styles.pairRow} key={i}>
            <input
              className={styles.input}
              aria-label={`${noun} name ${i + 1}`}
              value={pair.key}
              onChange={e => setPairs(pairs.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))}
              disabled={running}
            />
            <input
              className={styles.input}
              aria-label={`${noun} value ${i + 1}`}
              value={pair.value}
              onChange={e => setPairs(pairs.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
              disabled={running}
            />
            <button
              className={styles.iconBtn}
              aria-label={`Remove ${noun.toLowerCase()} ${i + 1}`}
              onClick={() => setPairs(pairs.filter((_, j) => j !== i))}
              disabled={running}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className={styles.iconBtn}
          onClick={() => setPairs([...pairs, { key: "", value: "" }])}
          disabled={running}
        >
          Add {noun.toLowerCase()}
        </button>
      </>
    );
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <h2 className={styles.title}>Build Image</h2>

        {builderRunning === false && (
          <div className={styles.notice}>
            <span>The builder is not running.</span>
            {/* `container builder start` takes seconds; a second click would
                spawn a second one. */}
            <button className={styles.iconBtn} onClick={handleStartBuilder} disabled={startingBuilder}>
              Start Builder
            </button>
          </div>
        )}

        <label className={styles.label} htmlFor="build-context">Build context</label>
        <div className={styles.pathRow}>
          <input
            id="build-context"
            className={styles.input}
            placeholder="/path/to/project"
            value={context}
            onChange={e => setContext(e.target.value)}
            disabled={running}
          />
          <button className={styles.iconBtn} onClick={pickContext} disabled={running}>Choose…</button>
        </div>

        <label className={styles.label} htmlFor="build-dockerfile">Dockerfile</label>
        <div className={styles.pathRow}>
          <input
            id="build-dockerfile"
            className={styles.input}
            placeholder="Defaults to Dockerfile in the context"
            value={dockerfile}
            onChange={e => setDockerfile(e.target.value)}
            disabled={running}
          />
          <button className={styles.iconBtn} onClick={pickDockerfile} disabled={running}>Choose…</button>
        </div>

        <label className={styles.label} htmlFor="build-tag">Tag</label>
        <input
          id="build-tag"
          className={styles.input}
          placeholder="e.g. myapp:latest"
          value={tag}
          onChange={e => setTag(e.target.value)}
          disabled={running}
        />

        <div className={styles.checkRow}>
          <input id="build-nocache" type="checkbox" checked={noCache} onChange={e => setNoCache(e.target.checked)} disabled={running} />
          <label htmlFor="build-nocache">No cache</label>
        </div>

        <label className={styles.label} htmlFor="build-target">Target stage</label>
        <input
          id="build-target"
          className={styles.input}
          placeholder="Optional, for multi-stage builds"
          value={target}
          onChange={e => setTarget(e.target.value)}
          disabled={running}
        />

        <span className={styles.label}>Build arguments</span>
        {pairRows(buildArgs, setBuildArgs, "Build argument")}

        <button className={styles.advancedToggle} onClick={() => setShowAdvanced(v => !v)}>
          {showAdvanced ? "Hide advanced" : "Advanced"}
        </button>

        {showAdvanced && (
          <div className={styles.advanced}>
            <label className={styles.label} htmlFor="build-platform">Platform</label>
            <input
              id="build-platform"
              className={styles.input}
              placeholder="e.g. linux/amd64"
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              disabled={running}
            />
            <div className={styles.checkRow}>
              <input id="build-pull" type="checkbox" checked={pull} onChange={e => setPull(e.target.checked)} disabled={running} />
              <label htmlFor="build-pull">Always pull base images</label>
            </div>
            <span className={styles.label}>Labels</span>
            {pairRows(labels, setLabels, "Label")}
            <label className={styles.label} htmlFor="build-cpus">Builder CPUs</label>
            <input id="build-cpus" className={styles.input} type="number" min={1} step={1} value={cpus} onChange={e => setCpus(e.target.value)} disabled={running} />
            <label className={styles.label} htmlFor="build-memory">Builder memory</label>
            <input id="build-memory" className={styles.input} placeholder="e.g. 8G" value={memory} onChange={e => setMemory(e.target.value)} disabled={running} />
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}
        {build.dropped > 0 && (
          <div className={styles.notice}>Earlier output was dropped: {build.dropped} lines.</div>
        )}
        {/*
          Held back while an error is showing, because the outcome renders off a
          status that outlives the build it describes. Build, close, reopen,
          mistype the context, Build again: `start_build` rejects before a build
          exists, the status is still the last one's, and the modal reports both
          a red "Build context not found" and a green "Built app:latest." for
          the same click. Suppressing here rather than clearing on a new attempt
          keeps one source of truth — the effect above already clears `error`
          when the next build starts, which puts the outcome back on its own.
        */}
        {!error && (
          <>
            {build.status === "failed" && (
              <div className={styles.error}>Build failed with exit code {build.exitCode ?? "unknown"}.</div>
            )}
            {build.status === "cancelled" && <div className={styles.notice}>Build cancelled.</div>}
            {build.status === "succeeded" && <div className={styles.notice}>Built {build.tag}.</div>}
          </>
        )}

        {/*
          Both streams render identically. `container build` writes its whole
          progress transcript to stderr, so styling by stream would dim the
          build log and leave the occasional stdout line standing out — the
          opposite of what the emphasis should be. The stream is still carried
          on each line; nothing in the log pane has a reason to read it.
        */}
        {build.lines.length > 0 && (
          <div className={styles.log} ref={logRef}>
            {build.lines.map(l => (
              <div key={l.seq}>{l.line}</div>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.btnGhost} onClick={onClose}>Close</button>
          {/*
            Build carries `starting` because two clicks spawn two `start_build`
            invokes. The backend refuses the second, but the status effect then
            wipes the "A build is already running." it answers with, leaving the
            user a flash of an error about a build they only asked for once.
          */}
          {running ? (
            <button className={styles.btnDanger} onClick={handleCancel}>Cancel Build</button>
          ) : (
            <button
              className={styles.btnPrimary}
              onClick={handleBuild}
              disabled={starting || !context.trim() || !tag.trim()}
            >
              Build
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
