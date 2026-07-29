import { useState, useEffect } from "react";
import { inspectContainer, planRecreate, recreateContainer } from "../api";
import type { Container, ContainerEdits, RecreatePlan } from "../types";
import styles from "./ContainerSettings.module.css";

interface ParsedConfig {
  cpus: string;
  memory: string;
  ports: string[];
  env: string[];
}

function bytesToMemStr(bytes: number): string {
  if (bytes <= 0) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1 && Number.isInteger(gb)) return `${gb}g`;
  if (gb >= 1) return `${gb.toFixed(1)}g`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)}m`;
  return `${bytes}`;
}

/// Render one `publishedPorts` entry the way `container run -p` expects it.
function portSpec(p: any): string {
  const addr = p.hostAddress && p.hostAddress !== "0.0.0.0" ? `${p.hostAddress}:` : "";
  const proto = p.proto && p.proto.toLowerCase() !== "tcp" ? `/${p.proto}` : "";
  return `${addr}${p.hostPort ?? p.containerPort}:${p.containerPort}${proto}`;
}

/// Read the editable subset of `container inspect` output, which is an array of
/// containers. Only these four settings are editable here; everything else is
/// rebuilt by the backend from the container's own configuration.
function parseInspect(raw: any): ParsedConfig {
  const entry = Array.isArray(raw) ? raw[0] : raw;
  const cfg = entry?.configuration ?? entry ?? {};
  return {
    cpus: cfg.resources?.cpus != null ? String(cfg.resources.cpus) : "",
    memory: bytesToMemStr(cfg.resources?.memoryInBytes ?? 0),
    ports: (cfg.publishedPorts ?? []).map(portSpec),
    env: cfg.initProcess?.environment ?? [],
  };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/// Collect only what the user actually changed. Sending an untouched field
/// would round-trip it through its display format and could lose precision.
function collectEdits(a: ParsedConfig, b: ParsedConfig): ContainerEdits {
  const edits: ContainerEdits = {};
  if (b.cpus !== a.cpus) edits.cpus = b.cpus;
  if (b.memory !== a.memory) edits.memory = b.memory;
  const ports = b.ports.filter(Boolean);
  if (!sameList(ports, a.ports)) edits.ports = ports;
  const env = b.env.filter(Boolean);
  if (!sameList(env, a.env)) edits.env = env;
  return edits;
}

function diffConfigs(a: ParsedConfig, b: ParsedConfig): string[] {
  const changes: string[] = [];
  if (b.cpus !== a.cpus) changes.push(`CPUs: ${a.cpus || "default"} → ${b.cpus || "default"}`);
  if (b.memory !== a.memory) changes.push(`Memory: ${a.memory || "default"} → ${b.memory || "default"}`);
  b.ports.filter(p => p && !a.ports.includes(p)).forEach(p => changes.push(`+ Port ${p}`));
  a.ports.filter(p => p && !b.ports.includes(p)).forEach(p => changes.push(`- Port ${p}`));
  b.env.filter(e => e && !a.env.includes(e)).forEach(e => changes.push(`+ Env ${e}`));
  a.env.filter(e => e && !b.env.includes(e)).forEach(e => changes.push(`- Env ${e}`));
  return changes;
}

export function ContainerSettings({ container }: { container: Container }) {
  const [original, setOriginal] = useState<ParsedConfig | null>(null);
  const [draft, setDraft] = useState<ParsedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<RecreatePlan | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isRunning = container.status.toLowerCase() === "running";
  const disabled = isRunning || applying;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setPlan(null);
    setError(null);
    setSuccess(false);
    inspectContainer(container.id)
      .then(raw => {
        if (!live) return;
        const parsed = parseInspect(raw);
        setOriginal(parsed);
        setDraft(parsed);
      })
      .catch(e => { if (live) setError(String(e?.message ?? e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [container.id]);

  /// Ask the backend what the recreate would run, so the user sees the exact
  /// command and any settings it cannot carry over before committing.
  async function handlePreview() {
    if (!original || !draft) return;
    setError(null);
    try {
      setPlan(await planRecreate(container.id, collectEdits(original, draft)));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function handleApply() {
    if (!original || !draft) return;
    setApplying(true);
    setError(null);
    try {
      await recreateContainer(container.id, collectEdits(original, draft));
      setOriginal(draft);
      setPlan(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setApplying(false);
    }
  }

  function updatePort(i: number, val: string) {
    if (!draft) return;
    const ports = [...draft.ports];
    ports[i] = val;
    setDraft({ ...draft, ports });
  }
  function addPort() { if (draft) setDraft({ ...draft, ports: [...draft.ports, ""] }); }
  function removePort(i: number) { if (draft) setDraft({ ...draft, ports: draft.ports.filter((_, j) => j !== i) }); }

  function updateEnv(i: number, val: string) {
    if (!draft) return;
    const env = [...draft.env];
    env[i] = val;
    setDraft({ ...draft, env });
  }
  function addEnv() { if (draft) setDraft({ ...draft, env: [...draft.env, ""] }); }
  function removeEnv(i: number) { if (draft) setDraft({ ...draft, env: draft.env.filter((_, j) => j !== i) }); }

  const changes = original && draft ? diffConfigs(original, draft) : [];

  if (loading) return <div className={styles.msg}>Loading configuration…</div>;
  if (!draft) return <div className={styles.msg}>{error ?? "No configuration available."}</div>;

  return (
    <div className={styles.root}>
      {isRunning && (
        <div className={styles.notice}>Stop the container to edit its configuration.</div>
      )}
      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>Container recreated successfully.</div>}

      {!plan && <div className={`${styles.form} ${disabled ? styles.formDisabled : ""}`}>
        <div className={styles.row}>
          <label className={styles.label}>CPUs</label>
          <input
            className={styles.input}
            type="number"
            min={1}
            step={1}
            placeholder="Default"
            value={draft.cpus}
            onChange={e => setDraft({ ...draft, cpus: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Memory</label>
          <input
            className={styles.input}
            placeholder="e.g. 2g, 512m"
            value={draft.memory}
            onChange={e => setDraft({ ...draft, memory: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionLabel}>Ports</span>
            {!disabled && (
              <button className={styles.addBtn} type="button" onClick={addPort}>+ Add</button>
            )}
          </div>
          {draft.ports.map((p, i) => (
            <div key={i} className={styles.listRow}>
              <input
                className={`${styles.input} ${styles.mono}`}
                placeholder="hostPort:containerPort"
                value={p}
                onChange={e => updatePort(i, e.target.value)}
                disabled={disabled}
              />
              {!disabled && (
                <button className={styles.removeBtn} type="button" onClick={() => removePort(i)}>×</button>
              )}
            </div>
          ))}
          {draft.ports.length === 0 && <div className={styles.empty}>No port mappings.</div>}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionLabel}>Environment Variables</span>
            {!disabled && (
              <button className={styles.addBtn} type="button" onClick={addEnv}>+ Add</button>
            )}
          </div>
          {draft.env.map((e, i) => (
            <div key={i} className={styles.listRow}>
              <input
                className={`${styles.input} ${styles.mono}`}
                placeholder="KEY=VALUE"
                value={e}
                onChange={ev => updateEnv(i, ev.target.value)}
                disabled={disabled}
              />
              {!disabled && (
                <button className={styles.removeBtn} type="button" onClick={() => removeEnv(i)}>×</button>
              )}
            </div>
          ))}
          {draft.env.length === 0 && <div className={styles.empty}>No environment variables.</div>}
        </div>
      </div>}

      {!isRunning && (
        <div className={styles.footer}>
          {plan ? (
            <div className={styles.confirm}>
              <div className={styles.confirmTitle}>Recreate container with these changes?</div>
              <ul className={styles.diffList}>
                {changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              {plan.unsupported.length > 0 && (
                <div className={styles.notice}>
                  <div>
                    The container CLI has no way to set the following, so recreating drops it:
                  </div>
                  <ul className={styles.diffList}>
                    {plan.unsupported.map((u, i) => <li key={i}>{u}</li>)}
                  </ul>
                </div>
              )}
              <div className={styles.confirmTitle}>This will delete and re-run the container:</div>
              <pre className={styles.command}>{`container ${plan.args.join(" ")}`}</pre>
              <div className={styles.confirmActions}>
                <button
                  className={styles.btnGhost}
                  onClick={() => setPlan(null)}
                  disabled={applying}
                >
                  Cancel
                </button>
                <button
                  className={styles.btnPrimary}
                  onClick={handleApply}
                  disabled={applying}
                >
                  {applying ? "Applying…" : "Confirm & Recreate"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className={styles.btnPrimary}
              disabled={changes.length === 0 || applying}
              onClick={handlePreview}
            >
              Apply Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
