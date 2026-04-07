import { useCallback } from 'react';
import { fetchApi } from '../hooks/useApi.js';
import t from '../i18n/he.json';

// ─── SVG Icons ──────────────────────────────────────────────────────────────

function CloseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Remote Button ──────────────────────────────────────────────────────────

function RemoteButton({ label, command, entityId, size = 'md', variant = 'default', className = '' }) {
  const handlePress = useCallback(async () => {
    try {
      await fetchApi(`/api/ha/remote/${encodeURIComponent(entityId)}/command`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
    } catch (err) {
      console.error('IR command failed:', err);
    }
  }, [entityId, command]);

  const sizeClasses = {
    sm: 'w-14 h-10 text-xs',
    md: 'w-16 h-12 text-sm',
    lg: 'w-20 h-14 text-base',
    round: 'w-16 h-16 rounded-full text-xs',
  };

  const variantClasses = {
    default: 'bg-s2 text-tp hover:bg-bd border border-bd',
    accent: 'bg-acc text-white hover:bg-acc/90',
    danger: 'bg-coral-bg text-coral-d hover:opacity-80',
    center: 'bg-acc2 text-white hover:bg-acc2/90 rounded-full w-16 h-16 text-sm font-bold',
  };

  return (
    <button
      onClick={handlePress}
      className={`flex items-center justify-center rounded-xl font-medium
                  transition-all duration-[var(--dur-fast)] active:scale-90 select-none
                  ${sizeClasses[size] || sizeClasses.md}
                  ${variantClasses[variant] || variantClasses.default}
                  ${className}`}
    >
      {label}
    </button>
  );
}

// ─── Arrow Pad ──────────────────────────────────────────────────────────────

function ArrowPad({ entityId }) {
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-1.5 place-items-center w-fit mx-auto">
      {/* Row 1: blank / Up / blank */}
      <div />
      <RemoteButton label="&#9650;" command="up" entityId={entityId} size="md" />
      <div />

      {/* Row 2: Left / OK / Right */}
      <RemoteButton label="&#9664;" command="left" entityId={entityId} size="md" />
      <RemoteButton label={t.home.ok} command="ok" entityId={entityId} variant="center" />
      <RemoteButton label="&#9654;" command="right" entityId={entityId} size="md" />

      {/* Row 3: blank / Down / blank */}
      <div />
      <RemoteButton label="&#9660;" command="down" entityId={entityId} size="md" />
      <div />
    </div>
  );
}

// ─── IR Remote Overlay ──────────────────────────────────────────────────────

export default function IRRemoteOverlay({ entityId, roomName, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-surf border border-bd rounded-3xl shadow-2xl p-6 w-[380px] max-h-[90vh] overflow-y-auto"
        style={{ animation: 'popupIn 250ms var(--ease) forwards' }}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-tp">
            {t.home.irRemote} - {roomName}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-tm
                       hover:bg-s2 transition-colors active:scale-90"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Power row */}
        <div className="flex justify-center mb-4">
          <RemoteButton
            label={t.home.power}
            command="power"
            entityId={entityId}
            variant="danger"
            size="lg"
            className="w-full"
          />
        </div>

        {/* Volume / Channel row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <RemoteButton label={t.home.volUp} command="volume_up" entityId={entityId} size="sm" />
          <RemoteButton label={t.home.mute} command="mute" entityId={entityId} size="sm" />
          <RemoteButton label={t.home.chUp} command="channel_up" entityId={entityId} size="sm" />
          <RemoteButton label={t.home.volDown} command="volume_down" entityId={entityId} size="sm" />
          <RemoteButton label={t.home.inputSource} command="source" entityId={entityId} size="sm" />
          <RemoteButton label={t.home.chDown} command="channel_down" entityId={entityId} size="sm" />
        </div>

        {/* Arrow pad */}
        <div className="mb-4">
          <ArrowPad entityId={entityId} />
        </div>

        {/* Bottom row: Back, Home, Menu */}
        <div className="flex justify-center gap-3">
          <RemoteButton label={t.home.backBtn} command="back" entityId={entityId} size="md" />
          <RemoteButton label={t.home.homeBtn} command="home" entityId={entityId} size="md" variant="accent" />
          <RemoteButton label={t.home.menuBtn} command="menu" entityId={entityId} size="md" />
        </div>
      </div>
    </div>
  );
}
