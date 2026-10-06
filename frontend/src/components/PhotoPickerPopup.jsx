import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import t from '../i18n/he.json';
import { fetchApi } from '../hooks/useApi.js';
import { initialCrop, placement, panBy, zoomBy, sourceRect, ZOOM_STEP } from '../hooks/avatarCrop.js';

// ─── Photo picker (a kid's picture) ─────────────────────────────────────────
// Browse the photo server (Immich) or the folders under backend/data/photos/ (a
// NAS share mounted there shows up as a folder), tap a picture, then drag and
// zoom it inside a circle. Returns a small square JPEG as a data URL.
//
// Everything is big and single-touch: the IR frame has no pinch, and a tile is
// 150+ px, well over the 56 px touch minimum. Grid images are thumbnails (Immich
// 250 px, or ffmpeg-made copies of NAS photos): thirty originals would stall a Pi.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = '/api/photoframe';
const VIEW = 360; // the crop circle, in CSS px
const OUT = 160; // the saved avatar, in px

const immichThumb = (id) => `${BASE}/immich/${id}?size=thumbnail`;
const immichFull = (id) => `${BASE}/immich/${id}`;
const faceUrl = (id) => `${BASE}/people/${id}/face`;
const localThumb = (p) => `${BASE}/thumb?path=${encodeURIComponent(p)}`;
const localMedium = (p) => `${BASE}/thumb?path=${encodeURIComponent(p)}&size=medium`;

const stop = (e) => e.stopPropagation();

function Icon({ children, className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}
const FolderIcon = (p) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></Icon>;
const UpIcon = (p) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>;
const CloseIcon = (p) => <Icon {...p}><path d="M18 6L6 18M6 6l12 12" /></Icon>;
const PlusIcon = (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
const MinusIcon = (p) => <Icon {...p}><path d="M5 12h14" /></Icon>;

function Spinner({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// A person's face from Immich, or their initial when there is none to show.
function Face({ id, name }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <span className="w-14 h-14 rounded-full bg-[var(--bd)] flex items-center justify-center text-xl font-bold text-[var(--ts)]">
        {name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={faceUrl(id)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setBad(true)}
      className="w-14 h-14 rounded-full object-cover bg-[var(--bd)]"
    />
  );
}

function Notice({ children, busy }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--ts)] text-xl text-center px-10">
      {busy && <Spinner />}
      <p>{children}</p>
    </div>
  );
}

function Tile({ src, label, badge, onClick }) {
  // A photo the server cannot make a thumbnail of (a broken file) is left out
  // rather than shown as a blank square that does nothing when tapped.
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative aspect-square rounded-xl overflow-hidden bg-[var(--s2)] border border-[var(--bd)] active:scale-95 transition-transform duration-[var(--dur-fast)]"
    >
      <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className="w-full h-full object-cover" />
      {badge && (
        <span className="absolute bottom-1.5 start-1.5 px-2.5 py-0.5 rounded-full bg-black/65 text-white text-sm font-medium">{badge}</span>
      )}
    </button>
  );
}

const GRID = 'grid grid-cols-7 pt:grid-cols-4 gap-3 content-start';

// ─── Immich ──────────────────────────────────────────────────────────────────

function ImmichBrowser({ onChoose }) {
  const [people, setPeople] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [personId, setPersonId] = useState('');
  const [albumId, setAlbumId] = useState('');
  const [assets, setAssets] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([fetchApi(`${BASE}/people`), fetchApi(`${BASE}/albums`)]).then(([p, a]) => {
      if (!alive) return;
      setPeople(p.status === 'fulfilled' ? p.value.people || [] : []);
      setAlbums(a.status === 'fulfilled' ? a.value.albums || [] : []);
    });
    return () => { alive = false; };
  }, []);

  const query = useMemo(() => `albumId=${encodeURIComponent(albumId)}&personId=${encodeURIComponent(personId)}`, [albumId, personId]);

  useEffect(() => {
    let alive = true;
    setState('loading');
    setAssets([]);
    setNextPage(null);
    fetchApi(`${BASE}/browse/immich?${query}`)
      .then((d) => {
        if (!alive) return;
        setAssets(d.assets || []);
        setNextPage(d.nextPage || null);
        setState('ready');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [query]);

  const more = useCallback(async () => {
    if (!nextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await fetchApi(`${BASE}/browse/immich?${query}&page=${nextPage}`);
      setAssets((a) => [...a, ...(d.assets || [])]);
      setNextPage(d.nextPage || null);
    } catch {
      // the button stays; tapping it again retries
    } finally {
      setLoadingMore(false);
    }
  }, [nextPage, loadingMore, query]);

  const person = (people || []).find((p) => p.id === personId);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      {/* People: Immich's own face crops, the quickest way to a kid's picture */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
          <button
            type="button"
            onClick={() => setPersonId('')}
            className={`shrink-0 min-w-[84px] h-[96px] px-3 rounded-xl border text-base font-medium active:scale-95 transition-transform
                        ${personId === '' ? 'bg-[var(--acc)] border-[var(--acc)] text-white' : 'bg-[var(--s2)] border-[var(--bd)] text-[var(--tp)]'}`}
          >
            {t.avatarPicker.allPeople}
          </button>
          {(people || []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPersonId(p.id)}
              aria-pressed={personId === p.id}
              className={`shrink-0 w-[96px] h-[96px] flex flex-col items-center justify-center gap-1 rounded-xl border active:scale-95 transition-transform
                          ${personId === p.id ? 'bg-[color-mix(in_srgb,var(--acc)_14%,transparent)] border-[var(--acc)]' : 'bg-[var(--s2)] border-[var(--bd)]'}`}
            >
              <Face id={p.id} name={p.name} />
              <span className="max-w-full truncate px-1 text-sm text-[var(--tp)]">{p.name}</span>
            </button>
          ))}
        </div>
        {albums.length > 0 && (
          <select
            value={albumId}
            onChange={(e) => setAlbumId(e.target.value)}
            aria-label={t.avatarPicker.album}
            className="shrink-0 h-14 min-w-[200px] max-w-[260px] px-4 rounded-xl bg-[var(--s2)] border border-[var(--bd)] text-[var(--tp)] text-base"
          >
            <option value="">{t.avatarPicker.allAlbums}</option>
            <option value="favorites">{t.avatarPicker.favorites}</option>
            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {state === 'loading' && <Notice busy>{t.avatarPicker.loading}</Notice>}
      {state === 'error' && <Notice>{t.avatarPicker.loadFailed}</Notice>}
      {state === 'ready' && assets.length === 0 && !person && <Notice>{t.avatarPicker.noPhotos}</Notice>}
      {state === 'ready' && (assets.length > 0 || person) && (
        <div className="flex-1 min-h-0 overflow-y-auto pe-1" style={{ scrollbarWidth: 'thin' }}>
          <div className={GRID}>
            {person && (
              <Tile
                src={faceUrl(person.id)}
                label={t.avatarPicker.faceOf.replace('{name}', person.name)}
                badge={t.avatarPicker.face}
                onClick={() => onChoose({ src: faceUrl(person.id) })}
              />
            )}
            {assets.map((a) => (
              <Tile key={a.id} src={immichThumb(a.id)} label={a.name} onClick={() => onChoose({ src: immichFull(a.id) })} />
            ))}
          </div>
          {nextPage && (
            <div className="flex justify-center py-5">
              <button
                type="button"
                onClick={more}
                disabled={loadingMore}
                className="min-h-[56px] px-8 rounded-xl bg-[var(--s2)] border border-[var(--bd)] text-[var(--tp)] text-lg font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                {loadingMore ? t.avatarPicker.loading : t.avatarPicker.loadMore}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Folders / NAS ───────────────────────────────────────────────────────────

function FolderBrowser({ onChoose }) {
  const [path, setPath] = useState('');
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let alive = true;
    setState('loading');
    fetchApi(`${BASE}/browse/local?path=${encodeURIComponent(path)}`)
      .then((d) => { if (alive) { setData(d); setState('ready'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [path]);

  const crumbs = path ? path.split('/') : [];
  const empty = state === 'ready' && data && data.folders.length === 0 && data.photos.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className="flex items-center gap-2 min-w-0">
        {path && (
          <button
            type="button"
            onClick={() => setPath(data?.parent ?? '')}
            aria-label={t.avatarPicker.up}
            className="shrink-0 w-14 h-14 rounded-xl bg-[var(--s2)] border border-[var(--bd)] flex items-center justify-center text-[var(--tp)] active:scale-95 transition-transform"
          >
            <UpIcon />
          </button>
        )}
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto text-lg text-[var(--ts)]" style={{ scrollbarWidth: 'none' }}>
          <button type="button" onClick={() => setPath('')} className="shrink-0 min-h-[48px] px-3 rounded-lg font-semibold text-[var(--tp)] active:scale-95 transition-transform">
            {t.avatarPicker.rootFolder}
          </button>
          {crumbs.map((c, i) => (
            <span key={c + i} className="shrink-0 flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <button type="button" onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))} className="min-h-[48px] px-3 rounded-lg active:scale-95 transition-transform">
                {c}
              </button>
            </span>
          ))}
        </div>
      </div>

      {state === 'loading' && <Notice busy>{t.avatarPicker.loading}</Notice>}
      {state === 'error' && <Notice>{t.avatarPicker.loadFailed}</Notice>}
      {empty && <Notice>{t.avatarPicker.emptyFolder}</Notice>}
      {state === 'ready' && data && !empty && (
        <div className="flex-1 min-h-0 overflow-y-auto pe-1" style={{ scrollbarWidth: 'thin' }}>
          {data.folders.length > 0 && (
            <div className="grid grid-cols-4 pt:grid-cols-2 gap-3 mb-4">
              {data.folders.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setPath(f.path)}
                  className="min-h-[72px] px-4 rounded-xl bg-[var(--s2)] border border-[var(--bd)] flex items-center gap-3 text-[var(--tp)] text-lg font-medium text-start active:scale-95 transition-transform"
                >
                  <FolderIcon className="w-7 h-7 shrink-0 text-[var(--acc)]" />
                  <span className="min-w-0 truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className={GRID}>
            {data.photos.map((p) => (
              <Tile key={p.path} src={localThumb(p.path)} label={p.name} onClick={() => onChoose({ src: localMedium(p.path) })} />
            ))}
          </div>
          {data.photoCount > data.photos.length && (
            <p className="text-center text-[var(--tm)] text-base py-4">
              {t.avatarPicker.firstOnly.replace('{n}', String(data.photos.length)).replace('{total}', String(data.photoCount))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Crop ────────────────────────────────────────────────────────────────────

function Cropper({ src, onConfirm, onBack }) {
  const [img, setImg] = useState(null);
  const [failed, setFailed] = useState(false);
  const [crop, setCrop] = useState(null);
  const viewRef = useRef(null);
  const lastRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (!alive) return;
      setImg(im);
      setCrop(initialCrop(im.naturalWidth, im.naturalHeight));
    };
    im.onerror = () => { if (alive) setFailed(true); };
    im.src = src;
    return () => { alive = false; };
  }, [src]);

  if (failed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <p className="text-[var(--ts)] text-xl">{t.avatarPicker.imageFailed}</p>
        <button type="button" onClick={onBack} className="min-h-[56px] px-8 rounded-xl bg-[var(--s2)] border border-[var(--bd)] text-[var(--tp)] text-lg font-semibold active:scale-95 transition-transform">
          {t.avatarPicker.back}
        </button>
      </div>
    );
  }
  if (!img || !crop) return <Notice busy>{t.avatarPicker.loading}</Notice>;

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const p = placement(crop, nw, nh, VIEW);

  // The page is scaled by CSS (resolution and zoom settings), so a finger's
  // movement in screen px is not the same as in the circle's px.
  const onDown = (e) => {
    lastRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!lastRef.current) return;
    const k = (viewRef.current?.getBoundingClientRect().width || VIEW) / VIEW;
    const dx = (e.clientX - lastRef.current.x) / k;
    const dy = (e.clientY - lastRef.current.y) / k;
    lastRef.current = { x: e.clientX, y: e.clientY };
    setCrop((c) => panBy(c, dx, dy, nw, nh, VIEW));
  };
  const onUp = () => { lastRef.current = null; };

  const confirm = () => {
    const { sx, sy, size } = sourceRect(crop, nw, nh, VIEW);
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    canvas.getContext('2d').drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT);
    onConfirm(canvas.toDataURL('image/jpeg', 0.85));
  };

  const zoomBtn = 'w-16 h-16 rounded-2xl bg-[var(--s2)] border border-[var(--bd)] flex items-center justify-center text-[var(--tp)] active:scale-95 transition-transform';

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6">
      <p className="text-[var(--ts)] text-xl text-center">{t.avatarPicker.cropHint}</p>
      <div
        ref={viewRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative rounded-full overflow-hidden bg-black cursor-grab"
        style={{ width: VIEW, height: VIEW, touchAction: 'none', boxShadow: '0 0 0 6px var(--acc)' }}
        role="img"
        aria-label={t.avatarPicker.cropHint}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute', left: 0, top: 0, width: p.w, height: p.h, maxWidth: 'none',
            transform: `translate3d(${p.left}px, ${p.top}px, 0)`, userSelect: 'none', pointerEvents: 'none',
          }}
        />
      </div>
      <div className="flex items-center gap-4">
        <button type="button" aria-label={t.avatarPicker.zoomOut} onClick={() => setCrop((c) => zoomBy(c, 1 / ZOOM_STEP, nw, nh, VIEW))} className={zoomBtn}><MinusIcon className="w-8 h-8" /></button>
        <button type="button" aria-label={t.avatarPicker.zoomIn} onClick={() => setCrop((c) => zoomBy(c, ZOOM_STEP, nw, nh, VIEW))} className={zoomBtn}><PlusIcon className="w-8 h-8" /></button>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="min-h-[60px] px-8 rounded-xl bg-[var(--s2)] border border-[var(--bd)] text-[var(--tp)] text-lg font-semibold active:scale-95 transition-transform">
          {t.avatarPicker.back}
        </button>
        <button type="button" onClick={confirm} className="min-h-[60px] px-10 rounded-xl bg-[var(--acc)] text-white text-lg font-bold active:scale-95 transition-transform">
          {t.avatarPicker.save}
        </button>
      </div>
    </div>
  );
}

// ─── Popup ───────────────────────────────────────────────────────────────────

function Picker({ personName, initialTab, immichReady, onPick, onClose }) {
  const startTab = immichReady ? initialTab : 'folders';
  const [tab, setTab] = useState(startTab);
  // A tab is built the first time it is opened and then only hidden, so going
  // back from the crop (or to the other tab and back) returns to the same folder,
  // person and page instead of the top of the list.
  const [seen, setSeen] = useState({ [startTab]: true });
  const [chosen, setChosen] = useState(null); // { src }
  const openTab = (id) => { setTab(id); setSeen((s) => ({ ...s, [id]: true })); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabBtn = (id, label, disabled) => (
    <button
      type="button"
      key={id}
      disabled={disabled}
      onClick={() => openTab(id)}
      aria-pressed={tab === id}
      className={`min-h-[56px] px-7 rounded-xl text-lg font-semibold active:scale-95 transition-transform disabled:opacity-40
                  ${tab === id ? 'bg-[var(--acc)] text-white' : 'bg-[var(--s2)] text-[var(--tp)] border border-[var(--bd)]'}`}
    >
      {label}
    </button>
  );

  return createPortal(
    <div data-no-swipe dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center" onTouchStart={stop} onTouchEnd={stop}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.avatarPicker.title.replace('{name}', personName)}
        className="relative flex flex-col gap-5 w-[1500px] max-w-[96%] h-[900px] max-h-[94%] pt:w-[1000px] p-8 rounded-3xl bg-[var(--surf)] border border-[var(--bd)] shadow-modal overflow-hidden"
      >
        <div className="flex items-center gap-4">
          <h2 className="flex-1 min-w-0 truncate text-3xl font-bold text-[var(--tp)]">{t.avatarPicker.title.replace('{name}', personName)}</h2>
          {!chosen && (
            <div className="flex items-center gap-3">
              {tabBtn('immich', t.avatarPicker.tabImmich, !immichReady)}
              {tabBtn('folders', t.avatarPicker.tabFolders, false)}
            </div>
          )}
          <button type="button" onClick={onClose} aria-label={t.avatarPicker.close} className="w-14 h-14 rounded-xl bg-[var(--s2)] border border-[var(--bd)] flex items-center justify-center text-[var(--tp)] active:scale-95 transition-transform">
            <CloseIcon className="w-7 h-7" />
          </button>
        </div>

        {chosen && <Cropper src={chosen.src} onBack={() => setChosen(null)} onConfirm={onPick} />}
        {seen.immich && (
          <div className={tab === 'immich' && !chosen ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
            {immichReady ? <ImmichBrowser onChoose={setChosen} /> : <Notice>{t.avatarPicker.immichNotSet}</Notice>}
          </div>
        )}
        {seen.folders && (
          <div className={tab === 'folders' && !chosen ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
            <FolderBrowser onChoose={setChosen} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * @param {boolean} visible
 * @param {string} personName
 * @param {'immich'|'folders'} initialTab
 * @param {boolean} immichReady   Immich URL and key are set
 * @param {(dataUrl: string) => void} onPick   the cropped square
 * @param {() => void} onClose
 */
export default function PhotoPickerPopup({ visible, ...props }) {
  // Mounted only while open, so every opening starts fresh (back at the grid, no
  // stale crop) and nothing is fetched while it is closed.
  return visible ? <Picker {...props} /> : null;
}
