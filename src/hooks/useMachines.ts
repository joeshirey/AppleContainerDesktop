import { useState, useEffect, useCallback, useRef } from "react";
import { listMachines } from "../api";
import type { Machine } from "../types";

export function useMachines() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMachines = useCallback(async () => {
    try {
      setMachines(await listMachines());
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMachines();
    timerRef.current = setInterval(fetchMachines, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchMachines]);

  return { machines, loading, error, refresh: fetchMachines };
}
