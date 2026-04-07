/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f4f5f7',
        surf: '#ffffff',
        s2: '#f0f1f5',
        bd: '#e8e9f0',
        tp: '#1a1c2e',
        ts: '#7b7f9e',
        tm: '#b0b4cc',
        acc: '#6b62e0',
        acc2: '#2ab58a',
        mint: '#b8ede0',
        'mint-d': '#2a9d7f',
        lav: '#d4cfff',
        'lav-d': '#5b52cc',
        coral: '#ffc8c8',
        'coral-d': '#c95454',
        gold: '#ffe4a0',
        'gold-d': '#b07c10',
      },
      fontFamily: {
        heebo: ['Heebo', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
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
      },
    },
  },
  plugins: [],
};
