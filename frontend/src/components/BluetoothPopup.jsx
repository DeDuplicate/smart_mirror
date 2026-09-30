import { useState, useEffect, useRef, useCallback } from 'react';
import useBluetooth from '../hooks/useBluetooth.js';
import { Spinner, RefreshIcon } from './WifiPopup.jsx';
import useStore from '../store/index.js';
import t from '../i18n/he.json';

// ─── Small pieces ──────────────────────────────────────────────────────────

const PILL = `ripple inline-flex items-center justify-center gap-2 px-4 min-h-[56px] rounded-xl
              text-base font-semibold active:scale-95 transition-all duration-[var(--dur-fast)]
              disabled:opacity-50 disabled:active:scale-100`;

function StatusDot({ on }) {
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: on ? 'var(--mint-d)' : 'var(--tm)' }}
    />
  );
}

function SectionHeader({ children, action }) {
  return (
    <div className="flex items-center justify-between px-1 pt-3 pb-1.5">
      <h4 className="text-sm font-semibold text-ts">{children}</h4>
      {action}
    </div>
  );
}

// ─── Card (mounted only while open, so the hook's status poll is too) ──────

function BluetoothCard() {
  const {
    loading, supported, audio, saved, nearby, scanning, busyMac,
    scan, pair, connect, disconnect, forget, installAudio,
  } = useBluetooth();
  const addToast = useStore((s) => s.addToast);
  const [installing, setInstalling] = useState(false);
  const [forgetMac, setForgetMac] = useState(null);

  const installBusy = installing || audio === 'installing';

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      const ok = await installAudio();
      addToast(ok ? 'success' : 'error', ok ? t.bluetooth.installed : t.bluetooth.installFailed);
    } catch {
      addToast('error', t.bluetooth.installFailed);
    } finally {
      setInstalling(false);
    }
  }, [installAudio, addToast]);

  const handlePair = useCallback(async (d) => {
    const r = await pair(d.mac);
    if (r.ok) {
      addToast('success', r.connected ? `${t.bluetooth.paired}: ${d.name}` : t.bluetooth.pairedNoConnect);
    } else if (r.error === 'busy') {
      addToast('error', t.bluetooth.busy);
    } else {
      addToast('error', /not found|not available/i.test(r.error || '') ? t.bluetooth.pairNotFound : t.bluetooth.pairFailed);
    }
  }, [pair, addToast]);

  const handleToggle = useCallback(async (d) => {
    const r = await (d.connected ? disconnect(d.mac) : connect(d.mac));
    if (!r.ok) addToast('error', t.bluetooth.connectFailed);
  }, [connect, disconnect, addToast]);

  const handleForget = useCallback(async (d) => {
    setForgetMac(null);
    const r = await forget(d.mac);
    addToast(r.ok ? 'success' : 'error', r.ok ? t.bluetooth.forgotten : t.bluetooth.connectFailed);
  }, [forget, addToast]);

  return (
    <div className="bg-surf border border-bd rounded-2xl shadow-popover min-w-[340px] max-w-[440px] max-h-[560px] flex flex-col relative overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-1">
        <h3 className="text-base font-semibold text-tp">{t.bluetooth.title}</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'thin' }}>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner className="w-6 h-6 text-ts" />
          </div>
        )}

        {!loading && !supported && (
          <p className="text-sm text-tm text-center py-6">{t.bluetooth.unsupported}</p>
        )}

        {!loading && supported && (
          <>
            {/* Without a sound server a paired speaker cannot receive audio. */}
            {audio !== 'ready' && (
              <div className="mt-2 px-4 py-3 bg-gold/15 border border-gold/40 rounded-xl flex flex-col gap-3">
                <p className="text-sm text-tp leading-relaxed">
                  {installBusy ? t.bluetooth.installing : t.bluetooth.audioMissing}
                </p>
                <button
                  onClick={handleInstall}
                  disabled={installBusy}
                  className={`${PILL} bg-acc text-white self-start`}
                >
                  {installBusy && <Spinner className="w-4 h-4" />}
                  {t.bluetooth.install}
                </button>
              </div>
            )}

            <SectionHeader>{t.bluetooth.saved}</SectionHeader>
            {saved.length === 0 && (
              <p className="text-sm text-tm px-1 py-2">{t.bluetooth.noSaved}</p>
            )}
            <div className="flex flex-col gap-1">
              {saved.map((d) => (
                <div key={d.mac}>
                  <div className="flex items-center gap-2 px-3 min-h-[64px] rounded-xl bg-s2">
                    <StatusDot on={d.connected} />
                    <div className="flex-1 min-w-0">
                      <div className="text-base text-tp truncate">{d.name}</div>
                      <div className="text-xs text-ts">
                        {d.connected ? t.bluetooth.connected : t.bluetooth.notConnected}
                      </div>
                    </div>
                    {busyMac === d.mac ? (
                      <Spinner className="w-5 h-5 text-ts mx-3" />
                    ) : (
                      <>
                        <button
                          onClick={() => handleToggle(d)}
                          className={`${PILL} bg-surf border border-bd text-ts`}
                        >
                          {d.connected ? t.bluetooth.disconnect : t.bluetooth.connect}
                        </button>
                        <button
                          onClick={() => setForgetMac(forgetMac === d.mac ? null : d.mac)}
                          aria-label={t.bluetooth.forget}
                          className={`${PILL} bg-coral/20 text-coral-d px-3 min-w-[56px]`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                  {forgetMac === d.mac && (
                    <div
                      className="flex items-center justify-between gap-2 px-3 py-2 mt-1 bg-coral/10 border border-coral/20 rounded-xl"
                      style={{ animation: 'popupIn var(--dur-fast) var(--ease-out) forwards' }}
                    >
                      <span className="text-sm text-coral-d">{t.bluetooth.forgetConfirm}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setForgetMac(null)} className={`${PILL} bg-s2 text-ts`}>
                          {t.common.cancel}
                        </button>
                        <button onClick={() => handleForget(d)} className={`${PILL} bg-coral/30 text-coral-d`}>
                          {t.bluetooth.forget}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <SectionHeader
              action={(
                <button
                  onClick={scan}
                  disabled={scanning}
                  className={`${PILL} bg-s2 border border-bd text-ts`}
                >
                  <RefreshIcon spinning={scanning} />
                  {t.bluetooth.scan}
                </button>
              )}
            >
              {t.bluetooth.nearby}
            </SectionHeader>
            <p className="text-xs text-tm px-1 pb-2 leading-relaxed">{t.bluetooth.pairHint}</p>
            {nearby.length === 0 && !scanning && (
              <p className="text-sm text-tm px-1 py-2">{t.bluetooth.noNearby}</p>
            )}
            <div className="flex flex-col gap-1">
              {nearby.map((d) => (
                <button
                  key={d.mac}
                  onClick={() => handlePair(d)}
                  disabled={busyMac !== null}
                  className="ripple w-full flex items-center gap-3 px-3 min-h-[56px] rounded-xl
                             hover:bg-s2 active:bg-bd/60 text-start disabled:opacity-60
                             transition-colors duration-[var(--dur-fast)]"
                >
                  <span className="text-base text-tp flex-1 truncate">{d.name}</span>
                  {busyMac === d.mac && <Spinner className="w-5 h-5 text-ts shrink-0" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── BluetoothPopup (anchored under the Settings button, like WifiPopup) ───

export default function BluetoothPopup({ visible, onClose, anchorRef }) {
  const popupRef = useRef(null);

  useEffect(() => {
    if (!visible) return undefined;
    function handlePointerDown(e) {
      if (
        popupRef.current && !popupRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [visible, onClose, anchorRef]);

  if (!visible) return null;

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
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-surf border-t border-l border-bd rotate-45 rounded-sm" />
      <BluetoothCard />
    </div>
  );
}
