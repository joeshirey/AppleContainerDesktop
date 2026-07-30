import { useState } from "react";
import { execInContainer, machineRun } from "../api";
import styles from "./ExecPanel.module.css";

type Entry = { text: string; isError: boolean };

/// A container is entered with `exec`, a machine with `machine run`. The two
/// take the command differently, which is the only reason this distinction
/// reaches the panel.
export type ExecTarget =
  | { kind: "container"; id: string }
  | { kind: "machine"; name: string };

export function ExecPanel({ target }: { target: ExecTarget }) {
  const [cmd, setCmd] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cmd.trim()) return;
    setBusy(true);
    try {
      const out = target.kind === "container"
        ? await execInContainer(target.id, cmd)
        : await machineRun(target.name, cmd);
      setEntries(prev => [...prev, { text: `$ ${cmd}\n${out}`, isError: false }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEntries(prev => [...prev, { text: `$ ${cmd}\nError: ${msg}`, isError: true }]);
    } finally { setBusy(false); setCmd(""); }
  }

  return (
    <div className={styles.root}>
      <div className={styles.term}>
        {entries.length === 0 && (
          <span className={styles.hint}>
            Run a command inside the {target.kind}. Each command runs independently — chain
            with <code>&amp;&amp;</code> for multi-step operations.
            {target.kind === "machine" && " The machine is booted first if it is stopped."}
          </span>
        )}
        {entries.map((entry, i) => (
          <pre key={i} className={entry.isError ? styles.err : styles.out}>{entry.text}</pre>
        ))}
      </div>
      <form className={styles.row} onSubmit={submit}>
        <span className={styles.prompt}>$</span>
        <input
          className={styles.input}
          aria-label="Command"
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          placeholder={target.kind === "machine"
            ? "e.g. nproc or cat /proc/cpuinfo | head"
            : "e.g. ls /app or cd /tmp && cat file.txt"}
          disabled={busy}
        />
        <button className={styles.btn} type="submit" disabled={busy || !cmd.trim()}>Run</button>
      </form>
    </div>
  );
}
