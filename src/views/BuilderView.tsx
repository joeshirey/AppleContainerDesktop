import { useCallback, useEffect, useState } from "react";
import { builderStatus, builderStart, builderStop, builderDelete } from "../api";
import { StatusDot } from "../components/StatusDot";
import type { BuilderState } from "../types";
import styles from "./BuilderView.module.css";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function BuilderView() {
  const [state, setState] = useState<BuilderState | null>(null);
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await builderStatus());
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function act(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setConfirmDelete(false);
    }
  }

  const exists = state?.exists ?? false;
  const running = state?.running ?? false;

  // Three states, because "no builder container at all" is what a machine that
  // has never built anything reports and it is not the same as stopped.
  const label = !state ? "Checking…" : running ? "Running" : exists ? "Stopped" : "Not created";

  // The allocation comes from the container's own configuration and survives a
  // stop, so it is worth showing either way.
  const allocation = [
    state?.cpus != null ? `${state.cpus} CPUs` : null,
    state?.memoryMb != null ? `${state.memoryMb} MB` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Only when the CLI said something this build does not have a label for.
  const unrecognised = state !== null && state.raw !== "" && state.raw !== "running" && state.raw !== "stopped";

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Builder</h1>
      <p className={styles.desc}>
        Image builds run inside a dedicated container. It starts on demand and
        keeps its CPU and memory until you stop it.
      </p>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.card}>
        <div className={styles.statusRow}>
          <StatusDot status={running ? "running" : "stopped"} />
          <span className={styles.status}>{label}</span>
          {allocation && <span className={styles.alloc}>{allocation}</span>}
        </div>
        {unrecognised && <span className={styles.raw}>{state.raw}</span>}
        {!running && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="builder-cpus">CPUs</label>
              <input id="builder-cpus" className={styles.input} value={cpus} onChange={e => setCpus(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="builder-memory">Memory</label>
              <input id="builder-memory" className={styles.input} placeholder="e.g. 8G" value={memory} onChange={e => setMemory(e.target.value)} />
            </div>
          </>
        )}
        <div className={styles.actions}>
          {running ? (
            <button className={styles.btn} onClick={() => act(() => builderStop())}>Stop</button>
          ) : (
            <button
              className={styles.btn}
              onClick={() => act(() => builderStart(cpus.trim() ? Number(cpus) : undefined, memory.trim() || undefined))}
            >
              Start
            </button>
          )}
          {/*
            Nothing to delete until a builder container exists, and not while
            it is running: `container builder delete` refuses a running builder
            unless given --force, and the confirm below says only "Confirm
            Delete" — nothing that would warn you it is about to kill a live
            VM. Stop first, then Delete.
          */}
          {exists &&
            !running &&
            (confirmDelete ? (
              <>
                <button className={styles.btnDanger} onClick={() => act(() => builderDelete())}>Confirm Delete</button>
                <button className={styles.btn} onClick={() => setConfirmDelete(false)}>Cancel</button>
              </>
            ) : (
              <button className={styles.btnDanger} onClick={() => setConfirmDelete(true)}>Delete</button>
            ))}
        </div>
      </div>
    </div>
  );
}
