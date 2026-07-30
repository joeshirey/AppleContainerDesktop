import { useState, useMemo } from "react";
import { useContainers } from "../hooks/useContainers";
import { useSettings } from "../hooks/useSettings";
import { StatusDot } from "../components/StatusDot";
import { ContainerDetail } from "../panels/ContainerDetail";
import { RunModal } from "../panels/RunModal";
import type { Container } from "../types";
import styles from "./ContainersView.module.css";

export function ContainersView() {
  const { settings } = useSettings();
  const { containers, error, loading, refresh } = useContainers(settings.pollInterval);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = containers.find(c => c.id === selectedId) ?? null;
  const [filter, setFilter] = useState("");
  const [showRun, setShowRun] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return containers.filter(c => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q));
  }, [containers, filter]);

  const running = useMemo(() => filtered.filter(c => c.status.toLowerCase() === "running"), [filtered]);
  const stopped = useMemo(() => filtered.filter(c => c.status.toLowerCase() !== "running"), [filtered]);

  if (error && (error.includes("not found") || error.includes("CLI"))) {
    return (
      <div className={styles.empty}>
        <h2>Container CLI not found</h2>
        <p>Install with: <code>brew install container</code></p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.list}>
        <div className={styles.toolbar}>
          <input className={styles.search} placeholder="Filter..." value={filter} onChange={e => setFilter(e.target.value)} />
          <button className={styles.btnPrimary} onClick={() => setShowRun(true)}>+ Run</button>
        </div>
        {loading && <div className={styles.msg}>Loading...</div>}
        {running.length > 0 && <>
          <div className={styles.group}>Running · {running.length}</div>
          {running.map(c => <Row key={c.id} c={c} selected={selectedId === c.id} onClick={() => setSelectedId(c.id)} />)}
        </>}
        {stopped.length > 0 && <>
          <div className={styles.group}>Stopped · {stopped.length}</div>
          {stopped.map(c => <Row key={c.id} c={c} selected={selectedId === c.id} onClick={() => setSelectedId(c.id)} />)}
        </>}
        {!loading && filtered.length === 0 && <div className={styles.msg}>No containers.</div>}
      </div>
      <div className={styles.detail}>
        {selected
          ? <ContainerDetail container={selected} onAction={refresh} onRemove={() => { setSelectedId(null); refresh(); }} />
          : <div className={styles.emptyDetail}>Select a container</div>}
      </div>
      {showRun && (
        <RunModal
          onClose={() => setShowRun(false)}
          onRun={refresh}
        />
      )}
    </div>
  );
}

function Row({ c, selected, onClick }: { c: Container; selected: boolean; onClick: () => void }) {
  const broken = (c.missingBindMounts?.length ?? 0) > 0;
  return (
    <button className={`${styles.row} ${selected ? styles.rowSelected : ""}`} onClick={onClick}>
      <StatusDot status={c.status} />
      <div className={styles.info}>
        <div className={styles.name}>
          {c.name}
          {broken && (
            <span className={styles.warnBadge} title="A bind mount source is missing">
              mount missing
            </span>
          )}
        </div>
        <div className={styles.meta}>{c.image}{c.ports ? ` · ${c.ports}` : ""}</div>
      </div>
    </button>
  );
}
