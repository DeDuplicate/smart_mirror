import React, { useEffect, useRef } from 'react';
import useStore from '../store/index.js';
import { useMusicContext } from '../context/MusicContext.jsx';
import { fetchApi } from '../hooks/useApi.js';
import { castAlarmToSpeakers, setSpeakersVolume, stopCast } from '../hooks/useMusic.js';
import t from '../i18n/he.json';

// Volume escalation while the alarm rings unanswered: 50% at fire, then
// +10% every 3 minutes up to 80%. "Nobody stopped it" = the overlay is still
// up, so the ladder just keeps stepping until dismissed.
const VOLUME_STEPS = [50, 60, 70, 80];
const VOLUME_STEP_MS = 3 * 60 * 1000;

/**
 * Fires when the backend emits 'alarm:trigger'. Plays the alarm's song or
 * playlist on every speaker the alarm targets — 'local' means the mirror's
 * own player — and shows a blocking card until dismissed. Dismissing stops
 * the playback it started (speakers get media_stop, local pauses).
 *
 * Mounted inside MusicProvider so it can drive the queue/player.
 */
export default function AlarmOverlay() {
  const alarm = useStore((s) => s.activeAlarm);
  const setActiveAlarm = useStore((s) => s.setActiveAlarm);
  const music = useMusicContext();
  const firedFor = useRef(null);

  const speakers = alarm?.speakers || [];
  const useLocal = speakers.includes('local');
  const targets = speakers.filter((s) => s !== 'local');

  // Execute the playback plan exactly once per alarm firing.
  useEffect(() => {
    if (!alarm || firedFor.current === alarm.id) return undefined;
    firedFor.current = alarm.id;

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
          if (!tracks.length) return;
          track = tracks[0];
          playlistRest = tracks.slice(1);
          // Speakers get the first track; the playlist continues via the
          // auto-related/preheat machinery on 'local' only.
        } catch {
          return;
        }
      }

      if (useLocal) {
        // Take over local playback. If the output is currently a speaker,
        // stop it FIRST and await it: setOutputId's internal stopCast is
        // fire-and-forget, and letting it float raced the broadcast — its
        // turn_off landed mid-cast and killed the speaker (05:21 failure).
        // A stopped target speaker simply gets re-cast a second later.
        if (music.outputId !== 'local') {
          try { await stopCast(music.outputId); } catch { /* already stopped */ }
          music.setOutputId('local');
        }
        music.playTrack(track, playlistRest);
        music.setVolume(VOLUME_STEPS[0]);
      }

      if (targets.length) {
        await castAlarmToSpeakers(track, targets, VOLUME_STEPS[0]);
      }
    })();
    // Keyed on the alarm id only — music/targets change identity every
    // render and must not re-run (or restart) the playback plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarm?.id]);

  // Volume escalation: one step louder every VOLUME_STEP_MS while the alarm
  // stays unanswered. Starts from step 1 — the cast path already applied
  // VOLUME_STEPS[0] after the receiver app launched (setting it earlier is
  // lost: app launch resets to the device's own level). Keyed on the alarm
  // id so a re-render can't restart or skip steps.
  useEffect(() => {
    if (!alarm) return undefined;
    let step = 1;
    const applyStep = () => {
      const v = VOLUME_STEPS[Math.min(step, VOLUME_STEPS.length - 1)];
      if (useLocal) music.setVolume(v);
      if (targets.length) setSpeakersVolume(targets, v).catch(() => {});
      step += 1;
    };
    const timer = setInterval(applyStep, VOLUME_STEP_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarm?.id]);

  if (!alarm) return null;

  const dismiss = () => {
    for (const id of targets) {
      stopCast(id).catch(() => {});
    }
    if (useLocal) {
      try { music.playPause(); } catch { /* not playing */ }
    }
    firedFor.current = null;
    setActiveAlarm(null);
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
          <span className="text-lg text-tm">{t.alarms.ringing}</span>
        </div>
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
  );
}
