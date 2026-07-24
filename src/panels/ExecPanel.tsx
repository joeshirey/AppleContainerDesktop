import { useState } from "react";
import { execInContainer } from "../api";
import styles from "./ExecPanel.module.css";

type Entry = { text: string; isError: boolean };

export function ExecPanel({ containerId }: { containerId: string }) {
  const [cmd, setCmd] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cmd.trim()) return;
    setBusy(true);
    try {
      const out = await execInContainer(containerId, cmd);
      setEntries(prev => [...prev, { text: `$ ${cmd}\n${out}`, isError: false }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEntries(prev => [...prev, { text: `$ ${cmd}\nError: ${msg}`, isError: true }]);
    } finally { setBusy(false); setCmd(""); }
  }

  return (
    <div className={styles.root}>
      <div className={styles.term}>
        {entries.length === 0 && <span className={styles.hint}>Run a command inside the container.</span>}
        {entries.map((entry, i) => (
          <pre key={i} className={entry.isError ? styles.err : styles.out}>{entry.text}</pre>
        ))}
      </div>
      <form className={styles.row} onSubmit={submit}>
        <span className={styles.prompt}>$</span>
        <input
          className={styles.input}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          placeholder="Type a command..."
          disabled={busy}
        />
        <button className={styles.btn} type="submit" disabled={busy || !cmd.trim()}>Run</button>
      </form>
    </div>
  );
}
