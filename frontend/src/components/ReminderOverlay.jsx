import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/index.js';
import { useMusicContext } from '../context/MusicContext.jsx';
import { playReminderTone, stopReminderTone, normalizeTone } from '../hooks/reminderTones.js';
import { DEFAULT_SNOOZE_MIN } from '../hooks/reminderSchedule.js';
import { markAcked, snoozeReminder } from '../hooks/reminderAcks.js';
import t from '../i18n/he.json';

// Ring, wait, ring again — until acknowledged or we give up. Bounded so an
// empty house doesn't get an endless alarm.
const RING_INTERVAL_MS = 30 * 1000;
const MAX_RINGS = 10; // ~5 minutes of nagging

// Music is ducked to this fraction of its current level while ringing.
const DUCK_TO_PERCENT = 10;

function formatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Ducks the music to 10% for as long as it is mounted, restoring the exact
 * previous level on unmount.
 *
 * The pre-duck level is captured in a ref on first mount only — reading it
 * from `volume` on every render would latch our own ducked value and restore
 * 10% instead of the original.
 */
function useMusicDucking() {
  const { isPlaying, volume, setVolume } = useMusicContext();
  const restoreRef = useRef(null);
  // Keep the latest setter/volume without re-triggering the duck effect.
  const liveRef = useRef({ isPlaying, volume, setVolume });
  liveRef.current = { isPlaying, volume, setVolume };

  useEffect(() => {
    const { isPlaying: playing, volume: current, setVolume: apply } = liveRef.current;
    // Nothing audible to duck, or already at/below the target.
    if (!playing || typeof current !== 'number' || current <= DUCK_TO_PERCENT) return undefined;

    restoreRef.current = current;
    apply(Math.round((current * DUCK_TO_PERCENT) / 100));

    return () => {
      const prev = restoreRef.current;
      restoreRef.current = null;
      if (prev != null) liveRef.current.setVolume(prev);
    };
    // Duck once for the lifetime of this overlay.
  }, []);
}

function ReminderCard({ reminder, onApprove, onSnooze }) {
  const tone = normalizeTone(useStore((s) => s.settings.reminderTone));
  const [rings, setRings] = useState(0);

  useMusicDucking();

  // Ring immediately, then keep ringing on an interval until dismissed.
  useEffect(() => {
    playReminderTone(tone);
    setRings(1);
    const id = setInterval(() => {
      setRings((n) => {
        if (n >= MAX_RINGS) {
          clearInterval(id);
          return n;
        }
        playReminderTone(tone);
        return n + 1;
      });
    }, RING_INTERVAL_MS);
    return () => {
      clearInterval(id);
      // Acknowledging must silence a ring already in progress, not just stop
      // scheduling the next one.
      stopReminderTone();
    };
  }, [tone]);

  const exhausted = rings >= MAX_RINGS;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label={t.calendar.reminderTitle}
      // NOTE: do NOT stopPropagation on the *capture* phase here. Capture runs
      // root -> target, so stopping it on this container prevents the event
      // from ever reaching the buttons inside it (they stop responding).
      // Click-through onto the calendar grid is blocked in handleSlotTap
      // instead, which is where the decision actually belongs.
    >
      <div
        className="mx-6 w-full max-w-[640px] rounded-3xl bg-[var(--s1)] border border-[var(--bd)]
                   shadow-2xl p-8 flex flex-col gap-6 text-center animate-[pulse_2s_ease-in-out_infinite]"
        style={{ animationIterationCount: exhausted ? 0 : 'infinite' }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-2xl text-ts">{t.calendar.reminderTitle}</span>
          <span className="text-5xl font-bold text-[var(--tp)] break-words">
            {reminder.title}
          </span>
          <span className="text-3xl text-acc font-semibold" dir="ltr">
            {formatTime(reminder.start)}
          </span>
          {reminder.location ? (
            <span className="text-xl text-ts break-words">{reminder.location}</span>
          ) : null}
        </div>

        <div className="flex items-center justify-center gap-4 flex-wrap">
          {/* Snooze first in the RTL flow, approve last (primary, focused). */}
          <button
            onClick={onSnooze}
            className="ripple px-9 min-h-[76px] rounded-2xl bg-[var(--s2)] text-[var(--tp)]
                       border border-[var(--bd)] text-2xl font-bold active:scale-95
                       transition-transform duration-[var(--dur-fast)]"
          >
            {t.calendar.reminderSnooze.replace('{min}', String(DEFAULT_SNOOZE_MIN))}
          </button>
          <button
            onClick={onApprove}
            autoFocus
            className="ripple px-12 min-h-[76px] rounded-2xl bg-acc text-white
                       text-2xl font-bold active:scale-95 transition-transform
                       duration-[var(--dur-fast)]"
          >
            {t.calendar.reminderApprove}
          </button>
        </div>

        <span className="text-base text-tm">
          {exhausted
            ? t.calendar.reminderStopped
            : t.calendar.reminderRingCount
                .replace('{n}', String(rings))
                .replace('{max}', String(MAX_RINGS))}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders the first queued reminder as a blocking, self-repeating alarm.
 *
 * Mounted inside MusicProvider and after <Screensaver /> in App so it can duck
 * the player and still paint above the screensaver (which is z-30).
 */
export default function ReminderOverlay() {
  const reminders = useStore((s) => s.reminders);
  const dismissReminder = useStore((s) => s.dismissReminder);

  const current = reminders[0];
  if (!current) return null;

  // `key` remounts the card per reminder so the ring counter and the music
  // duck/restore cycle restart cleanly for each one.
  return (
    <ReminderCard
      key={current.id}
      reminder={current}
      onApprove={() => {
        // Persisted so a reload inside the lead window does not re-alarm.
        markAcked(current.id, current.start);
        dismissReminder(current.id);
      }}
      onSnooze={() => {
        snoozeReminder(current.id, current, DEFAULT_SNOOZE_MIN);
        dismissReminder(current.id);
      }}
    />
  );
}
