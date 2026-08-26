// ─── Skeleton Building Blocks ───────────────────────────────────────────────

/**
 * A single shimmer rectangle. Uses the global .skeleton class for the
 * shimmer animation defined in global.css.
 */
export function SkeletonBlock({
  width = '100%',
  height = '20px',
  borderRadius = '8px',
  className = '',
}) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
}

// ─── Calendar Skeleton ──────────────────────────────────────────────────────

export function CalendarSkeleton() {
  return (
    <div className="flex flex-col h-full p-6 gap-4">
      {/* Week navigation bar */}
      <div className="flex items-center gap-4">
        <SkeletonBlock width="40px" height="40px" borderRadius="12px" />
        <SkeletonBlock width="120px" height="32px" borderRadius="8px" />
        <SkeletonBlock width="40px" height="40px" borderRadius="12px" />
        <div className="flex-1" />
        <SkeletonBlock width="80px" height="36px" borderRadius="12px" />
      </div>

      {/* 5-column grid with 3 event blocks each */}
      <div className="flex-1 grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="flex flex-col gap-3">
            {/* Day header */}
            <SkeletonBlock width="60%" height="24px" borderRadius="6px" />
            {/* Event blocks */}
            {Array.from({ length: 3 }).map((_, row) => (
              <SkeletonBlock
                key={row}
                width="100%"
                height={`${60 + Math.random() * 40}px`}
                borderRadius="12px"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Month Grid Skeleton ────────────────────────────────────────────────────

export function MonthGridSkeleton() {
  return (
    <div className="flex flex-col h-full p-6 gap-4">
      {/* Navigation bar */}
      <div className="flex items-center gap-4">
        <SkeletonBlock width="40px" height="40px" borderRadius="12px" />
        <SkeletonBlock width="120px" height="32px" borderRadius="8px" />
        <SkeletonBlock width="40px" height="40px" borderRadius="12px" />
        <div className="flex-1" />
        <SkeletonBlock width="160px" height="56px" borderRadius="12px" />
        <SkeletonBlock width="80px" height="36px" borderRadius="12px" />
      </div>

      {/* 7-column month grid, 5 rows of day cells */}
      <div className="flex-1 grid grid-cols-7 grid-rows-5 gap-2">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <SkeletonBlock width="28px" height="28px" borderRadius="50%" />
            <SkeletonBlock width="100%" height="20px" borderRadius="9999px" />
            {i % 3 === 0 && (
              <SkeletonBlock width="100%" height="20px" borderRadius="9999px" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tasks Skeleton ─────────────────────────────────────────────────────────

export function TasksSkeleton() {
  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Top bar skeleton */}
      <div className="flex items-center justify-between px-2">
        <SkeletonBlock width="80px" height="28px" borderRadius="8px" />
        <SkeletonBlock width="140px" height="36px" borderRadius="12px" />
      </div>
      {/* Person columns */}
      <div className="flex-1 flex gap-4">
        {Array.from({ length: 3 }).map((_, col) => (
          <div
            key={col}
            className="flex-1 flex flex-col rounded-2xl border border-[var(--bd)] bg-[var(--surf)] overflow-hidden"
            style={{ minWidth: 220 }}
          >
            {/* Avatar + name */}
            <div className="flex flex-col items-center gap-2 pt-5 pb-3 px-4">
              <SkeletonBlock width="68px" height="68px" borderRadius="50%" />
              <SkeletonBlock width="60px" height="20px" borderRadius="6px" />
              <SkeletonBlock width="100px" height="14px" borderRadius="4px" />
            </div>
            {/* Progress bar */}
            <div className="mx-4 mb-3">
              <SkeletonBlock width="100%" height="6px" borderRadius="3px" />
            </div>
            {/* Task cards */}
            <div className="flex-1 px-3 pb-2 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, row) => (
                <SkeletonBlock
                  key={row}
                  width="100%"
                  height="56px"
                  borderRadius="12px"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Home Skeleton ──────────────────────────────────────────────────────────

export function HomeSkeleton() {
  return (
    <div className="flex flex-col h-full p-6 gap-5">
      {/* Device tiles grid: 5x2 */}
      <div className="flex-1 grid grid-cols-5 grid-rows-2 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonBlock
            key={i}
            width="100%"
            height="100%"
            borderRadius="16px"
          />
        ))}
      </div>
      {/* Scene buttons row */}
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock
            key={i}
            width="100%"
            height="56px"
            borderRadius="12px"
          />
        ))}
      </div>
    </div>
  );
}

// ─── Music Skeleton ─────────────────────────────────────────────────────────

export function MusicSkeleton() {
  return (
    <div className="flex h-full p-6 gap-8">
      {/* Left: album art + controls */}
      <div className="flex flex-col items-center gap-5 w-[360px] shrink-0">
        {/* Album art */}
        <SkeletonBlock width="280px" height="280px" borderRadius="24px" />
        {/* Track info */}
        <SkeletonBlock width="200px" height="24px" borderRadius="6px" />
        <SkeletonBlock width="140px" height="18px" borderRadius="6px" />
        {/* Control circles */}
        <div className="flex items-center gap-5 mt-2">
          <SkeletonBlock width="44px" height="44px" borderRadius="50%" />
          <SkeletonBlock width="56px" height="56px" borderRadius="50%" />
          <SkeletonBlock width="44px" height="44px" borderRadius="50%" />
        </div>
        {/* Volume slider */}
        <SkeletonBlock width="240px" height="8px" borderRadius="4px" className="mt-3" />
      </div>

      {/* Right: queue list */}
      <div className="flex-1 flex flex-col gap-3">
        <SkeletonBlock width="100px" height="28px" borderRadius="8px" />
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBlock
            key={i}
            width="100%"
            height="56px"
            borderRadius="12px"
          />
        ))}
      </div>
    </div>
  );
}

// ─── News Skeleton ──────────────────────────────────────────────────────────

export function NewsSkeleton() {
  // Mirrors the front-page layout exactly — lead, two seconds, timeline rail —
  // so nothing shifts position when the articles arrive.
  return (
    <div className="flex h-full p-6 gap-6">
      {/* Front page */}
      <div className="flex-1 min-w-0 flex flex-col gap-6">
        {/* Lead: banner plate over a wide headline */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-2xl bg-surf border border-bd">
          <SkeletonBlock width="100%" height="100%" borderRadius="0" />
          <div className="shrink-0 flex flex-col gap-3 p-7">
            <SkeletonBlock width="110px" height="36px" borderRadius="9999px" />
            <SkeletonBlock width="78%" height="46px" />
            <SkeletonBlock width="52%" height="46px" />
            <SkeletonBlock width="64%" height="31px" />
            <SkeletonBlock width="220px" height="24px" />
          </div>
        </div>

        {/* Two seconds: portrait plate beside the headline */}
        <div className="h-[280px] shrink-0 flex gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 min-w-0 flex overflow-hidden rounded-2xl bg-surf border border-bd"
            >
              <SkeletonBlock width="220px" height="100%" borderRadius="0" />
              <div className="flex-1 flex flex-col gap-2 p-5">
                <SkeletonBlock width="92px" height="28px" borderRadius="9999px" />
                <SkeletonBlock width="100%" height="30px" />
                <SkeletonBlock width="72%" height="30px" />
                <div className="mt-auto">
                  <SkeletonBlock width="60%" height="22px" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline rail */}
      <div className="w-[620px] shrink-0 flex flex-col overflow-hidden rounded-2xl bg-s2 border border-bd">
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-bd">
          <SkeletonBlock width="140px" height="28px" />
          <SkeletonBlock width="38px" height="28px" borderRadius="9999px" />
          <div className="flex-1" />
          <SkeletonBlock width="56px" height="56px" borderRadius="50%" />
        </div>
        <div className="flex-1 p-3 flex flex-col gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="shrink-0 flex items-center gap-4 min-h-[92px] p-3 rounded-xl bg-surf border border-bd"
            >
              <SkeletonBlock width="62px" height="24px" />
              <SkeletonBlock width="12px" height="12px" borderRadius="50%" />
              <div className="flex-1 flex flex-col gap-2">
                <SkeletonBlock width="100%" height="26px" />
                <SkeletonBlock width="42%" height="20px" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
