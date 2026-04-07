import { useState, useEffect, useRef, useCallback } from 'react';
import useWifi from '../hooks/useWifi.js';
import useStore from '../store/index.js';
import t from '../i18n/he.json';

// ─── Signal bars SVG (1-4 bars) ────────────────────────────────────────────

function SignalBars({ signal, className = 'w-5 h-5' }) {
  // Convert signal % to 1-4 bars
  const bars = signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : 1;

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="18" width="4" height="4" rx="0.5"
        className={bars >= 1 ? 'fill-current' : 'fill-current opacity-20'} />
      <rect x="8" y="13" width="4" height="9" rx="0.5"
        className={bars >= 2 ? 'fill-current' : 'fill-current opacity-20'} />
      <rect x="14" y="8" width="4" height="14" rx="0.5"
        className={bars >= 3 ? 'fill-current' : 'fill-current opacity-20'} />
      <rect x="20" y="2" width="4" height="20" rx="0.5"
        className={bars >= 4 ? 'fill-current' : 'fill-current opacity-20'} />
    </svg>
  );
}

// ─── Lock icon ─────────────────────────────────────────────────────────────

function LockIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ─── Refresh icon ──────────────────────────────────────────────────────────

function RefreshIcon({ className = 'w-4 h-4', spinning = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      className={`${className} ${spinning ? 'animate-spin' : ''}`}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

// ─── Check icon ────────────────────────────────────────────────────────────

function CheckIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────

function Spinner({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} animate-spin`}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" />
    </svg>
  );
}

// ─── WifiPopup Component ───────────────────────────────────────────────────

export default function WifiPopup({ visible, onClose, anchorRef }) {
  const {
    networks,
    status,
    loading,
    scanning,
    connecting,
    error,
    scan,
    connect,
    forget,
  } = useWifi();

  const [selectedSsid, setSelectedSsid] = useState(null);
  const [password, setPassword] = useState('');
  const [connectError, setConnectError] = useState(null);
  const [connectSuccess, setConnectSuccess] = useState(null);
  const [forgetConfirm, setForgetConfirm] = useState(null);

  const popupRef = useRef(null);
  const addToast = useStore((s) => s.addToast);

  // Close on click outside
  useEffect(() => {
    if (!visible) return;

    function handlePointerDown(e) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [visible, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  // Reset state when closing
  useEffect(() => {
    if (!visible) {
      setSelectedSsid(null);
      setPassword('');
      setConnectError(null);
      setConnectSuccess(null);
      setForgetConfirm(null);
    }
  }, [visible]);

  const handleConnect = useCallback(
    async (ssid) => {
      setConnectError(null);
      setConnectSuccess(null);
      try {
        await connect(ssid, password || undefined);
        setConnectSuccess(ssid);
        setSelectedSsid(null);
        setPassword('');
        addToast('success', `${t.wifi.connected}: ${ssid}`);
      } catch {
        setConnectError(ssid);
        addToast('error', `${t.wifi.connectionFailed}: ${ssid}`);
      }
    },
    [connect, password, addToast]
  );

  const handleForget = useCallback(
    async (ssid) => {
      try {
        await forget(ssid);
        setForgetConfirm(null);
        addToast('success', `${t.wifi.networkForgotten}: ${ssid}`);
      } catch {
        addToast('error', `${t.wifi.forgetFailed}: ${ssid}`);
      }
    },
    [forget, addToast]
  );

  const handleNetworkClick = useCallback(
    (ssid, isSecured) => {
      if (selectedSsid === ssid) {
        setSelectedSsid(null);
        setPassword('');
      } else {
        setSelectedSsid(ssid);
        setPassword('');
        setConnectError(null);
        // If open network, connect immediately
        if (!isSecured) {
          handleConnect(ssid);
        }
      }
    },
    [selectedSsid, handleConnect]
  );

  if (!visible) return null;

  const connectedNetwork = status?.connected ? status.ssid : null;
  const isSecured = (security) =>
    security && security !== 'Open' && security !== '' && security !== '--';

  return (
    <div
      ref={popupRef}
      className="absolute top-full mt-3 z-50"
      style={{
        left: '50%',
        transform: 'translateX(-50%)',
        animation: 'popupIn var(--dur-normal) var(--ease-out) forwards',
      }}
    >
      {/* Triangle pointer */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-surf border-t border-l border-bd rotate-45 rounded-sm" />

      {/* Card */}
      <div className="bg-surf border border-bd rounded-2xl shadow-xl min-w-[320px] max-w-[380px] max-h-[480px] flex flex-col relative overflow-hidden">

        {/* ── Header with refresh ── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-tp">{t.wifi.availableNetworks}</h3>
          <button
            onClick={() => scan()}
            disabled={scanning}
            className="p-2 rounded-lg hover:bg-s2 active:scale-95 transition-all
                       duration-[var(--dur-fast)] text-ts hover:text-tp disabled:opacity-50"
            aria-label={t.wifi.scan || 'Scan'}
          >
            <RefreshIcon spinning={scanning} />
          </button>
        </div>

        {/* ── Current connection ── */}
        {status?.connected && (
          <div className="mx-4 mb-2 px-4 py-3 bg-acc2/10 border border-acc2/30 rounded-xl">
            <div className="flex items-center gap-3">
              <SignalBars signal={status.signal || 100} className="w-5 h-5 text-acc2" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-tp truncate">
                    {status.ssid}
                  </span>
                  <CheckIcon className="w-3.5 h-3.5 text-acc2 shrink-0" />
                </div>
                {status.ip && (
                  <span className="text-xs text-acc2 font-mono">{status.ip}</span>
                )}
              </div>
              <span className="text-xs text-acc2 font-medium shrink-0">
                {t.wifi.connected}
              </span>
            </div>
          </div>
        )}

        {/* ── Loading state ── */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner className="w-6 h-6 text-ts" />
          </div>
        )}

        {/* ── Network list ── */}
        {!loading && (
          <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'thin' }}>
            {networks.length === 0 && !scanning && (
              <p className="text-sm text-tm text-center py-6">{t.wifi.noNetworks}</p>
            )}

            <div className="flex flex-col gap-1">
              {networks
                .filter((n) => n.ssid !== connectedNetwork)
                .map((network) => {
                  const secured = isSecured(network.security);
                  const isSelected = selectedSsid === network.ssid;
                  const isError = connectError === network.ssid;
                  const isSuccess = connectSuccess === network.ssid;
                  const isForgetTarget = forgetConfirm === network.ssid;

                  return (
                    <div key={network.ssid}>
                      {/* Network row */}
                      <button
                        onClick={() => handleNetworkClick(network.ssid, secured)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setForgetConfirm(network.ssid);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                                    transition-all duration-[var(--dur-fast)] text-start
                                    ${isSelected
                                      ? 'bg-acc/10 border border-acc/30'
                                      : 'hover:bg-s2 border border-transparent'
                                    }
                                    ${isSuccess ? 'bg-acc2/10' : ''}
                                    ${isError ? 'bg-coral/10' : ''}`}
                      >
                        <SignalBars signal={network.signal} className="w-5 h-5 text-ts shrink-0" />
                        <span className="text-sm text-tp flex-1 truncate">{network.ssid}</span>
                        {secured && <LockIcon className="w-3.5 h-3.5 text-tm shrink-0" />}
                      </button>

                      {/* Password input (shown when tapped) */}
                      {isSelected && secured && (
                        <div
                          className="flex items-center gap-2 px-3 pb-2 mt-1"
                          style={{
                            animation: 'popupIn var(--dur-fast) var(--ease-out) forwards',
                          }}
                        >
                          <input
                            type="password"
                            placeholder={t.wifi.password}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && password) {
                                handleConnect(network.ssid);
                              }
                            }}
                            autoFocus
                            className="flex-1 bg-s2 border border-bd rounded-lg px-3 py-2 text-sm
                                       text-tp placeholder:text-tm focus:outline-none focus:border-acc
                                       transition-colors duration-[var(--dur-fast)]"
                            dir="ltr"
                          />
                          <button
                            onClick={() => handleConnect(network.ssid)}
                            disabled={!password || connecting}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg
                                       bg-acc text-white text-sm font-medium
                                       hover:bg-acc/90 active:scale-95 transition-all
                                       duration-[var(--dur-fast)] disabled:opacity-50
                                       disabled:active:scale-100 min-w-[72px] justify-center"
                          >
                            {connecting ? (
                              <Spinner className="w-4 h-4" />
                            ) : (
                              t.wifi.connect
                            )}
                          </button>
                        </div>
                      )}

                      {/* Forget confirmation (on long-press / right-click) */}
                      {isForgetTarget && (
                        <div
                          className="flex items-center justify-between gap-2 px-3 py-2 mt-1
                                     bg-coral/10 border border-coral/20 rounded-xl"
                          style={{
                            animation: 'popupIn var(--dur-fast) var(--ease-out) forwards',
                          }}
                        >
                          <span className="text-xs text-coral-d">
                            {t.wifi.forgetNetwork}?
                          </span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setForgetConfirm(null)}
                              className="px-2.5 py-1 text-xs rounded-lg bg-s2 text-ts
                                         hover:bg-bd transition-colors"
                            >
                              {t.common.cancel}
                            </button>
                            <button
                              onClick={() => handleForget(network.ssid)}
                              className="px-2.5 py-1 text-xs rounded-lg bg-coral/30 text-coral-d
                                         hover:bg-coral/50 transition-colors"
                            >
                              {t.wifi.forgetNetwork}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── Error display ── */}
        {error && (
          <div className="px-4 pb-3">
            <p className="text-xs text-coral-d bg-coral/10 rounded-lg px-3 py-2">
              {error.message || t.wifi.scanFailed}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
