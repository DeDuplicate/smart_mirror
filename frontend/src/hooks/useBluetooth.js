import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from './useApi.js';

// ─── useBluetooth Hook ─────────────────────────────────────────────────────
//
// Pairing / connecting Bluetooth speakers and headphones, and choosing which
// of them (plus the screen's own HDMI audio) the mirror plays through.
//
// Every mutating call answers { ok, error? } rather than throwing on a domain
// failure ("device not found" is an expected result, not a crash), and the
// hook refreshes the snapshot afterwards so callers never hold stale state.

const API = '/api/bluetooth';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body) => fetchApi(`${API}/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });

const MAX_INSTALL_POLLS = 200; // x4s ~ 13 min, just past the server's own apt timeout

export default function useBluetooth() {
  const [state, setState] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [busyMac, setBusyMac] = useState(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const snap = await fetchApi(`${API}/status`);
      if (mountedRef.current) setState(snap);
      return snap;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { ok, error, ...snap } = await post('scan');
      if (mountedRef.current) setState(snap);
      return { ok, error };
    } catch {
      return { ok: false, error: 'request' };
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  }, []);

  /** Run a per-device action, flag the device busy meanwhile, then refresh. */
  const act = useCallback(async (mac, call) => {
    setBusyMac(mac);
    try {
      const result = await call();
      await refresh();
      return result;
    } catch {
      return { ok: false, error: 'request' };
    } finally {
      if (mountedRef.current) setBusyMac(null);
    }
  }, [refresh]);

  const pair = useCallback((mac) => act(mac, () => post('pair', { mac })), [act]);
  const connect = useCallback((mac) => act(mac, () => post('connect', { mac })), [act]);
  const disconnect = useCallback((mac) => act(mac, () => post('disconnect', { mac })), [act]);
  const forget = useCallback(
    (mac) => act(mac, () => fetchApi(`${API}/${encodeURIComponent(mac)}`, { method: 'DELETE' })),
    [act]
  );

  /** Send the mirror's audio to ['local' | MAC, ...]. Several => played on all. */
  const routeTo = useCallback(async (targets) => {
    try {
      const result = await post('route', { targets });
      await refresh();
      return result;
    } catch {
      return { ok: false, error: 'request' };
    }
  }, [refresh]);

  /** Start the on-device install and wait for it. Resolves true when audio is ready. */
  const installAudio = useCallback(async () => {
    await post('install-audio');
    let snap;
    for (let i = 0; i < MAX_INSTALL_POLLS && mountedRef.current; i++) {
      await sleep(4000);
      snap = await refresh();
      // null = backend briefly unreachable while apt holds the Pi; keep waiting
      if (snap && snap.audio !== 'installing') break;
    }
    return snap?.audio === 'ready';
  }, [refresh]);

  const devices = state?.devices || [];
  return {
    state,
    loading: state === null,
    supported: state ? state.supported : true,
    audio: state?.audio || 'ready',
    route: state?.route || ['local'],
    saved: devices.filter((d) => d.paired),
    nearby: devices.filter((d) => !d.paired),
    scanning,
    busyMac,
    refresh,
    scan,
    pair,
    connect,
    disconnect,
    forget,
    routeTo,
    installAudio,
  };
}
