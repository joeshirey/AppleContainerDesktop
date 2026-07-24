import { useState, useEffect } from "react";
import type { Container, ContainerStats } from "../types";
import { getStats, stopContainer, startContainer, removeContainer } from "../api";
import { LogsPanel } from "./LogsPanel";
import { ExecPanel } from "./ExecPanel";
import styles from "./ContainerDetail.module.css";

type Tab = "info" | "logs" | "exec" | "settings";

export function ContainerDetail({ container, onAction }: { container: Container; onAction?: () => void }) {
  const [tab, setTab] = useState<Tab>("info");
  const [stats, setStats] = useState<ContainerStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isRunning = container.status.toLowerCase() === "running";

  useEffect(() => {
    if (!isRunning || tab !== "info") return;
    let live = true;
    getStats(container.id).then(s => { if (live) setStats(s); }).catch(() => {});
    return () => { live = false; };
  }, [container.id, tab, isRunning]);

  useEffect(() => { setConfirmRemove(false); }, [container.id]);

  async function act(fn: () => Promise<void>) {
    try { await fn(); setErr(null); onAction?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div>
          <div className={styles.title}>
            {container.name}
            <span className={`${styles.badge} ${isRunning ? styles.green : styles.gray}`}>
              {isRunning ? "Running" : "Stopped"}
            </span>
          </div>
          <div className={styles.sub}>{container.image}</div>
        </div>
        <div className={styles.actions}>
          {isRunning
            ? <button className={styles.btnRed} onClick={() => act(() => stopContainer(container.id))}>Stop</button>
            : <button className={styles.btnGreen} onClick={() => act(() => startContainer(container.id))}>Start</button>}
          {!confirmRemove
            ? <button className={styles.btnGhost} onClick={() => setConfirmRemove(true)}>Remove</button>
            : <>
                <button className={styles.btnRed} onClick={() => act(() => removeContainer(container.id))}>Confirm</button>
                <button className={styles.btnGhost} onClick={() => setConfirmRemove(false)}>Cancel</button>
              </>}
        </div>
      </div>

      {err && <div className={styles.errBar}>{err}</div>}

      <div className={styles.tabs}>
        {(["info","logs","exec","settings"] as Tab[]).map(t => (
          <button key={t} role="tab" className={`${styles.tab} ${tab===t ? styles.tabActive : ""}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {tab === "info" && (
          <div className={styles.infoTab}>
            {isRunning && stats && (
              <div className={styles.statsRow}>
                <Stat label="CPU" value={`${stats.cpu_percent?.toFixed(1) ?? "—"}%`} />
                <Stat label="Memory" value={stats.memory_usage ?? "—"} />
                <Stat label="CPUs" value={String(stats.cpus ?? "—")} />
              </div>
            )}
            <div className={styles.grid}>
              <Card label="Image" value={container.image} />
              <Card label="Status" value={container.status} />
              <Card label="ID" value={container.id} mono />
              {container.ports && <Card label="Ports" value={container.ports} mono />}
            </div>
          </div>
        )}
        {tab === "logs" && <LogsPanel containerId={container.id} />}
        {tab === "exec" && <ExecPanel containerId={container.id} />}
        {tab === "settings" && (
          <div className={styles.grid}>
            <Card label="Image" value={container.image} />
            {container.ports && <Card label="Ports" value={container.ports} mono />}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statVal}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function Card({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={`${styles.cardVal} ${mono ? styles.mono : ""}`}>{value}</div>
    </div>
  );
}
