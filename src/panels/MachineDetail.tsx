import { useState } from "react";
import { stopMachine, deleteMachine, setDefaultMachine } from "../api";
import type { Machine } from "../types";
import styles from "./MachineDetail.module.css";

export function MachineDetail({ machine, onAction }: { machine: Machine; onAction: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className={styles.body}>
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
      </div>
    </div>
  );
}
