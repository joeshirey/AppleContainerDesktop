import styles from "./SystemBanner.module.css";

export function SystemBanner({
  running,
  error,
  onStart,
  onStop,
}: {
  /** `null` while the first status check is still in flight. */
  running: boolean | null;
  error?: string | null;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <>
      {running === null ? (
        <div className={styles.bannerChecking}>
          <span>Checking container system…</span>
        </div>
      ) : running ? (
        <div className={styles.bannerRunning}>
          <span>Container system is running.</span>
          <button className={styles.btnStop} onClick={onStop}>Stop Containers</button>
        </div>
      ) : (
        <div className={styles.banner}>
          <span>Container system is not running.</span>
          <button className={styles.btn} onClick={onStart}>Start Containers</button>
        </div>
      )}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </>
  );
}
