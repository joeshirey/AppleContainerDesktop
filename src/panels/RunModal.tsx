import { useState } from "react";
import { runContainer } from "../api";
import styles from "./RunModal.module.css";

const csvList = (s: string): string[] | undefined =>
  s ? s.split(",").map(t => t.trim()) : undefined;

export function RunModal({ onClose, onRun, defaultImage = "" }: { onClose: () => void; onRun: () => void; defaultImage?: string }) {
  const [image, setImage] = useState(defaultImage);
  const [name, setName]   = useState("");
  const [ports, setPorts] = useState("");
  const [env, setEnv]     = useState("");
  const [cpus, setCpus]   = useState("");
  const [mem, setMem]     = useState("");
  const [detach, setDetach] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true); setErr(null);
    try {
      await runContainer({
        image, detach,
        name: name || undefined,
        ports: csvList(ports),
        env:   csvList(env),
        cpus:  cpus  ? Number(cpus) : undefined,
        memory: mem  || undefined,
      });
      onRun(); onClose();
    } catch(e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.hdr}><h2 className={styles.ttl}>Run New Container</h2></div>
        <div className={styles.body}>
          <label className={styles.lbl} htmlFor="image">Image <span className={styles.req}>*</span></label>
          <input id="image" className={styles.inp} value={image} onChange={e => setImage(e.target.value)} placeholder="nginx:latest" />

          <label className={styles.lbl}>Name</label>
          <input className={styles.inp} value={name} onChange={e => setName(e.target.value)} placeholder="my-container (optional)" />

          <label className={styles.lbl}>Ports <span className={styles.hint}>e.g. 8080:80</span></label>
          <input className={styles.inp} value={ports} onChange={e => setPorts(e.target.value)} placeholder="8080:80" />

          <label className={styles.lbl}>Env vars <span className={styles.hint}>KEY=VAL, comma-separated</span></label>
          <input className={styles.inp} value={env} onChange={e => setEnv(e.target.value)} placeholder="FOO=bar" />

          <div className={styles.row2}>
            <div>
              <label className={styles.lbl}>CPUs</label>
              <input className={styles.inp} value={cpus} onChange={e => setCpus(e.target.value)} placeholder="2" type="number" min="1" />
            </div>
            <div>
              <label className={styles.lbl}>Memory</label>
              <input className={styles.inp} value={mem} onChange={e => setMem(e.target.value)} placeholder="4g" />
            </div>
          </div>

          <label className={styles.check}>
            <input type="checkbox" checked={detach} onChange={e => setDetach(e.target.checked)} />
            Run detached
          </label>

          {err && <div className={styles.err}>{err}</div>}
        </div>
        <div className={styles.ftr}>
          <button className={styles.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={styles.run} onClick={go} disabled={!image.trim() || busy}>
            {busy ? "Starting…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
