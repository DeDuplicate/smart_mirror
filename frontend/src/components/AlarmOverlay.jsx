import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/index.js';
import { useMusicContext } from '../context/MusicContext.jsx';
import { fetchApi } from '../hooks/useApi.js';
import { castAlarmToSpeakers, setSpeakersVolume, stopCast } from '../hooks/useMusic.js';
import t from '../i18n/he.json';

// Volume escalation while the alarm rings unanswered: start at the alarm's
// volume (default 50%), then +10% every 3 minutes up to 80%. "Nobody stopped
// it" = the overlay is still up, so the ladder just keeps stepping.
const VOLUME_STEP_MS = 3 * 60 * 1000;
const SNOOZE_MIN = 10;
const ladderFor = (alarm) => [alarm?.volume ?? 50, 60, 70, 80];

/**
 * Fires when the backend emits 'alarm:trigger'. Plays the alarm's song or
 * playlist on every speaker the alarm targets — 'local' means the mirror's
 * own player — and shows a blocking card until dismissed. Dismissing pauses
 * (never toggles — a toggle can START music if the track already ended) and
 * restores the pre-alarm local volume.
 *
 * Mounted inside MusicProvider so it can drive the queue/player.
 */
export default function AlarmOverlay() {
  const alarm = useStore((s) => s.activeAlarm);
  const setActiveAlarm = useStore((s) => s.setActiveAlarm);
  const addToast = useStore((s) => s.addToast);
  const music = useMusicContext();
  const firedFor = useRef(null);
  const [playbackError, setPlaybackError] = useState(null);
  // Current ladder step, shared by the escalation timer AND the per-speaker
  // post-cast volume_set (a cold track can finish warming after the first
  // escalation tick — it must get the CURRENT step, not the starting one).
  const stepRef = useRef(0);
  // Local volume before the alarm grabbed it; restored on dismiss.
  const prevVolumeRef = useRef(null);

  const speakers = alarm?.speakers || [];
  const useLocal = speakers.includes('local');
  const targets = speakers.filter((s) => s !== 'local');
  const steps = ladderFor(alarm);
  const currentStepVolume = () => steps[Math.min(stepRef.current, steps.length - 1)];

  // Execute the playback plan exactly once per alarm firing.
  useEffect(() => {
    if (!alarm || firedFor.current === alarm.id) return undefined;
    firedFor.current = alarm.id;
    setPlaybackError(null);
    stepRef.current = 0;
    prevVolumeRef.current = null;

    (async () => {
      let track = {
        id: alarm.media_id,
        title: alarm.media_title,
        artist: alarm.media_artist,
        imageUrl: alarm.media_image,
        durationSeconds: 0,
      };
      let playlistRest = [];

      if (alarm.media_type === 'playlist') {
        try {
          const data = await fetchApi(`/api/music/playlist/${encodeURIComponent(alarm.media_id)}`);
          const tracks = data.tracks || [];
          if (!tracks.length) throw new Error('empty playlist');
          track = tracks[0];
          playlistRest = tracks.slice(1);
          // Speakers get the first track; the playlist continues via the
          // auto-related/preheat machinery on 'local' only.
        } catch (err) {
          // Do NOT bail silently: an alarm that plays nothing while pretending
          // to ring is the worst outcome. Say so and stop here.
          setPlaybackError(err.message || 'playlist');
          addToast('error', t.music.castError);
          return;
        }
      }

      if (useLocal) {
        // Take over local playback. If the output is currently a speaker,
        // stop it with media_stop ONLY (no turn_off — it may be an alarm
        // target about to be re-cast) and AWAIT it, then switch output with
        // stopPrev:false so setOutputId doesn't fire a second, floating
        // stopCast whose late turn_off would kill the fresh cast.
        if (music.outputId !== 'local') {
          try { await stopCast(music.outputId); } catch { /* already stopped */ }
          music.setOutputId('local', { stopPrev: false });
        }
        prevVolumeRef.current = music.volume;
        music.playTrack(track, playlistRest);
        // persist:false — an unanswered alarm must not become the saved
        // preference (same bug class as reminder ducking).
        music.setVolume(currentStepVolume(), { persist: false });
      }

      if (targets.length) {
        await castAlarmToSpeakers(track, targets, currentStepVolume);
      }
    })();
    // Keyed on the alarm id only — music/targets change identity every
    // render and must not re-run (or restart) the playback plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarm?.id]);

  // Volume escalation: one step louder every VOLUME_STEP_MS while the alarm
  // stays unanswered. Starts from step 1 — the cast path already applied
  // step 0 after the receiver app launched (setting it earlier is lost: app
  // launch resets to the device's own level). Stops if playback failed.
  useEffect(() => {
    if (!alarm || playbackError) return undefined;
    const timer = setInterval(() => {
      stepRef.current += 1;
      const v = currentStepVolume();
      if (useLocal) music.setVolume(v, { persist: false });
      if (targets.length) setSpeakersVolume(targets, v).catch(() => {});
    }, VOLUME_STEP_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarm?.id, playbackError]);

  if (!alarm) return null;

  const stopPlayback = () => {
    for (const id of targets) {
      stopCast(id).catch(() => {});
    }
    if (useLocal) {
      // Pause-only: playPause is a toggle and would START music at the
      // escalated volume if the alarm track already ended.
      try { music.pause?.(); } catch { /* not playing */ }
      if (prevVolumeRef.current != null) {
        music.setVolume(prevVolumeRef.current, { persist: false });
      }
    }
    firedFor.current = null;
  };

  const dismiss = () => {
    stopPlayback();
    setActiveAlarm(null);
  };

  const snooze = async () => {
    stopPlayback();
    setActiveAlarm(null);
    try {
      await fetchApi(`/api/alarms/${alarm.id}/snooze`, {
        method: 'POST',
        body: JSON.stringify({ minutes: SNOOZE_MIN }),
      });
      addToast('info', t.alarms.snoozed.replace('{min}', String(SNOOZE_MIN)));
    } catch { /* the overlay is already down; worst case no re-fire */ }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      role="alertdialog"
      aria-modal="true"
      aria-label={t.alarms.title}
    >
      {/* No pulse animation or backdrop blur here: both repaint a large
          shadowed card every frame, which visibly flickers on the Pi 2's
          low-end GPU. The alarm is attention-grabbing by being loud instead. */}
      <div
        className="mx-6 w-full max-w-[640px] rounded-3xl bg-[var(--s1)] border border-[var(--bd)]
                   shadow-2xl p-8 flex flex-col gap-6 text-center items-center"
      >
        {alarm.media_image ? (
          <img src={alarm.media_image} alt="" className="w-32 h-32 rounded-2xl object-cover shadow-lg" />
        ) : null}
        <div className="flex flex-col gap-2">
          <span className="text-2xl text-ts">{alarm.label || t.alarms.title}</span>
          <span className="text-6xl font-bold text-[var(--tp)]" dir="ltr">{alarm.time}</span>
          <span className="text-2xl text-acc font-semibold break-words">{alarm.media_title}</span>
          <span className="text-lg text-tm">
            {playbackError ? t.music.castError : t.alarms.ringing}
          </span>
        </div>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          {/* Snooze first in the RTL flow, dismiss last (primary, focused). */}
          <button
            onClick={snooze}
            className="ripple px-9 min-h-[76px] rounded-2xl bg-[var(--s2)] text-[var(--tp)]
                       border border-[var(--bd)] text-2xl font-bold active:scale-95
                       transition-transform duration-[var(--dur-fast)]"
          >
            {t.alarms.snooze.replace('{min}', String(SNOOZE_MIN))}
          </button>
          <button
            onClick={dismiss}
            autoFocus
            className="ripple px-16 min-h-[76px] rounded-2xl bg-acc text-white
                       text-2xl font-bold active:scale-95 transition-transform
                       duration-[var(--dur-fast)]"
          >
            {t.alarms.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
