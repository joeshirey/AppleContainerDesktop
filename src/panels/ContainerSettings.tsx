import { useState, useEffect } from "react";
import { inspectContainer, removeContainer, runContainer } from "../api";
import type { Container } from "../types";
import styles from "./ContainerSettings.module.css";

interface ParsedConfig {
  cpus: string;
  memory: string;
  hostname: string;
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

function parseInspect(raw: any): ParsedConfig {
  const cfg = raw?.configuration ?? raw;
  const memBytes = cfg?.memoryInBytes ?? cfg?.resourceLimits?.memoryInBytes ?? 0;
  const rawPorts = cfg?.publishedPorts ?? [];
  const ports = rawPorts.map((p: any) => {
    const proto = p.protocol && p.protocol !== "tcp" ? `/${p.protocol}` : "";
    return `${p.hostPort ?? p.containerPort}:${p.containerPort}${proto}`;
  });
  return {
    cpus: String(cfg?.cpus ?? cfg?.resourceLimits?.cpus ?? ""),
    memory: bytesToMemStr(memBytes),
    hostname: cfg?.hostname ?? "",
    ports,
    env: cfg?.environment ?? cfg?.environmentVariables ?? [],
  };
}

function diffConfigs(a: ParsedConfig, b: ParsedConfig): string[] {
  const changes: string[] = [];
  if (b.cpus !== a.cpus) changes.push(`CPUs: ${a.cpus || "default"} → ${b.cpus || "default"}`);
  if (b.memory !== a.memory) changes.push(`Memory: ${a.memory || "default"} → ${b.memory || "default"}`);
  if (b.hostname !== a.hostname) changes.push(`Hostname: "${a.hostname || "—"}" → "${b.hostname || "—"}"`);
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
  const [showConfirm, setShowConfirm] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isRunning = container.status.toLowerCase() === "running";
  const disabled = isRunning || applying;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setShowConfirm(false);
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

  async function handleApply() {
    if (!draft) return;
    setApplying(true);
    setError(null);
    try {
      await removeContainer(container.id);
      await runContainer({
        image: container.image,
        name: container.id,
        ports: draft.ports.filter(Boolean),
        env: draft.env.filter(Boolean),
        cpus: draft.cpus ? Number(draft.cpus) : undefined,
        memory: draft.memory || undefined,
        hostname: draft.hostname || undefined,
        detach: true,
      });
      setOriginal(draft);
      setShowConfirm(false);
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

      {!showConfirm && <div className={`${styles.form} ${disabled ? styles.formDisabled : ""}`}>
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
        <div className={styles.row}>
          <label className={styles.label}>Hostname</label>
          <input
            className={styles.input}
            placeholder="Default"
            value={draft.hostname}
            onChange={e => setDraft({ ...draft, hostname: e.target.value })}
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
          {showConfirm ? (
            <div className={styles.confirm}>
              <div className={styles.confirmTitle}>Recreate container with these changes?</div>
              <ul className={styles.diffList}>
                {changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <div className={styles.confirmActions}>
                <button
                  className={styles.btnGhost}
                  onClick={() => setShowConfirm(false)}
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
              onClick={() => setShowConfirm(true)}
            >
              Apply Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
