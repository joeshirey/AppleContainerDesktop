import { useState, useMemo, useEffect, useCallback } from "react";
import { listImages, removeImage, pruneImages } from "../api";
import { RunModal } from "../panels/RunModal";
import { PullModal } from "../panels/PullModal";
import type { Image } from "../types";
import styles from "./ImagesView.module.css";

export function ImagesView() {
  const [images, setImages] = useState<Image[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showPull, setShowPull] = useState(false);
  const [runImage, setRunImage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchImages = useCallback(async () => {
    try {
      setImages(await listImages());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return images.filter(img =>
      img.repository.toLowerCase().includes(q) || img.tag.toLowerCase().includes(q)
    );
  }, [images, filter]);

  async function handleRemove(id: string) {
    try {
      await removeImage(id);
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
              <button className={styles.actBtn} onClick={() => setRunImage(img.repository + ":" + img.tag)}>Run</button>
              {confirmRemove === img.id ? (
                <>
                  <button className={styles.actBtnDanger} onClick={() => handleRemove(img.id)}>Confirm Remove</button>
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
    </div>
  );
}
