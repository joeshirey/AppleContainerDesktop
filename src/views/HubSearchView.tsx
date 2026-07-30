import { useState } from "react";
import { pullImage, searchHub, getHubTags } from "../api";
import type { HubResult } from "../types";
import styles from "./HubSearchView.module.css";

/// Tags come from a second request per result, so they are added on top of what
/// the search itself returns.
type HubRow = HubResult & { tags: string[] };

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function HubSearchView() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullSuccess, setPullSuccess] = useState<string | null>(null);

  async function fetchTags(name: string): Promise<string[]> {
    try {
      const data = await getHubTags(name);
      return (data.results ?? []).map(t => t.name);
    } catch {
      return [];
    }
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setSearchError(null);
    setResults(null);
    setPullError(null);
    setPullSuccess(null);
    try {
      const found = await searchHub(query.trim());
      setResults(
        await Promise.all(found.map(async r => ({ ...r, tags: await fetchTags(r.name) })))
      );
    } catch (e: any) {
      setSearchError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePull(result: HubRow) {
    const tag = result.tags[0] ?? "latest";
    const image = `${result.displayName}:${tag}`;
    setPulling(result.name);
    setPullError(null);
    setPullSuccess(null);
    try {
      await pullImage(image);
      setPullSuccess(`Pulled ${image}`);
    } catch (e: any) {
      setPullError(String(e?.message ?? e));
    } finally {
      setPulling(null);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <div className={styles.heroRow}>
          <input
            className={styles.heroInput}
            placeholder="Search Docker Hub — e.g. nginx, postgres, node…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
          />
          <button className={styles.btnSearch} onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        {pullSuccess && <div className={styles.success}>{pullSuccess}</div>}
        {pullError && <div className={styles.error}>{pullError}</div>}
        {searchError && <div className={styles.error}>{searchError}</div>}
      </div>
      <div className={styles.results}>
        {results === null && !loading && (
          <div className={styles.empty}>Search Docker Hub to find and pull images.</div>
        )}
        {results !== null && results.length === 0 && (
          <div className={styles.empty}>No results for &ldquo;{query}&rdquo;.</div>
        )}
        {(results ?? []).map(r => (
          <div key={r.name} className={styles.card}>
            <div className={styles.cardIcon}>📦</div>
            <div className={styles.cardBody}>
              <div className={styles.cardName}>
                {r.displayName}
                {r.isOfficial && <span className={styles.official}>Official</span>}
              </div>
              {r.description && <div className={styles.cardDesc}>{r.description}</div>}
              <div className={styles.cardMeta}>
                <span>⬇ {formatCount(r.pullCount)} pulls</span>
                <span>★ {formatCount(r.starCount)}</span>
                {r.tags.length > 0 && <span>🏷 {r.tags.join(", ")}</span>}
              </div>
            </div>
            <div className={styles.cardActions}>
              <button
                className={styles.btnPull}
                onClick={() => handlePull(r)}
                disabled={pulling === r.name}
              >
                {pulling === r.name ? "Pulling…" : "Pull"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
