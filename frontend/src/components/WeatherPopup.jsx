import { useEffect, useRef } from 'react';
import useStore from '../store/index.js';
import t from '../i18n/he.json';
import WeatherIcon from './WeatherIcon.jsx';

// ─── WeatherPopup Component ─────────────────────────────────────────────────

export default function WeatherPopup({ anchorRef, onClose }) {
  const weather = useStore((s) => s.weather);
  const temperatureUnit = useStore((s) => s.settings.temperatureUnit);
  const locationName = useStore((s) => s.settings.location);
  const locationCountry = useStore((s) => s.settings.locationCountry);
  const popupRef = useRef(null);

  const unitLabel = temperatureUnit === 'celsius' ? t.weather.celsius : t.weather.fahrenheit;

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const { current: cur, daily } = weather;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Popup */}
      <div
        ref={popupRef}
        className="absolute top-full mt-3 z-50 w-[520px]"
        style={{
          animation: `popupIn var(--dur-normal) var(--ease-out) forwards`,
        }}
      >
        {/* Arrow / nub */}
        <div className="absolute -top-2 right-8 w-4 h-4 bg-surf border-t border-r border-bd rotate-[-45deg] rounded-sm" />

        <div className="bg-surf border border-bd rounded-2xl shadow-popover p-5 relative">
          {/* Configured city — saved by the Settings city picker */}
          {locationName && (
            <div className="flex items-center gap-1.5 mb-3 text-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-ts shrink-0"
                aria-hidden="true"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="font-medium text-tp">{locationName}</span>
              {locationCountry && (
                <span className="text-ts">{locationCountry}</span>
              )}
            </div>
          )}

          {/* Current conditions */}
          <div className="flex items-center gap-4 mb-4 pb-4 border-b border-bd">
            <WeatherIcon code={cur.code} size={80} />
            <div className="flex-1">
              <div className="flex items-baseline gap-3">
                {cur.temp != null && (
                  <span className="font-mono text-3xl font-light text-tp">
                    {Math.round(cur.temp)}{unitLabel}
                  </span>
                )}
                {cur.feelsLike != null && (
                  <span className="text-sm text-ts">
                    {t.weather.feelsLike} {Math.round(cur.feelsLike)}{unitLabel}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm text-ts">
                {cur.humidity != null && (
                  <span>
                    {t.weather.humidity} {cur.humidity}{t.weather.percent}
                  </span>
                )}
                {cur.wind != null && (
                  <span>
                    {t.weather.wind} {cur.wind} {t.weather.kmh}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 5-day forecast */}
          {daily.length > 0 && (
            <div>
              <p className="text-sm text-ts font-semibold mb-3">{t.weather.forecast}</p>
              <div className="grid grid-cols-5 gap-2">
                {daily.slice(0, 5).map((day, i) => {
                  const dayLabel = day.dayName || t.topBar.days[i] || '';
                  const high = day.high != null ? `${Math.round(day.high)}°` : '—';
                  const low = day.low != null ? `${Math.round(day.low)}°` : '—';
                  return (
                    <div
                      key={i}
                      className="min-h-[132px] rounded-2xl bg-s2 border border-bd px-2.5 py-2
                                 flex flex-col items-center justify-between min-w-0"
                    >
                      <span className="text-sm font-semibold text-tp truncate">{dayLabel}</span>
                      <WeatherIcon code={day.code} size={34} />
                      <div
                        className="w-full flex flex-col gap-1"
                        aria-label={`גבוה ${high}, נמוך ${low}`}
                      >
                        <div className="flex items-center justify-between rounded-lg bg-surf px-2 py-1">
                          <span className="text-xs font-medium text-ts">{t.weather.high}</span>
                          <span className="font-mono text-base leading-none text-tp">
                            {high}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-lg bg-surf px-2 py-1">
                          <span className="text-xs font-medium text-ts">{t.weather.low}</span>
                          <span className="font-mono text-base leading-none text-ts">
                            {low}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {cur.temp == null && daily.length === 0 && (
            <p className="text-sm text-tm text-center py-2">
              {t.loading || '...'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
