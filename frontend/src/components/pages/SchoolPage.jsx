import { useState, useRef, useCallback, useMemo } from 'react';
import t from '../../i18n/he.json';
import { TasksSkeleton } from '../Skeleton.jsx';
import useSchool, { packedKey } from '../../hooks/useSchool.js';
import CelebrationAnimation from '../CelebrationAnimation.jsx';

// ─── Icons ─────────────────────────────────────────────────────────────────

function CheckIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Checklist row ─────────────────────────────────────────────────────────

function ItemRow({ item, personColor, onToggle }) {
  const [justToggled, setJustToggled] = useState(false);

  const handleToggle = useCallback(() => {
    setJustToggled(true);
    setTimeout(() => setJustToggled(false), 500);
    onToggle(item.itemKey, !item.checked);
  }, [onToggle, item.itemKey, item.checked]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={item.checked}
      aria-label={`${item.label}${item.checked ? ` — ${t.school.packed}` : ''}`}
      className={`
        w-full flex items-center gap-3 ps-3 pe-4 py-2 rounded-xl min-h-[56px]
        border border-[var(--bd)]
        transition-all duration-[var(--dur-fast)] active:scale-[0.98]
        ${item.checked ? 'bg-[var(--mint-bg)]' : 'bg-[var(--surf)]'}
      `}
      style={{ borderInlineStart: `3px solid ${personColor}` }}
    >
      <div
        aria-hidden="true"
        className={`
          flex-shrink-0 w-[44px] h-[44px] rounded-full
          flex items-center justify-center
          border-2 transition-all duration-[var(--dur-normal)]
          ${item.checked
            ? 'border-[var(--acc2)] bg-[var(--acc2)]'
            : 'border-[var(--tm)] bg-transparent'}
          ${justToggled ? 'task-checkbox-animate' : ''}
        `}
      >
        {item.checked && <CheckIcon className="w-5 h-5 text-white" />}
      </div>
      <span
        className={`
          flex-1 text-start text-base font-medium leading-snug truncate
          transition-all duration-[var(--dur-normal)]
          ${item.checked ? 'line-through text-[var(--ts)]' : 'text-[var(--tp)]'}
        `}
      >
        {item.label}
      </span>
    </button>
  );
}

// ─── Subject header (whole-subject "packed" tick) ──────────────────────────

function SubjectHeader({ subject, personColor, onToggle }) {
  const [justToggled, setJustToggled] = useState(false);
  const checked = !!subject.checked;

  const handleToggle = useCallback(() => {
    setJustToggled(true);
    setTimeout(() => setJustToggled(false), 500);
    onToggle(packedKey(subject.subject), !checked);
  }, [onToggle, subject.subject, checked]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={checked}
      aria-label={`${subject.subject} — ${t.school.subjectPacked}${checked ? ` — ${t.school.packed}` : ''}`}
      className={`
        w-full flex items-center gap-2 ps-1 pe-2 py-1 rounded-xl min-h-[56px]
        transition-all duration-[var(--dur-fast)] active:scale-[0.98]
        ${checked ? 'bg-[var(--mint-bg)]' : 'bg-transparent'}
      `}
    >
      <div
        aria-hidden="true"
        className={`
          flex-shrink-0 w-[36px] h-[36px] rounded-full
          flex items-center justify-center
          border-2 transition-all duration-[var(--dur-normal)]
          ${checked
            ? 'border-[var(--acc2)] bg-[var(--acc2)]'
            : 'border-[var(--tm)] bg-transparent'}
          ${justToggled ? 'task-checkbox-animate' : ''}
        `}
      >
        {checked && <CheckIcon className="w-4 h-4 text-white" />}
      </div>
      <span
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: personColor }}
        aria-hidden="true"
      />
      <h3
        className={`
          flex-1 text-start text-sm font-semibold truncate
          transition-all duration-[var(--dur-normal)]
          ${checked ? 'line-through text-[var(--tm)]' : 'text-[var(--ts)]'}
        `}
      >
        {subject.subject}
      </h3>
    </button>
  );
}

// ─── Person column ─────────────────────────────────────────────────────────

function PersonColumn({ person, avatar, onToggleItem }) {
  const columnRef = useRef(null);
  const [celebrating, setCelebrating] = useState(false);

  // Each subject contributes one unit (its own "packed" tick) plus one unit
  // per equipment item, so a subject with no items is still 1 thing to pack.
  const allUnits = useMemo(
    () => person.subjects.flatMap((s) => [{ checked: !!s.checked }, ...s.items]),
    [person.subjects]
  );
  const total = allUnits.length;
  const packed = allUnits.filter((u) => u.checked).length;
  const progress = total > 0 ? packed / total : 0;
  const allDone = total > 0 && packed === total;

  const handleToggle = useCallback(
    (itemKey, checked) => {
      if (checked && total > 0 && packed + 1 === total) setCelebrating(true);
      onToggleItem(person.personId, itemKey, checked);
    },
    [onToggleItem, person.personId, packed, total]
  );

  const progressText = allDone
    ? t.school.allPacked
    : t.school.packedProgress.replace('{packed}', packed).replace('{total}', total);

  return (
    <div
      ref={columnRef}
      className="relative flex flex-col rounded-2xl border border-[var(--bd)] bg-[var(--surf)] overflow-hidden"
      style={{ minWidth: 220, flex: '1 1 0%' }}
    >
      {celebrating && (
        <CelebrationAnimation
          personName={person.name}
          personColor={person.color}
          columnRef={columnRef}
          onComplete={() => setCelebrating(false)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col items-center gap-2 pt-5 pb-3 px-4">
        <div
          className="w-[68px] h-[68px] rounded-full flex items-center justify-center overflow-hidden text-white text-2xl font-bold"
          style={{ backgroundColor: person.color }}
        >
          {avatar ? (
            <img src={avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            person.name.charAt(0)
          )}
        </div>
        <span className="text-base font-bold text-[var(--tp)]">{person.name}</span>
        {total > 0 && (
          <span className={`text-xs font-medium ${allDone ? 'text-[var(--acc2)]' : 'text-[var(--ts)]'}`}>
            {allDone ? `✅ ${progressText}` : progressText}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mx-4 mb-3 h-[6px] rounded-full bg-[var(--s2)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-[var(--dur-slow)] ease-out"
          style={{ width: `${progress * 100}%`, backgroundColor: person.color }}
        />
      </div>

      {/* Subjects */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-3">
        {person.subjects.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-[var(--tm)]">
            {t.school.noSchoolToday}
          </div>
        )}
        {person.subjects.map((sub, idx) => (
          <section key={`${sub.subject}-${idx}`} className="flex flex-col gap-2">
            <SubjectHeader
              subject={sub}
              personColor={person.color}
              onToggle={handleToggle}
            />
            {sub.items.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--tm)]">{t.school.noItems}</div>
            ) : (
              sub.items.map((item) => (
                <ItemRow
                  key={item.itemKey}
                  item={item}
                  personColor={person.color}
                  onToggle={handleToggle}
                />
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── SchoolPage ────────────────────────────────────────────────────────────

export default function SchoolPage() {
  const { today, schedule, people, loading, error, toggleItem } = useSchool();

  const avatarById = useMemo(
    () => Object.fromEntries(people.map((p) => [String(p.id), p.avatar])),
    [people]
  );

  // Only show children who actually have a weekly schedule configured
  // somewhere (any day) — a person with none attached has nothing to show
  // here and just clutters the row with an empty column.
  const hasScheduleConfigured = useCallback(
    (personId) =>
      Object.values(schedule[personId] || {}).some((subjects) => subjects.length > 0),
    [schedule]
  );

  const todayPeople = (today?.people || []).filter((p) => hasScheduleConfigured(p.personId));
  const dayName = t.topBar.daysLong[new Date().getDay()];

  if (loading) return <TasksSkeleton />;

  if (error && todayPeople.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-lg text-[var(--ts)] mb-2">{t.errors.noConnection}</p>
          <p className="text-sm text-[var(--tm)]">{error}</p>
        </div>
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-5xl mb-3">🎒</p>
          <p className="text-lg text-[var(--ts)]">{t.school.noPeople}</p>
          <p className="text-sm text-[var(--tm)] mt-1">{t.errors.configureInSettings}</p>
        </div>
      </div>
    );
  }

  // People exist, but none of them (or none scheduled for today) have any
  // subjects configured — same empty state either way.
  const nothingScheduled = todayPeople.length === 0 || todayPeople.every((p) => p.subjects.length === 0);

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-lg font-bold text-[var(--tp)]">{t.school.title}</h2>
        <span className="text-sm font-medium text-[var(--ts)]">{dayName}</span>
      </div>

      {nothingScheduled ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-5xl mb-3">🎒</p>
            <p className="text-lg text-[var(--ts)]">{t.school.noSchoolToday}</p>
            <p className="text-sm text-[var(--tm)] mt-1">{t.school.noSchedule}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex gap-4 overflow-x-auto pb-1" style={{ minHeight: 0 }}>
          {todayPeople.map((person) => (
            <PersonColumn
              key={person.personId}
              person={person}
              avatar={avatarById[String(person.personId)]}
              onToggleItem={toggleItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
