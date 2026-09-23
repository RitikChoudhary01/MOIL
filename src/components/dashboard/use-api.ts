"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Minimal, robust data hook: fetch on mount, loading/error state, manual refresh.
 * No query library needed — endpoints are fast (<2s) and read-mostly.
 */
export function useApi<T>(url: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as T;
      if (mounted.current) setData(json);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "Failed to load data");
        setData(null);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  return { data, loading, error, refresh: load, setData };
}
