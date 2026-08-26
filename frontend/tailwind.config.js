/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Colors resolve through CSS vars (channels) so they respond to
      // [data-theme="dark"]. The `rgb(var(--x-rgb) / <alpha-value>)` form
      // keeps `/opacity` modifiers working (e.g. bg-tp/50) — plain var()
      // colors silently emit no rule when an opacity modifier is used.
      colors: {
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surf: 'rgb(var(--surf-rgb) / <alpha-value>)',
        s2: 'rgb(var(--s2-rgb) / <alpha-value>)',
        bd: 'rgb(var(--bd-rgb) / <alpha-value>)',
        tp: 'rgb(var(--tp-rgb) / <alpha-value>)',
        ts: 'rgb(var(--ts-rgb) / <alpha-value>)',
        tm: 'rgb(var(--tm-rgb) / <alpha-value>)',
        acc: 'rgb(var(--acc-rgb) / <alpha-value>)',
        acc2: 'rgb(var(--acc2-rgb) / <alpha-value>)',
        mint: 'rgb(var(--mint-bg-rgb) / <alpha-value>)',
        'mint-d': 'rgb(var(--mint-d-rgb) / <alpha-value>)',
        lav: 'rgb(var(--lav-bg-rgb) / <alpha-value>)',
        'lav-d': 'rgb(var(--lav-d-rgb) / <alpha-value>)',
        coral: 'rgb(var(--coral-bg-rgb) / <alpha-value>)',
        'coral-d': 'rgb(var(--coral-d-rgb) / <alpha-value>)',
        gold: 'rgb(var(--gold-bg-rgb) / <alpha-value>)',
        'gold-d': 'rgb(var(--gold-d-rgb) / <alpha-value>)',
      },
      fontFamily: {
        heebo: ['Heebo', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      // Semantic elevation scale — see "rule 4" in styles/global.css.
      // Named for meaning, not size, so `hover:shadow-raised` etc. work.
      // Prefer these over shadow-sm/md/lg/xl/2xl everywhere.
      boxShadow: {
        card: 'var(--elev-card)',
        raised: 'var(--elev-raised)',
        popover: 'var(--elev-popover)',
        modal: 'var(--elev-modal)',
      },
      animation: {
        'fade-in': 'fadeIn var(--dur-normal) var(--ease) forwards',
        'fade-out': 'fadeOut var(--dur-normal) var(--ease) forwards',
        'slide-in-right': 'slideInRight var(--dur-normal) var(--ease) forwards',
        'slide-in-left': 'slideInLeft var(--dur-normal) var(--ease) forwards',
        'slide-out-right': 'slideOutRight var(--dur-normal) var(--ease) forwards',
        'slide-out-left': 'slideOutLeft var(--dur-normal) var(--ease) forwards',
        ripple: 'ripple var(--dur-slow) var(--ease-out) forwards',
        shimmer: 'shimmer 1.5s infinite linear',
        'toast-in': 'toastIn var(--dur-normal) var(--ease-out) forwards',
        'toast-out': 'toastOut var(--dur-fast) var(--ease-in) forwards',
        'banner-slide-down': 'bannerSlideDown var(--dur-normal) var(--ease-out) forwards',
        'banner-slide-up': 'bannerSlideUp var(--dur-fast) var(--ease) forwards',
        spin: 'spin 0.8s linear infinite',
        'popup-in': 'popupIn var(--dur-normal) var(--ease-out) forwards',
        'scene-pulse': 'scenePulse 600ms var(--ease-out) forwards',
        'task-checkbox-pop': 'taskCheckboxPop 400ms var(--ease) forwards',
        'avatar-glow': 'avatarPulseGlow 2s ease-in-out infinite',
        'ring-pulse': 'ringPulse 1.5s ease-in-out infinite',
        'sheet-slide-up': 'sheetSlideUp 300ms var(--ease-out) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(40px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-40px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideOutRight: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(40px)', opacity: '0' },
        },
        slideOutLeft: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(-40px)', opacity: '0' },
        },
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '0.5' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        toastIn: {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        toastOut: {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(-100%)', opacity: '0' },
        },
        bannerSlideDown: {
          '0%': { maxHeight: '0', opacity: '0', transform: 'translateY(-8px)' },
          '100%': { maxHeight: '120px', opacity: '1', transform: 'translateY(0)' },
        },
        bannerSlideUp: {
          '0%': { maxHeight: '120px', opacity: '1', transform: 'translateY(0)' },
          '100%': { maxHeight: '0', opacity: '0', transform: 'translateY(-8px)' },
        },
        spin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        popupIn: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        scenePulse: {
          '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(42,181,138,0.4)' },
          '50%': { transform: 'scale(1.03)', boxShadow: '0 0 0 8px rgba(42,181,138,0)' },
          '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(42,181,138,0)' },
        },
      },
    },
  },
  plugins: [],
};
