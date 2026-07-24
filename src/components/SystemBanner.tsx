import styles from "./SystemBanner.module.css";

export function SystemBanner({ running, onStart }: { running: boolean; onStart: () => void }) {
  if (running) return null;
  return (
    <div className={styles.banner}>
      <span>Container system is not running.</span>
      <button className={styles.btn} onClick={onStart}>Start System</button>
    </div>
  );
}
