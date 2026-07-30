import { useState, useEffect, useCallback } from "react";
import { listVolumes, createVolume, deleteVolume, pruneVolumes } from "../api";
import type { Volume } from "../types";
import styles from "./VolumesView.module.css";

function CreateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      // An empty size means "don't pass -s", which lets the CLI pick its
      // default rather than us inventing one.
      await createVolume(name.trim(), size.trim() || undefined);
      onCreated();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.createForm}>
      <label className={styles.createLabel} htmlFor="vol-name">Name</label>
      <input id="vol-name" className={styles.createInput} placeholder="pgdata"
        value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      <label className={styles.createLabel} htmlFor="vol-size">Size (optional)</label>
      <input id="vol-size" className={styles.createInput} placeholder="10G, 512M…"
        value={size} onChange={e => setSize(e.target.value)} disabled={busy} />
      <span className={styles.createHint}>
        The image is sparse, so the size is a ceiling and costs nothing up front.
      </span>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.createActions}>
        <button className={styles.btnGhost} onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={styles.btnPrimary} onClick={handleCreate} disabled={!name.trim() || busy}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

export function VolumesView() {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [pruned, setPruned] = useState<string | null>(null);

  const fetchVolumes = useCallback(async () => {
    try {
      setVolumes(await listVolumes());
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVolumes(); }, [fetchVolumes]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await fetchVolumes(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function handleDelete(name: string) {
    await run(() => deleteVolume(name));
    setConfirmDelete(null);
  }

  async function handlePrune() {
    setError(null);
    try {
      setPruned(await pruneVolumes());
      await fetchVolumes();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setConfirmPrune(false);
    }
  }

  function formatDate(iso: string) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Volumes</span>
        <button className={styles.btnGhost} onClick={() => setShowCreate(true)}>+ Create</button>
        {confirmPrune ? (
          <>
            <button className={styles.btnDanger} onClick={handlePrune}>Confirm Prune</button>
            <button className={styles.btnGhost} onClick={() => setConfirmPrune(false)}>Cancel</button>
          </>
        ) : (
          <button className={styles.btnGhost} onClick={() => { setPruned(null); setConfirmPrune(true); }}>
            Prune Unused
          </button>
        )}
      </div>

      {/* Prune is irreversible and takes the filesystems with it, which
          "prune unused" on its own does not convey. */}
      {confirmPrune && (
        <div className={styles.warn}>
          This permanently deletes every volume no container references, along with
          all of their contents. There is no undo.
        </div>
      )}
      {pruned && <div className={styles.notice}>{pruned.trim() || "Nothing to reclaim."}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {showCreate && (
        <CreateForm
          onCreated={() => { setShowCreate(false); fetchVolumes(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className={styles.tableWrap} role="table" aria-label="Volumes">
        <div className={styles.tableHeader} role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">On disk</span>
          <span role="columnheader">Provisioned</span>
          <span role="columnheader">In use by</span>
          <span role="columnheader">Created</span>
          <span role="columnheader" />
        </div>
        {loading && <div className={styles.msg}>Loading…</div>}
        {!loading && volumes.length === 0 && <div className={styles.msg}>No volumes.</div>}
        {volumes.map(v => (
          <div key={v.name} className={styles.row} role="row">
            <span className={styles.name} role="cell" title={v.source}>{v.name}</span>
            <span className={styles.meta} role="cell">{v.onDisk}</span>
            <span className={styles.dim} role="cell">{v.provisioned}</span>
            <span className={styles.dim} role="cell">
              {v.inUseBy.length ? v.inUseBy.join(", ") : "—"}
            </span>
            <span className={styles.dim} role="cell">{formatDate(v.created)}</span>
            <div className={styles.actions} role="cell">
              {confirmDelete === v.name ? (
                <>
                  <button className={styles.actBtnDanger} onClick={() => handleDelete(v.name)}>
                    Confirm Delete
                  </button>
                  <button className={styles.actBtn} onClick={() => setConfirmDelete(null)}>Cancel</button>
                </>
              ) : (
                // The CLI refuses to delete a mounted volume, so the button is
                // dead rather than absent — the reason is in the tooltip.
                <button
                  className={styles.actBtnDanger}
                  disabled={v.inUseBy.length > 0}
                  title={v.inUseBy.length ? `Mounted by ${v.inUseBy.join(", ")}` : undefined}
                  onClick={() => setConfirmDelete(v.name)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
