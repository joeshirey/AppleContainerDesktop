import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { startBuild, cancelBuild, builderStatus, builderStart } from "../api";
import { useBuild } from "../hooks/useBuild";
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
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const running = build.status === "running";

  useEffect(() => {
    builderStatus()
      .then(s => setBuilderRunning(s.running))
      // A builder we cannot ask about is one we should not claim is ready.
      .catch(() => setBuilderRunning(false));
  }, []);

  useEffect(() => {
    const pane = logRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [build.lines.length]);

  async function pickContext() {
    const chosen = await open({ directory: true, title: "Choose build context" });
    if (typeof chosen === "string") setContext(chosen);
  }

  async function pickDockerfile() {
    const chosen = await open({ directory: false, title: "Choose Dockerfile" });
    if (typeof chosen === "string") setDockerfile(chosen);
  }

  async function handleStartBuilder() {
    setError(null);
    try {
      await builderStart(trimmed(cpus) ? Number(cpus) : undefined, trimmed(memory));
      setBuilderRunning(true);
    } catch (e) {
      setError(message(e));
    }
  }

  async function handleBuild() {
    setError(null);
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
      cpus: trimmed(cpus) ? Number(cpus) : undefined,
      memory: trimmed(memory),
    };
    try {
      await startBuild(opts);
      // The backend now knows the tag, the id and that it is running, and
      // none of that arrives on `build-output`. Without this the build would
      // stream in with the modal still saying idle and offering no Cancel.
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }

  async function handleCancel() {
    try {
      await cancelBuild();
    } catch (e) {
      setError(message(e));
    }
  }

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
            <button className={styles.iconBtn} onClick={handleStartBuilder}>Start Builder</button>
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
            <input id="build-cpus" className={styles.input} value={cpus} onChange={e => setCpus(e.target.value)} disabled={running} />
            <label className={styles.label} htmlFor="build-memory">Builder memory</label>
            <input id="build-memory" className={styles.input} placeholder="e.g. 8G" value={memory} onChange={e => setMemory(e.target.value)} disabled={running} />
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}
        {build.dropped > 0 && (
          <div className={styles.notice}>Earlier output was dropped: {build.dropped} lines.</div>
        )}
        {build.status === "failed" && (
          <div className={styles.error}>Build failed with exit code {build.exitCode ?? "unknown"}.</div>
        )}
        {build.status === "cancelled" && <div className={styles.notice}>Build cancelled.</div>}
        {build.status === "succeeded" && <div className={styles.notice}>Built {build.tag}.</div>}

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
          {running ? (
            <button className={styles.btnDanger} onClick={handleCancel}>Cancel Build</button>
          ) : (
            <button
              className={styles.btnPrimary}
              onClick={handleBuild}
              disabled={!context.trim() || !tag.trim()}
            >
              Build
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
