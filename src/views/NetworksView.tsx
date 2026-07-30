import { useState, useEffect, useCallback } from "react";
import { listNetworks, createNetwork, deleteNetwork, pruneNetworks } from "../api";
import type { Network } from "../types";
import styles from "./NetworksView.module.css";

function CreateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [subnet, setSubnet] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      // An empty subnet leaves the CLI to allocate one, which is what you
      // want unless you are avoiding a clash with something on the host.
      await createNetwork(name.trim(), { subnet: subnet.trim() || undefined, internal });
      onCreated();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.createForm}>
      <label className={styles.createLabel} htmlFor="net-name">Name</label>
      <input id="net-name" className={styles.createInput} placeholder="lab"
        value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      <label className={styles.createLabel} htmlFor="net-subnet">Subnet (optional)</label>
      <input id="net-subnet" className={styles.createInput} placeholder="10.1.0.0/24"
        value={subnet} onChange={e => setSubnet(e.target.value)} disabled={busy} />
      <label className={styles.checkRow}>
        <input type="checkbox" checked={internal} disabled={busy}
          onChange={e => setInternal(e.target.checked)} aria-label="Host-only (internal)" />
        Host-only — containers on it cannot reach outside the Mac.
      </label>
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

export function NetworksView() {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPrune, setConfirmPrune] = useState(false);

  const fetchNetworks = useCallback(async () => {
    try {
      setNetworks(await listNetworks());
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNetworks(); }, [fetchNetworks]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await fetchNetworks(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function handleDelete(name: string) {
    await run(() => deleteNetwork(name));
    setConfirmDelete(null);
  }

  async function handlePrune() {
    await run(pruneNetworks);
    setConfirmPrune(false);
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Networks</span>
        <button className={styles.btnGhost} onClick={() => setShowCreate(true)}>+ Create</button>
        {confirmPrune ? (
          <>
            <button className={styles.btnDanger} onClick={handlePrune}>Confirm Prune</button>
            <button className={styles.btnGhost} onClick={() => setConfirmPrune(false)}>Cancel</button>
          </>
        ) : (
          <button className={styles.btnGhost} onClick={() => setConfirmPrune(true)}>Prune Unused</button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {showCreate && (
        <CreateForm
          onCreated={() => { setShowCreate(false); fetchNetworks(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className={styles.tableWrap} role="table" aria-label="Networks">
        <div className={styles.tableHeader} role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Subnet</span>
          <span role="columnheader">Gateway</span>
          <span role="columnheader">Mode</span>
          <span role="columnheader">In use by</span>
          <span role="columnheader" />
        </div>
        {loading && <div className={styles.msg}>Loading…</div>}
        {!loading && networks.length === 0 && <div className={styles.msg}>No networks.</div>}
        {networks.map(n => (
          <div key={n.name} className={styles.row} role="row">
            <span className={styles.name} role="cell" title={n.plugin}>{n.name}</span>
            <span className={styles.mono} role="cell">{n.subnet ?? "—"}</span>
            <span className={styles.mono} role="cell">{n.gateway ?? "—"}</span>
            <span className={styles.dim} role="cell">{n.mode || "—"}</span>
            <span className={styles.dim} role="cell">
              {n.inUseBy.length ? n.inUseBy.join(", ") : "—"}
            </span>
            <div className={styles.actions} role="cell">
              {/* The CLI owns this one and refuses to delete it, so there is
                  no button to offer — only an explanation. */}
              {n.isBuiltin ? (
                <span className={styles.pill}>Built-in</span>
              ) : confirmDelete === n.name ? (
                <>
                  <button className={styles.actBtnDanger} onClick={() => handleDelete(n.name)}>
                    Confirm Delete
                  </button>
                  <button className={styles.actBtn} onClick={() => setConfirmDelete(null)}>Cancel</button>
                </>
              ) : (
                <button
                  className={styles.actBtnDanger}
                  disabled={n.inUseBy.length > 0}
                  title={n.inUseBy.length ? `Attached to ${n.inUseBy.join(", ")}` : undefined}
                  onClick={() => setConfirmDelete(n.name)}
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
