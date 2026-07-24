import { useState, useEffect, useCallback, useRef } from "react";
import type { Container } from "../types";
import { listContainers } from "../api";

export function useContainers() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    try {
      const result = await listContainers();
      setContainers(Array.isArray(result) ? result : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    timer.current = setInterval(fetch, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [fetch]);

  return { containers, error, loading, refresh: fetch };
}
