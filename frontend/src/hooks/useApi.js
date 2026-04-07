import { useState, useEffect, useRef, useCallback } from 'react';

// ─── In-memory cache ────────────────────────────────────────────────────────

const cache = new Map();

const DEFAULT_TTL = 60_000; // 1 minute

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  return entry;
}

function setCache(key, data, ttl) {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttl || DEFAULT_TTL,
  });
}

function isFresh(entry) {
  if (!entry) return false;
  return Date.now() - entry.timestamp < entry.ttl;
}

// ─── fetchApi — imperative utility for non-hook contexts ────────────────────

export async function fetchApi(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`API ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }

  // Handle 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

// ─── useApi Hook ────────────────────────────────────────────────────────────

export default function useApi(url, options = {}) {
  const { ttl = DEFAULT_TTL, skip = false, method = 'GET' } = options;

  const [data, setData] = useState(() => {
    // Initialize from cache if available
    const entry = getCached(url);
    return entry ? entry.data : null;
  });
  const [loading, setLoading] = useState(!getCached(url));
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(() => {
    const entry = getCached(url);
    return entry ? !isFresh(entry) : false;
  });

  const activeRequest = useRef(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(
    async (force = false) => {
      if (skip || method !== 'GET') return;

      // Check cache first (unless forcing)
      if (!force) {
        const entry = getCached(url);
        if (entry && isFresh(entry)) {
          setData(entry.data);
          setStale(false);
          setLoading(false);
          setError(null);
          return;
        }
        // Stale data exists - show it immediately
        if (entry) {
          setData(entry.data);
          setStale(true);
        }
      }

      // Create abort controller for this request
      if (activeRequest.current) {
        activeRequest.current.abort();
      }
      const controller = new AbortController();
      activeRequest.current = controller;

      if (!getCached(url)) {
        setLoading(true);
      }

      try {
        const result = await fetchApi(url, {
          signal: controller.signal,
        });

        if (!mountedRef.current) return;

        setCache(url, result, ttl);
        setData(result);
        setStale(false);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (!mountedRef.current) return;

        // On network error, keep last cached data if available
        const entry = getCached(url);
        if (entry) {
          setData(entry.data);
          setStale(true);
        }

        setError(err);
        setLoading(false);
      }
    },
    [url, skip, method, ttl]
  );

  // Fetch on mount and when url changes
  useEffect(() => {
    mountedRef.current = true;
    doFetch();

    return () => {
      mountedRef.current = false;
      if (activeRequest.current) {
        activeRequest.current.abort();
      }
    };
  }, [doFetch]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  return { data, loading, error, stale, refresh };
}
