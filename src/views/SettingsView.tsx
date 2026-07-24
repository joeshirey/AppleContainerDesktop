import { useSettings } from "../hooks/useSettings";
import styles from "./SettingsView.module.css";

export function SettingsView() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Settings</h1>
      <div className={styles.section}>
        <div className={styles.row}>
          <div className={styles.rowInfo}>
            <label className={styles.label}>Poll Interval</label>
            <span className={styles.desc}>How often to refresh the containers list</span>
          </div>
          <select
            className={styles.select}
            value={settings.pollInterval}
            onChange={e => updateSettings({ pollInterval: Number(e.target.value) })}
          >
            <option value={2000}>2 seconds</option>
            <option value={5000}>5 seconds</option>
            <option value={10000}>10 seconds</option>
            <option value={30000}>30 seconds</option>
          </select>
        </div>
        <div className={styles.row}>
          <div className={styles.rowInfo}>
            <label className={styles.label}>Log Lines</label>
            <span className={styles.desc}>Lines to retrieve when viewing container output</span>
          </div>
          <select
            className={styles.select}
            value={settings.defaultLogLines}
            onChange={e => updateSettings({ defaultLogLines: Number(e.target.value) })}
          >
            <option value={100}>Last 100</option>
            <option value={500}>Last 500</option>
            <option value={1000}>Last 1000</option>
          </select>
        </div>
      </div>
    </div>
  );
}
