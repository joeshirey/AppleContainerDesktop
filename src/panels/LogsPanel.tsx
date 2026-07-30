import { useState, useEffect, useRef, useCallback } from "react";
import { getLogs, getMachineLogs } from "../api";
import { useSettings } from "../hooks/useSettings";
import styles from "./LogsPanel.module.css";

/// Containers and machines both have logs, but they are different CLI commands
/// and only a machine has a boot log.
export type LogSource =
  | { kind: "container"; id: string }
  | { kind: "machine"; name: string };

export function LogsPanel({ source }: { source: LogSource }) {
  const { settings } = useSettings();
  const [logs, setLogs] = useState("");
  const [follow, setFollow] = useState(false);
  const [boot, setBoot] = useState(false);
  const [lines, setLines] = useState(100);

  useEffect(() => {
    setLines(settings.defaultLogLines);
  }, [settings.defaultLogLines]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Every dependency here is a primitive, so the effects below re-run exactly
  // when the thing being read changes and never merely because we re-rendered.
  const target = source.kind === "container" ? source.id : source.name;
  const read = useCallback(
    () => (source.kind === "container" ? getLogs(target, lines) : getMachineLogs(target, lines, boot)),
    [source.kind, target, lines, boot]
  );

  const fetchLogs = useCallback(async () => {
    try { setLogs(await read()); }
    catch (e) { setLogs(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [read]);

  useEffect(() => {
    let live = true;
    read()
      .then(result => { if (live) setLogs(result); })
      .catch(e => { if (live) setLogs(`Error: ${e instanceof Error ? e.message : String(e)}`); });
    return () => { live = false; };
  }, [read]);

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
        {source.kind === "machine" && (
          <label className={styles.follow}>
            <input type="checkbox" checked={boot} onChange={e => setBoot(e.target.checked)} aria-label="Boot log" />
            Boot log
          </label>
        )}
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
