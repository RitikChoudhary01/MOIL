"use client";

import { useCallback, useEffect, useState } from "react";
interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useApi<T>(url: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    // Kick off async work — state transitions happen in callbacks,
    // never synchronously in the effect body.
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setLoading(true);
        setError(null);
        return fetch(url);
      })
      .then(async (res) => {
        if (!res || cancelled) return;
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((json) => {
        if (cancelled || json === undefined) return;
        setData(json as T);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unknown error");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  return { data, loading, error, reload };
}
