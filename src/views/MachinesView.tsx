import { useState } from "react";
import { useMachines } from "../hooks/useMachines";
import { createMachine } from "../api";
import { MachineDetail } from "../panels/MachineDetail";
import type { Machine } from "../types";
import styles from "./MachinesView.module.css";

function CreateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      await createMachine({ image: image.trim(), name: name.trim() || undefined });
      onCreated();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.createForm}>
      <h3 className={styles.createTitle}>Create Machine</h3>
      <label className={styles.createLabel}>Image</label>
      <input className={styles.createInput} placeholder="alpine:3.22, ubuntu:24.04…" value={image} onChange={e => setImage(e.target.value)} disabled={busy} />
      <label className={styles.createLabel}>Name (optional)</label>
      <input className={styles.createInput} placeholder="my-machine" value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      {error && <div className={styles.createError}>{error}</div>}
      <div className={styles.createActions}>
        <button className={styles.btnCancel} onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={styles.btnCreate} onClick={handleCreate} disabled={!image.trim() || busy}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

export function MachinesView() {
  const { machines, loading, error, refresh } = useMachines();
  const [selected, setSelected] = useState<Machine | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function handleCreated() {
    setShowCreate(false);
    refresh();
  }

  return (
    <div className={styles.root}>
      <div className={styles.list}>
        <div className={styles.toolbar}>
          <span className={styles.toolbarTitle}>Machines</span>
          <button className={styles.btnPrimary} onClick={() => setShowCreate(true)}>+ Create</button>
        </div>
        {error && <div className={styles.errMsg}>{error}</div>}
        {loading && <div className={styles.msg}>Loading…</div>}
        {!loading && machines.length === 0 && (
          <div className={styles.msg}>No machines. Click &ldquo;+ Create&rdquo; to get started.</div>
        )}
        {machines.map(m => (
          <button
            key={m.name}
            className={`${styles.row} ${selected?.name === m.name ? styles.selected : ""}`}
            onClick={() => { setSelected(m); setShowCreate(false); }}
          >
            <span className={`${styles.dot} ${m.status === "running" ? styles.dotRunning : styles.dotStopped}`} />
            <div className={styles.rowInfo}>
              <div className={styles.rowName}>{m.name}</div>
              {m.isDefault && <span className={styles.defaultPill}>Default</span>}
            </div>
          </button>
        ))}
      </div>
      <div className={styles.detail}>
        {showCreate && (
          <CreateForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
        )}
        {!showCreate && selected && (
          <MachineDetail
            machine={machines.find(m => m.name === selected.name) ?? selected}
            onAction={refresh}
          />
        )}
        {!showCreate && !selected && (
          <div className={styles.placeholder}>Select a machine to see details.</div>
        )}
      </div>
    </div>
  );
}
