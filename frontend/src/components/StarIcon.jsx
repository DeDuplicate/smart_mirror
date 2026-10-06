// The star used for the weekly chore stars. Drawn rather than an emoji so it is the
// same on every system and takes the theme's gold. `crossed` marks a star a
// parent took back.
export default function StarIcon({ filled = false, crossed = false, className = 'w-6 h-6' }) {
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
      style={{ opacity: filled ? 1 : 0.4 }}
    >
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9L12 2.5z" />
      {crossed && <path d="M4 4l16 16" stroke="var(--coral-d)" strokeWidth="2.2" />}
    </svg>
  );
}
