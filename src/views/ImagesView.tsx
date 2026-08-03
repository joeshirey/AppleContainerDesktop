import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { listImages, removeImage, pruneImages } from "../api";
import { RunModal } from "../panels/RunModal";
import { PullModal } from "../panels/PullModal";
import { BuildModal } from "../panels/BuildModal";
import { useBuild } from "../hooks/useBuild";
import type { Image } from "../types";
import styles from "./ImagesView.module.css";

export function ImagesView() {
  const { build } = useBuild();
  const [images, setImages] = useState<Image[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showPull, setShowPull] = useState(false);
  const [showBuild, setShowBuild] = useState(false);
  const [runImage, setRunImage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each fetch claims the counter at its start; state updates are dropped when
  // the token no longer matches, which happens on unmount (cleanup bumps the
  // counter) or when a newer call supersedes this one.
  const tokenRef = useRef(0);
  // Seeded from the build status at mount so a build that succeeded before this
  // view was opened does not fire a redundant refresh on top of the mount fetch.
  // The invariant is "one refresh per transition into succeeded that this
  // mounted view observed", not "one refresh per succeeded status at mount".
  const refreshedFor = useRef(build.status === "succeeded" ? build.buildId : null);

  const fetchImages = useCallback(async () => {
    const token = ++tokenRef.current;
    try {
      const imgs = await listImages();
      if (token !== tokenRef.current) return;
      setImages(imgs);
    } catch (e: any) {
      if (token !== tokenRef.current) return;
      setError(String(e?.message ?? e));
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
    // Invalidate any pending fetch when the component unmounts so a stale
    // response cannot overwrite state after the view is gone.
    return () => { tokenRef.current++; };
  }, [fetchImages]);

  // Refresh the image list when a build succeeds so the new image appears
  // without the user having to reload. buildId is a dependency so each
  // separate build's success fires the refresh independently. refreshedFor
  // guards against double-fetching on mount when the last build already
  // succeeded: only transitions into succeeded that this mounted instance
  // observes trigger a refresh.
  useEffect(() => {
    if (build.status !== "succeeded") return;
    if (refreshedFor.current === build.buildId) return;
    refreshedFor.current = build.buildId;
    fetchImages();
  }, [build.buildId, build.status, fetchImages]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return images.filter(img =>
      img.repository.toLowerCase().includes(q) || img.tag.toLowerCase().includes(q)
    );
  }, [images, filter]);

  async function handleRemove(reference: string) {
    try {
      await removeImage(reference);
      await fetchImages();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setConfirmRemove(null);
    }
  }

  async function handlePrune() {
    try {
      await pruneImages();
      await fetchImages();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setConfirmPrune(false);
    }
  }

  function formatDate(iso: string) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Images</span>
        <input className={styles.search} placeholder="Filter images…" value={filter} onChange={e => setFilter(e.target.value)} />
        <button className={styles.btnGhost} onClick={() => setShowPull(true)}>Pull Image…</button>
        <button className={styles.btnGhost} onClick={() => setShowBuild(true)}>Build Image…</button>
        {confirmPrune ? (
          <>
            <button className={styles.btnDanger} onClick={handlePrune}>Confirm Prune</button>
            <button className={styles.btnGhost} onClick={() => setConfirmPrune(false)}>Cancel</button>
          </>
        ) : (
          <button className={styles.btnGhost} onClick={() => setConfirmPrune(true)}>Prune Unused</button>
        )}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {build.status === "running" && (
        <button className={styles.buildStrip} onClick={() => setShowBuild(true)}>
          Building {build.tag || "image"}… View output
        </button>
      )}
      <div className={styles.tableWrap}>
        <div className={styles.tableHeader}>
          <span>Repository</span><span>Tag</span><span>Size</span><span>Created</span><span></span>
        </div>
        {loading && <div className={styles.msg}>Loading…</div>}
        {!loading && filtered.length === 0 && <div className={styles.msg}>No images found.</div>}
        {filtered.map(img => (
          <div key={img.id} className={styles.row}>
            <span className={styles.name}>{img.repository}</span>
            <span className={styles.mono}>{img.tag}</span>
            <span className={styles.meta}>{img.size}</span>
            <span className={styles.meta}>{formatDate(img.created)}</span>
            <div className={styles.actions}>
              <button className={styles.actBtn} onClick={() => setRunImage(img.reference)}>Run</button>
              {confirmRemove === img.id ? (
                <>
                  <button className={styles.actBtnDanger} onClick={() => handleRemove(img.reference)}>Confirm Remove</button>
                  <button className={styles.actBtn} onClick={() => setConfirmRemove(null)}>Cancel</button>
                </>
              ) : (
                <button className={styles.actBtnDanger} onClick={() => setConfirmRemove(img.id)}>Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {showPull && <PullModal onClose={() => setShowPull(false)} onPulled={fetchImages} />}
      {runImage && <RunModal defaultImage={runImage} onClose={() => setRunImage(null)} onRun={() => { setRunImage(null); }} />}
      {showBuild && <BuildModal onClose={() => setShowBuild(false)} />}
    </div>
  );
}
