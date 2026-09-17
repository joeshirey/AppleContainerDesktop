import styles from "./SystemBanner.module.css";

export function SystemBanner({
  running,
  error,
  onStart,
  onStop,
  onRetry,
}: {
  /** `null` while checking or when the check failed. */
  running: boolean | null;
  error?: string | null;
  onStart: () => void;
  onStop: () => void;
  onRetry?: () => void;
}) {
  return (
    <>
      {running === null ? (
        <div className={styles.bannerChecking}>
          <span>{error ? "Container system status is unavailable." : "Checking container system…"}</span>
          {error && onRetry && <button className={styles.btn} onClick={onRetry}>Retry</button>}
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
