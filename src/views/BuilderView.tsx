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
  // CLI-level error: set by refresh's catch path or by an action's catch.
  // Cleared by act() at the start of every action, and by refresh's success
  // path when keepError is false (the default).
  const [error, setError] = useState<string | null>(null);
  // Client-side validation error for the CPUs field. Lives independently from
  // `error` so that a status refresh landing mid-validation cannot wipe the
  // message while the user's invalid value is still in the box.
  // Cleared when the user edits the field or when an action starts.
  const [cpuError, setCpuError] = useState<string | null>(null);
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
      // Currently unreachable as a difference-maker: act() always calls
      // setError(null) before triggering a refresh, so error is already null
      // by the time this line runs on any action's success path, and the mount
      // refresh sees error=null at initialisation. The clear stays because the
      // reachability argument depends on no second synchronous error producer
      // existing — Finding A was exactly that scenario — and a future change
      // could create another.
      if (!keepError) setError(null);
    } catch (e) {
      if (token !== tokenRef.current) return;
      // Honour the flag in the catch path too: if the caller has already set
      // an action error and wants it preserved, a failing follow-up status
      // check must not overwrite it with a potentially unrelated network error.
      if (!keepError) setError(message(e));
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
    setCpuError(null);
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
      // Validation error lives in its own slot so that the status refresh
      // landing later cannot wipe it while the invalid value is still in the
      // CPUs box. Clear `error` too: clicking Start is a new attempt and the
      // user should not see a stale CLI error resurface when they later clear
      // the CPUs field (which clears cpuError via onChange but leaves error).
      setError(null);
      setCpuError(CPUS_INVALID);
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

  // Validation messages take priority over CLI errors; both render through the
  // same banner so the user never sees two red boxes at once. cpuError is only
  // shown while the CPUs field is visible: once the builder is running the
  // field unmounts and there is no longer a way for the user to correct it, so
  // the message would be misleading noise.
  const banner = (!running ? cpuError : null) ?? error;

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Builder</h1>
      <p className={styles.desc}>
        Image builds run inside a dedicated container. It starts on demand and
        keeps its CPU and memory until you stop it.
      </p>
      {banner && <div className={styles.error}>{banner}</div>}
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
                onChange={e => { setCpus(e.target.value); setCpuError(null); }}
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
