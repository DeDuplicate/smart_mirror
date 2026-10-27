// The star used for the weekly chore stars. Drawn rather than an emoji so it is the
// same on every system and takes the theme's gold. `crossed` marks a star a
// parent took back; `plus` marks an empty one a parent can add.
export default function StarIcon({ filled = false, crossed = false, plus = false, className = 'w-6 h-6' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill={filled ? 'var(--amber)' : 'none'}
      stroke={filled ? 'var(--amber)' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path
        d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9L12 2.5z"
        opacity={filled ? 1 : plus ? 0.55 : 0.4}
      />
      {plus && <path d="M12 8.6v6.4M8.8 11.8h6.4" stroke="var(--acc)" strokeWidth="2.4" />}
      {crossed && <path d="M4 4l16 16" stroke="var(--coral-d)" strokeWidth="2.2" />}
    </svg>
  );
}
