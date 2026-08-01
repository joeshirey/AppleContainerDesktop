import { useCallback, useEffect, useRef, useState } from "react";
import { builderStatus, builderStart, builderStop, builderDelete } from "../api";
import { StatusDot } from "../components/StatusDot";
import { positiveInt, CPUS_INVALID } from "../lib/validation";
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
  const [acting, setActing] = useState(false);
  const tokenRef = useRef(0);

  // Each call claims a token by incrementing the counter before the async
  // fetch. State updates are discarded when the token no longer matches the
  // counter — which happens on unmount (the cleanup bumps the counter) or when
  // a newer refresh supersedes this one.
  const refresh = useCallback(async ({ keepError = false }: { keepError?: boolean } = {}) => {
    const token = ++tokenRef.current;
    try {
      const s = await builderStatus();
      if (token !== tokenRef.current) return;
      setState(s);
      if (!keepError) setError(null);
    } catch (e) {
      if (token !== tokenRef.current) return;
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    // Invalidate any pending refresh when the component unmounts so a stale
    // response cannot overwrite state on an already-gone component.
    return () => { tokenRef.current++; };
  }, [refresh]);

  async function act(action: () => Promise<void>) {
    // Clear any leftover error before the new action so the banner does not
    // persist during a retry.
    setError(null);
    setActing(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(message(e));
      // Refresh even on failure: the action may have partially succeeded (e.g.
      // the builder container was created but failed to boot) and the user
      // needs to see the real state to decide what to do next.
      await refresh({ keepError: true });
    } finally {
      setActing(false);
      setConfirmDelete(false);
    }
  }

  function handleStart() {
    if (cpus.trim() !== "" && positiveInt(cpus) === undefined) {
      setError(CPUS_INVALID);
      return;
    }
    // Don't await — the return value of event handlers is ignored by React,
    // and the async work is tracked through `acting` state instead.
    void act(() => builderStart(positiveInt(cpus), memory.trim() || undefined));
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
              <input
                id="builder-cpus"
                className={styles.input}
                type="number"
                min={1}
                step={1}
                placeholder="e.g. 4"
                value={cpus}
                onChange={e => setCpus(e.target.value)}
                disabled={acting}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="builder-memory">Memory</label>
              <input
                id="builder-memory"
                className={styles.input}
                placeholder="e.g. 8G"
                value={memory}
                onChange={e => setMemory(e.target.value)}
                disabled={acting}
              />
            </div>
          </>
        )}
        <div className={styles.actions}>
          {running ? (
            <button
              className={styles.btn}
              onClick={() => act(() => builderStop())}
              disabled={acting}
            >
              Stop
            </button>
          ) : (
            <button
              className={styles.btn}
              onClick={handleStart}
              disabled={acting}
            >
              {acting ? "Starting…" : "Start"}
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
                <button
                  className={styles.btnDanger}
                  onClick={() => act(() => builderDelete())}
                  disabled={acting}
                >
                  Confirm Delete
                </button>
                <button
                  className={styles.btn}
                  onClick={() => setConfirmDelete(false)}
                  disabled={acting}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className={styles.btnDanger}
                onClick={() => setConfirmDelete(true)}
                disabled={acting}
              >
                Delete
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
