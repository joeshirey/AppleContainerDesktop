import { useState } from "react";
import { pullImage, searchHub, getHubTags } from "../api";
import styles from "./HubSearchView.module.css";

interface HubResult {
  name: string;
  description: string;
  isOfficial: boolean;
  pullCount: number;
  starCount: number;
  tags: string[];
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function HubSearchView() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubResult[] | null>(null);
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
      const data = await searchHub(query.trim());
      const raw: any[] = data.results ?? [];
      const withTags = await Promise.all(
        raw.map(async (r) => ({
          name: r.name as string,
          description: (r.description ?? "") as string,
          isOfficial: !!(r.is_official),
          pullCount: r.pull_count ?? 0,
          starCount: r.star_count ?? 0,
          tags: await fetchTags(r.name),
        }))
      );
      setResults(withTags);
    } catch (e: any) {
      setSearchError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePull(result: HubResult) {
    const tag = result.tags[0] ?? "latest";
    const image = `${result.name}:${tag}`;
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
                {r.name}
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
