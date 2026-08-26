import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

// ─── useWifi Hook ──────────────────────────────────────────────────────────

export default function useWifi() {
  const [networks, setNetworks] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const mountedRef = useRef(true);

  // Get current connection status
  const getStatus = useCallback(async () => {
    try {
      const data = await fetchApi('/api/wifi/status');
      if (!mountedRef.current) return data;
      setStatus(data);
      setConnectionStatus('wifi', data?.connected ? 'connected' : 'degraded');
      return data;
    } catch (err) {
      if (mountedRef.current) setError(err);
      return null;
    }
  }, [setConnectionStatus]);

  // Scan for available networks. Accepts an optional `statusOverride` so
  // callers that just fetched a fresher status (e.g. `init()` below) can
  // pass it straight through instead of relying on the `status` state,
  // which is stale inside this closure until the component re-renders —
  // on first mount `init()` awaits getStatus() then scan() in the same
  // effect tick, so `status` here was still `null` even after getStatus()
  // resolved, making every network wrongly show as not-connected until a
  // manual re-scan happened to run in a fresh closure.
  const scan = useCallback(async (statusOverride) => {
    try {
      setScanning(true);
      setError(null);
      const data = await fetchApi('/api/wifi/scan');
      if (!mountedRef.current) return data?.networks || [];
      const effectiveStatus = statusOverride !== undefined ? statusOverride : status;
      const list = (data?.networks || []).map((n) => ({
        ssid: n.ssid,
        signal: n.signal,
        security: n.security || 'Open',
        frequency: n.frequency || '',
        connected: effectiveStatus?.connected && effectiveStatus?.ssid === n.ssid,
      }));
      setNetworks(list);
      return list;
    } catch (err) {
      if (mountedRef.current) setError(err);
      return [];
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  }, [status]);

  // Connect to a network
  const connect = useCallback(
    async (ssid, password) => {
      try {
        setConnecting(true);
        setError(null);
        const data = await fetchApi('/api/wifi/connect', {
          method: 'POST',
          body: JSON.stringify({ ssid, password }),
        });
        if (!mountedRef.current) return data;
        // Refresh status and network list after connecting
        await getStatus();
        await scan();
        return data;
      } catch (err) {
        if (mountedRef.current) setError(err);
        throw err;
      } finally {
        if (mountedRef.current) setConnecting(false);
      }
    },
    [getStatus, scan]
  );

  // Forget a saved network
  const forget = useCallback(
    async (ssid) => {
      try {
        setError(null);
        const data = await fetchApi(`/api/wifi/${encodeURIComponent(ssid)}`, {
          method: 'DELETE',
        });
        if (!mountedRef.current) return data;
        // Refresh status after forgetting
        await getStatus();
        await scan();
        return data;
      } catch (err) {
        if (mountedRef.current) setError(err);
        throw err;
      }
    },
    [getStatus, scan]
  );

  // Auto-scan on mount
  useEffect(() => {
    mountedRef.current = true;

    async function init() {
      setLoading(true);
      const freshStatus = await getStatus();
      await scan(freshStatus);
      setLoading(false);
    }

    init();

    return () => {
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    networks,
    status,
    loading,
    scanning,
    connecting,
    error,
    scan,
    connect,
    forget,
    getStatus,
  };
}
