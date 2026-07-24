import { useState, useEffect, useRef, useCallback } from "react";
import { getLogs } from "../api";
import { useSettings } from "../hooks/useSettings";
import styles from "./LogsPanel.module.css";

export function LogsPanel({ containerId }: { containerId: string }) {
  const { settings } = useSettings();
  const [logs, setLogs] = useState("");
  const [follow, setFollow] = useState(false);
  const [lines, setLines] = useState(100);

  useEffect(() => {
    setLines(settings.defaultLogLines);
  }, [settings.defaultLogLines]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try { setLogs(await getLogs(containerId, lines)); }
    catch (e) { setLogs(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [containerId, lines]);

  useEffect(() => {
    let live = true;
    getLogs(containerId, lines)
      .then(result => { if (live) setLogs(result); })
      .catch(e => { if (live) setLogs(`Error: ${e instanceof Error ? e.message : String(e)}`); });
    return () => { live = false; };
  }, [containerId, lines]);

  useEffect(() => {
    if (!follow) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(fetchLogs, 2000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [follow, fetchLogs]);

  useEffect(() => { bottom.current?.scrollIntoView(); }, [logs]);

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <label className={styles.follow}>
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} aria-label="Follow logs" />
          Follow
        </label>
        <select className={styles.sel} value={lines} onChange={e => setLines(Number(e.target.value))}>
          <option value={100}>Last 100</option>
          <option value={500}>Last 500</option>
          <option value={1000}>Last 1000</option>
        </select>
      </div>
      <div className={styles.out}><pre>{logs || "No logs yet."}</pre><div ref={bottom} /></div>
    </div>
  );
}
