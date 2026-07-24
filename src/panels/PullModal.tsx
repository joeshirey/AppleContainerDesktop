import { useState } from "react";
import { pullImage } from "../api";
import styles from "./PullModal.module.css";

export function PullModal({ onClose, onPulled }: { onClose: () => void; onPulled: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePull() {
    setBusy(true);
    setError(null);
    try {
      await pullImage(name.trim());
      onPulled();
      onClose();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <h2 className={styles.title}>Pull Image</h2>
        <label className={styles.label}>Image name</label>
        <input
          className={styles.input}
          placeholder="e.g. nginx:latest, postgres:16"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !busy && name.trim() && handlePull()}
          disabled={busy}
          autoFocus
        />
        {error && <div className={styles.error}>{error}</div>}
        {busy && <div className={styles.progress}>Pulling… this may take a minute</div>}
        <div className={styles.actions}>
          <button className={styles.btnCancel} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={styles.btnPull} onClick={handlePull} disabled={!name.trim() || busy}>
            {busy ? "Pulling…" : "Pull"}
          </button>
        </div>
      </div>
    </div>
  );
}
