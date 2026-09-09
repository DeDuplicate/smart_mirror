import React, { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../../store/index.js';
import { fetchApi } from '../../hooks/useApi.js';
import OnScreenKeyboard from '../OnScreenKeyboard.jsx';
import t from '../../i18n/he.json';

const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']; // 0=Sunday .. 6=Saturday

const emptyDraft = () => ({
  id: null,
  label: '',
  hour: 7,
  minute: 0,
  days: [],
  speakers: ['local'],
  media: null, // { type: 'track'|'playlist', id, title, artist, imageUrl }
});

function daysLabel(days) {
  if (!days.length) return t.alarms.everyDay;
  return days.map((d) => DAY_LETTERS[d]).join(' ');
}

function AlarmRow({ alarm, onEdit, onToggle, onDelete }) {
  return (
    <div className={`flex items-center gap-5 rounded-2xl border border-bd px-6 py-4 ${alarm.enabled ? 'bg-s1' : 'bg-s2 opacity-60'}`}>
      <button onClick={() => onEdit(alarm)} className="flex-1 flex items-center gap-5 text-start min-h-[56px]">
        <span className="text-4xl font-bold text-tp tabular-nums" dir="ltr">{alarm.time}</span>
        <span className="flex flex-col min-w-0">
          <span className="text-xl text-tp truncate">{alarm.label || alarm.media_title}</span>
          <span className="text-base text-ts truncate">
            {daysLabel(alarm.days)} · {alarm.media_type === 'playlist' ? t.alarms.playlists : t.alarms.tracks}: {alarm.media_title}
          </span>
        </span>
      </button>
      <button
        onClick={() => onToggle(alarm)}
        aria-label={t.alarms.enabled}
        className={`w-16 h-10 rounded-full transition-colors relative shrink-0 ${alarm.enabled ? 'bg-acc' : 'bg-s2 border border-bd'}`}
      >
        <span className={`absolute top-1 w-8 h-8 rounded-full bg-white shadow transition-all ${alarm.enabled ? 'start-1' : 'start-7'}`} />
      </button>
      <button
        onClick={() => onDelete(alarm)}
        aria-label={t.common.delete}
        className="ripple min-w-[56px] min-h-[56px] rounded-xl text-ts hover:text-red-400 active:scale-95"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7 mx-auto">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
        </svg>
      </button>
    </div>
  );
}

const DIAL_SIZE = 320;
const DIAL_R = DIAL_SIZE / 2;
const DIAL_OUTER = 128; // outer ring: 00,13-23 (hours) or minute labels
const DIAL_INNER = 84;  // inner ring: 12,1-11 (hours)
const DIAL_RING_SPLIT = (DIAL_OUTER + DIAL_INNER) / 2;

function dialPoint(angle, r) {
  return { x: DIAL_R + r * Math.sin(angle), y: DIAL_R - r * Math.cos(angle) };
}

// k = clock position (0 = top, clockwise, 12 positions)
const hourAtOuter = (k) => (k === 0 ? 0 : k + 12); // 00,13..23
const hourAtInner = (k) => (k === 0 ? 12 : k);     // 12,1..11
function hourRing(hour) {
  if (hour === 0) return { k: 0, outer: true };
  if (hour >= 13) return { k: hour - 12, outer: true };
  if (hour === 12) return { k: 0, outer: false };
  return { k: hour, outer: false };
}

/**
 * Android-style clock-face time picker. Tap the big HH / MM to choose which
 * field the dial edits; tap or drag on the face to set it. Picking an hour
 * (on release) advances to minutes, like Material's time picker.
 */
function ClockDial({ hour, minute, onChange }) {
  const [mode, setMode] = useState('hours');
  const faceRef = useRef(null);
  const dragging = useRef(false);

  const valueFromPoint = (clientX, clientY) => {
    const rect = faceRef.current.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    let angle = Math.atan2(dx, -dy); // 0 at top, clockwise
    if (angle < 0) angle += Math.PI * 2;
    if (mode === 'hours') {
      const k = Math.round(angle / (Math.PI / 6)) % 12;
      const outer = Math.hypot(dx, dy) > DIAL_RING_SPLIT;
      return outer ? hourAtOuter(k) : hourAtInner(k);
    }
    return Math.round(angle / (Math.PI / 30)) % 60;
  };

  const applyPoint = (e) => {
    const v = valueFromPoint(e.clientX, e.clientY);
    onChange(mode === 'hours' ? { hour: v } : { minute: v });
  };

  const hand = (() => {
    if (mode === 'hours') {
      const { k, outer } = hourRing(hour);
      return { angle: k * (Math.PI / 6), r: outer ? DIAL_OUTER : DIAL_INNER, label: hour };
    }
    return { angle: minute * (Math.PI / 30), r: DIAL_OUTER, label: minute };
  })();
  const tip = dialPoint(hand.angle, hand.r);

  const numbers = [];
  if (mode === 'hours') {
    for (let k = 0; k < 12; k += 1) {
      numbers.push({ v: hourAtOuter(k), k, outer: true });
      numbers.push({ v: hourAtInner(k), k, outer: false });
    }
  } else {
    for (let k = 0; k < 12; k += 1) numbers.push({ v: k * 5, k, outer: true });
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* big tappable readout — active field in accent, like Material */}
      <div className="text-6xl font-bold tabular-nums flex items-center gap-1" dir="ltr">
        <button
          onClick={() => setMode('hours')}
          className={`px-3 py-1 rounded-2xl ${mode === 'hours' ? 'text-acc bg-lav' : 'text-tp'}`}
        >
          {String(hour).padStart(2, '0')}
        </button>
        <span className="text-tp">:</span>
        <button
          onClick={() => setMode('minutes')}
          className={`px-3 py-1 rounded-2xl ${mode === 'minutes' ? 'text-acc bg-lav' : 'text-tp'}`}
        >
          {String(minute).padStart(2, '0')}
        </button>
      </div>

      <svg
        ref={faceRef}
        width={DIAL_SIZE}
        height={DIAL_SIZE}
        className="rounded-full bg-s2 border border-bd select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          applyPoint(e);
        }}
        onPointerMove={(e) => dragging.current && applyPoint(e)}
        onPointerUp={() => {
          dragging.current = false;
          if (mode === 'hours') setMode('minutes');
        }}
      >
        {/* hand */}
        <line x1={DIAL_R} y1={DIAL_R} x2={tip.x} y2={tip.y} stroke="var(--acc)" strokeWidth="3" />
        <circle cx={DIAL_R} cy={DIAL_R} r="6" fill="var(--acc)" />

        {numbers.map(({ v, k, outer }) => {
          const p = dialPoint(k * (Math.PI / 6), outer ? DIAL_OUTER : DIAL_INNER);
          const isSel = v === hand.label && (mode === 'minutes' || hourRing(v).outer === outer);
          return (
            <g key={`${outer ? 'o' : 'i'}${k}`}>
              {isSel && <circle cx={p.x} cy={p.y} r="24" fill="var(--acc)" />}
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={outer ? 20 : 17}
                fontWeight={isSel ? 700 : 400}
                fill={isSel ? '#fff' : 'var(--tp)'}
                pointerEvents="none"
              >
                {String(v).padStart(2, '0')}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AlarmEditor({ draft, setDraft, speakers, onSave, onCancel }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ tracks: [], playlists: [] });
  const [searching, setSearching] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  // Which field the on-screen keyboard types into: the label or the search.
  const [keyboardTarget, setKeyboardTarget] = useState('query');
  const addToast = useStore((s) => s.addToast);

  const keyboardInput = (ch) => {
    if (keyboardTarget === 'label') patch({ label: draft.label + ch });
    else setQuery((q) => q + ch);
  };
  const keyboardBackspace = () => {
    if (keyboardTarget === 'label') patch({ label: draft.label.slice(0, -1) });
    else setQuery((q) => q.slice(0, -1));
  };
  const focusField = (field) => {
    setKeyboardTarget(field);
    setKeyboardOpen(true);
  };

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const data = await fetchApi(`/api/music/search?q=${encodeURIComponent(q)}`);
      setResults({ tracks: data.tracks || [], playlists: data.playlists || [] });
    } catch {
      addToast('error', t.music.searchError);
    } finally {
      setSearching(false);
    }
  }, [query, addToast]);

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const toggleDay = (day) => patch({
    days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort(),
  });
  const toggleSpeaker = (id) => patch({
    speakers: draft.speakers.includes(id) ? draft.speakers.filter((s) => s !== id) : [...draft.speakers, id],
  });

  const save = () => {
    if (!draft.speakers.length) return addToast('error', t.alarms.noSpeakers);
    if (!draft.media) return addToast('error', t.alarms.noMedia);
    onSave(draft);
  };

  return (
    // Two fixed columns sized to fit 1080p without scrolling — touch scrolling
    // a form on the kiosk is uncomfortable, so everything stays on screen.
    <div className="flex flex-col gap-4 rounded-3xl bg-s1 border border-bd p-5 flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-2xl font-bold text-tp">{draft.id ? t.alarms.edit : t.alarms.add}</span>
      </div>

      <div className="grid grid-cols-2 gap-5 flex-1 min-h-0">
        {/* column 1: time + days + label */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex flex-col gap-1.5 items-center">
            <span className="text-lg text-ts self-start">{t.alarms.time}</span>
            <ClockDial
              hour={draft.hour}
              minute={draft.minute}
              onChange={(p) => patch(p)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-lg text-ts">
              {t.alarms.days}{draft.days.length === 0 ? ` · ${t.alarms.everyDay}` : ''}
            </span>
            <div className="grid grid-cols-7 gap-1.5">
              {DAY_LETTERS.map((letter, day) => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`ripple min-h-[48px] rounded-lg text-xl font-bold active:scale-95 border
                    ${draft.days.includes(day) ? 'bg-acc text-white border-transparent' : 'bg-s2 text-ts border-bd'}`}
                >
                  {letter}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-lg text-ts">{t.alarms.label}</span>
            <input
              value={draft.label}
              onChange={(e) => patch({ label: e.target.value })}
              onFocus={() => focusField('label')}
              placeholder={t.alarms.labelPlaceholder}
              className="min-h-[52px] rounded-xl bg-s2 border border-bd px-4 text-xl text-tp"
            />
          </div>
        </div>

        {/* column 2: speakers + media */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex flex-col gap-1.5">
            <span className="text-lg text-ts">{t.alarms.speakers}</span>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {[{ id: 'local', name: t.alarms.thisScreen }, ...speakers].map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleSpeaker(s.id)}
                  className={`ripple px-4 min-h-[48px] rounded-lg text-lg font-semibold active:scale-95 border
                    ${draft.speakers.includes(s.id) ? 'bg-acc text-white border-transparent' : 'bg-s2 text-ts border-bd'}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 flex-1 min-h-0">
            <span className="text-lg text-ts">{t.alarms.media}</span>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => focusField('query')}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder={t.alarms.searchPlaceholder}
                className="flex-1 min-h-[52px] rounded-xl bg-s2 border border-bd px-4 text-xl text-tp"
              />
              <button onClick={search} className="ripple px-5 min-h-[52px] rounded-xl bg-acc text-white text-xl font-bold active:scale-95">
                {t.alarms.search}
              </button>
            </div>

            {draft.media && (
              <div className="flex items-center gap-3 rounded-xl bg-lav px-3 py-2 shrink-0">
                {draft.media.imageUrl ? <img src={draft.media.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover" /> : null}
                <span className="text-lg text-tp font-semibold truncate">{draft.media.title}</span>
                <span className="text-base text-ts shrink-0">{draft.media.type === 'playlist' ? t.alarms.playlists : t.alarms.tracks}</span>
              </div>
            )}

            {searching && <span className="text-lg text-tm">{t.common.loading}</span>}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5">
              {[...results.playlists.map((p) => ({ ...p, type: 'playlist' })),
                ...results.tracks.map((tr) => ({ ...tr, type: 'track' }))].map((item) => (
                <button
                  key={`${item.type}:${item.id}`}
                  onClick={() => patch({ media: { type: item.type, id: item.id, title: item.title, artist: item.artist || '', imageUrl: item.imageUrl || '' } })}
                  className="flex items-center gap-3 rounded-lg px-3 min-h-[52px] text-start hover:bg-s2 active:bg-lav shrink-0"
                >
                  {item.imageUrl ? <img src={item.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" /> : null}
                  <span className="text-lg text-tp truncate">{item.title}</span>
                  {item.artist ? <span className="text-base text-ts truncate">{item.artist}</span> : null}
                  <span className="text-sm text-tm ms-auto shrink-0">{item.type === 'playlist' ? t.alarms.playlists : item.duration || ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-3 justify-end shrink-0">
        <button onClick={onCancel} className="ripple px-8 min-h-[56px] rounded-xl bg-s2 border border-bd text-xl text-tp active:scale-95">
          {t.common.cancel}
        </button>
        <button onClick={save} className="ripple px-10 min-h-[56px] rounded-xl bg-acc text-white text-xl font-bold active:scale-95">
          {t.common.save}
        </button>
      </div>

      <OnScreenKeyboard
        visible={keyboardOpen}
        onClose={() => setKeyboardOpen(false)}
        onEnter={() => { setKeyboardOpen(false); if (keyboardTarget === 'query') search(); }}
        onInput={keyboardInput}
        onBackspace={keyboardBackspace}
      />
    </div>
  );
}

export default function AlarmsPage() {
  const [alarms, setAlarms] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [draft, setDraft] = useState(null); // null = list view
  const addToast = useStore((s) => s.addToast);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi('/api/alarms');
      setAlarms(data.alarms || []);
    } catch { /* offline */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchApi('/api/ha/media-players')
      .then((data) => setSpeakers(
        (data.players || []).map((p) => ({
          id: p.entity_id,
          name: p.attributes?.friendly_name || p.entity_id,
        })).filter((s) => s.id && s.name)
      ))
      .catch(() => setSpeakers([]));
  }, []);

  const save = async (d) => {
    const body = {
      label: d.label,
      time: `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`,
      days: d.days,
      speakers: d.speakers,
      media_type: d.media.type,
      media_id: d.media.id,
      media_title: d.media.title,
      media_artist: d.media.artist,
      media_image: d.media.imageUrl,
      volume: null, // the escalation ladder (50→80%) owns volume
      enabled: true,
    };
    try {
      if (d.id) await fetchApi(`/api/alarms/${d.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await fetchApi('/api/alarms', { method: 'POST', body: JSON.stringify(body) });
      setDraft(null);
      load();
    } catch (err) {
      addToast('error', err.message);
    }
  };

  const toggle = async (alarm) => {
    try {
      await fetchApi(`/api/alarms/${alarm.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...alarm, enabled: !alarm.enabled }),
      });
      load();
    } catch { /* offline */ }
  };

  const remove = async (alarm) => {
    try {
      await fetchApi(`/api/alarms/${alarm.id}`, { method: 'DELETE' });
      load();
    } catch { /* offline */ }
  };

  const startEdit = (alarm) => {
    const [hour, minute] = alarm.time.split(':').map(Number);
    setDraft({
      id: alarm.id,
      label: alarm.label,
      hour,
      minute,
      days: alarm.days,
      speakers: alarm.speakers,
      media: {
        type: alarm.media_type,
        id: alarm.media_id,
        title: alarm.media_title,
        artist: alarm.media_artist,
        imageUrl: alarm.media_image,
      },
    });
  };

  return (
    <div className="h-full overflow-y-auto p-6 flex flex-col gap-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-tp">{t.alarms.title}</h1>
        {!draft && (
          <button onClick={() => setDraft(emptyDraft())} className="ripple px-8 min-h-[60px] rounded-xl bg-acc text-white text-xl font-bold active:scale-95">
            + {t.alarms.add}
          </button>
        )}
      </div>

      {draft ? (
        <AlarmEditor
          draft={draft}
          setDraft={setDraft}
          speakers={speakers}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      ) : alarms.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <span className="text-2xl text-ts">{t.alarms.empty}</span>
          <span className="text-lg text-tm">{t.alarms.emptyHint}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {alarms.map((alarm) => (
            <AlarmRow key={alarm.id} alarm={alarm} onEdit={startEdit} onToggle={toggle} onDelete={remove} />
          ))}
        </div>
      )}
    </div>
  );
}
