import styles from "./SystemBanner.module.css";

export function SystemBanner({
  running,
  onStart,
  onStop,
}: {
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  if (running) {
    return (
      <div className={styles.bannerRunning}>
        <span>Container system is running.</span>
        <button className={styles.btnStop} onClick={onStop}>Stop System</button>
      </div>
    );
  }
  return (
    <div className={styles.banner}>
      <span>Container system is not running.</span>
      <button className={styles.btn} onClick={onStart}>Start System</button>
    </div>
  );
}
