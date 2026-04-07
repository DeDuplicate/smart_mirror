/**
 * SplashScreen — Full-screen loading indicator shown while React.lazy
 * chunks are being fetched. Uses the project's design-system CSS vars
 * and the mirror SVG icon from favicon.svg.
 */
export default function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-bg"
      style={{ fontFamily: "'Heebo', sans-serif" }}
    >
      {/* Mirror icon */}
      <div className="mb-6 animate-pulse">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          className="w-20 h-20"
        >
          {/* Mirror frame */}
          <rect x="1" y="1" width="30" height="30" rx="5" ry="5" fill="var(--acc)" />
          {/* Mirror glass */}
          <rect x="4" y="4" width="24" height="24" rx="3" ry="3" fill="#1a1830" />
          {/* Clock circle */}
          <circle cx="16" cy="15" r="8" fill="none" stroke="var(--acc)" strokeWidth="1.5" />
          <circle cx="16" cy="15" r="6.5" fill="#221f3d" />
          {/* Clock hands */}
          <line x1="16" y1="15" x2="13.5" y2="12.5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="16" y1="15" x2="18.5" y2="12" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
          <circle cx="16" cy="15" r="1" fill="var(--acc)" />
          {/* Status bar */}
          <rect x="6" y="25" width="20" height="2" rx="1" fill="var(--acc)" opacity="0.8" />
        </svg>
      </div>

      {/* Title */}
      <h1
        className="text-2xl font-bold text-tp mb-4 tracking-wide"
        style={{ letterSpacing: '0.05em' }}
      >
        Smart Mirror
      </h1>

      {/* Spinner */}
      <svg
        className="w-8 h-8 animate-spin text-acc"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="31.4 31.4"
          strokeLinecap="round"
          opacity="0.3"
        />
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="15.7 47.1"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
