import { useState, useEffect } from "react";
import { stopMachine, deleteMachine, setDefaultMachine, setMachineConfig } from "../api";
import type { Machine, MachineEdits } from "../types";
import { LogsPanel } from "./LogsPanel";
import { ExecPanel } from "./ExecPanel";
import styles from "./MachineDetail.module.css";

type Tab = "info" | "logs" | "shell" | "settings";
const TABS: Tab[] = ["info", "logs", "shell", "settings"];

export function MachineDetail({ machine, onAction }: { machine: Machine; onAction: () => void }) {
  const [tab, setTab] = useState<Tab>("info");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setConfirmDelete(false); setTab("info"); }, [machine.name]);

  async function act(fn: () => Promise<void>) {
    setError(null);
    try { await fn(); onAction(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.name}>
            {machine.name}
            {machine.isDefault && <span className={styles.defaultBadge}>Default</span>}
          </div>
          <div className={styles.status}>{machine.status}</div>
        </div>
        <div className={styles.actions}>
          {!machine.isDefault && (
            <button className={styles.btnGhost} onClick={() => act(() => setDefaultMachine(machine.name))}>
              Set Default
            </button>
          )}
          {machine.status === "running" && (
            <button className={styles.btnStop} onClick={() => act(() => stopMachine(machine.name))}>Stop</button>
          )}
          {confirmDelete ? (
            <>
              <button className={styles.btnDanger} onClick={() => act(() => deleteMachine(machine.name))}>Confirm Delete</button>
              <button className={styles.btnGhost} onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <button className={styles.btnDanger} onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t}
            role="tab"
            className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {tab === "info" && (
          <div className={styles.grid}>
            {machine.cpus !== undefined && (
              <div className={styles.card}>
                <div className={styles.cardLabel}>CPUs</div>
                <div className={styles.cardValue}>{machine.cpus} CPUs</div>
              </div>
            )}
            {machine.memoryMB !== undefined && (
              <div className={styles.card}>
                <div className={styles.cardLabel}>Memory</div>
                <div className={styles.cardValue}>{machine.memoryMB} MB</div>
              </div>
            )}
          </div>
        )}
        {tab === "logs" && <LogsPanel source={{ kind: "machine", name: machine.name }} />}
        {tab === "shell" && <ExecPanel target={{ kind: "machine", name: machine.name }} />}
        {tab === "settings" && <MachineSettings machine={machine} onApplied={onAction} />}
      </div>
    </div>
  );
}

const HOME_MOUNTS = ["rw", "ro", "none"] as const;

function MachineSettings({ machine, onApplied }: { machine: Machine; onApplied: () => void }) {
  const initialCpus = machine.cpus !== undefined ? String(machine.cpus) : "";
  const [cpus, setCpus] = useState(initialCpus);
  const [memory, setMemory] = useState("");
  const [homeMount, setHomeMount] = useState<"" | (typeof HOME_MOUNTS)[number]>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    setCpus(machine.cpus !== undefined ? String(machine.cpus) : "");
    setMemory("");
    setHomeMount("");
    setApplied(false);
    setError(null);
  }, [machine.name, machine.cpus]);

  // Only fields the user actually touched are sent, so an untouched panel
  // cannot quietly rewrite a setting it merely displayed.
  const edits: MachineEdits = {};
  if (cpus !== initialCpus && cpus.trim() !== "") edits.cpus = Number(cpus);
  if (memory.trim() !== "") edits.memory = memory.trim();
  if (homeMount !== "") edits.homeMount = homeMount;
  const changed = Object.keys(edits).length > 0;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await setMachineConfig(machine.name, edits);
      setApplied(true);
      onApplied();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.settings}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>CPUs</span>
        <input
          className={styles.input}
          type="number"
          min={1}
          value={cpus}
          onChange={e => setCpus(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Memory</span>
        <input
          className={styles.input}
          value={memory}
          onChange={e => setMemory(e.target.value)}
          placeholder={machine.memoryMB !== undefined ? `currently ${machine.memoryMB} MB — e.g. 8G` : "e.g. 8G"}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Home mount</span>
        <select className={styles.input} value={homeMount} onChange={e => setHomeMount(e.target.value as any)}>
          <option value="">Leave unchanged</option>
          {HOME_MOUNTS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <div className={styles.settingsFoot}>
        <button className={styles.btnApply} onClick={apply} disabled={!changed || busy}>
          {busy ? "Applying…" : "Apply"}
        </button>
        <span className={styles.note}>
          The CLI reads these on boot, so a change only takes effect after the machine restarts.
        </span>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {applied && !error && (
        <div className={styles.applied}>
          Saved. Stop and start <strong>{machine.name}</strong> for the restart to pick it up.
        </div>
      )}
    </div>
  );
}
