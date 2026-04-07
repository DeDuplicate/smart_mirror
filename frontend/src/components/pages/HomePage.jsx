import { useState, useEffect } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import { HomeSkeleton } from '../Skeleton.jsx';

// ─── Icons ──────────────────────────────────────────────────────────────────

function HomeIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="w-28 h-28 text-tm">
      <rect x="20" y="50" width="80" height="55" rx="12" stroke="currentColor" strokeWidth="2.5" />
      <path d="M10 55L60 18l50 37" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="45" y="72" width="30" height="33" rx="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="60" cy="88" r="3" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function SettingsIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65
        1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0
        9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0
        4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65
        0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65
        0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0
        1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0
        1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ─── Scene placeholder names ────────────────────────────────────────────────

const SCENE_PLACEHOLDERS = [
  { name: 'בוקר טוב', icon: '🌅' },
  { name: 'ערב טוב', icon: '🌙' },
  { name: 'צפייה', icon: '🎬' },
  { name: 'לילה טוב', icon: '😴' },
];

// ─── HomePage ───────────────────────────────────────────────────────────────

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const haStatus = useStore((s) => s.connections.ha);
  const setActiveTab = useStore((s) => s.setActiveTab);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <HomeSkeleton />;

  const isConfigured = haStatus === 'connected';

  // Not configured state
  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <HomeIllustration />
        <p className="text-tm text-lg">{t.empty.notConfigured}</p>
        <button
          onClick={() => setActiveTab(5)}
          className="ripple flex items-center gap-2 px-6 min-h-[56px] rounded-xl bg-acc text-white
                     font-medium hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          <SettingsIcon />
          <span>{t.home.configureInSettings}</span>
        </button>
      </div>
    );
  }

  // Configured but empty devices
  return (
    <div className="flex flex-col h-full overflow-hidden p-6 gap-5">
      {/* Device tiles grid */}
      <div className="flex-1 grid grid-cols-5 grid-rows-2 gap-4 overflow-y-auto">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="card flex flex-col items-center justify-center gap-2
                       rounded-[20px] hover:shadow-md transition-shadow duration-[var(--dur-fast)]
                       cursor-pointer min-h-[100px]"
          >
            <div className="w-10 h-10 rounded-full bg-s2 flex items-center justify-center">
              <span className="text-tm text-lg">?</span>
            </div>
            <span className="text-xs text-tm">{t.home.devices}</span>
          </div>
        ))}
      </div>

      {/* Scene buttons */}
      <div className="flex gap-4 shrink-0">
        {SCENE_PLACEHOLDERS.map((scene, i) => (
          <button
            key={i}
            className="ripple flex-1 flex items-center justify-center gap-3 min-h-[56px]
                       rounded-xl bg-surf border border-bd text-sm font-medium text-tp
                       hover:bg-s2 active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            <span className="text-lg">{scene.icon}</span>
            <span>{scene.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
