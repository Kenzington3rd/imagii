/** @type {import('tailwindcss').Config} */
// Round 19: obsidian-volcano palette. These values MIRROR
// src/renderer/src/styles/tokens.ts (this file can't import TS);
// tests/unit/designTokensInSync.test.ts fails the build if they drift.
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#120c0c',
          elevated: '#1c1313',
          hover: '#2a1a18'
        },
        accent: {
          DEFAULT: '#ff3131',
          muted: '#f52e2e'
        },
        ink: {
          base: '#ece4e2',
          muted: '#a59a97',
          // Contrast note (carries the round-15 B9 lesson forward): dim
          // text must clear WCAG AA 4.5:1 on BOTH bg-base and bg-elevated.
          // #9c8f8b measures ~6.2:1 on #120c0c and ~5.8:1 on #1c1313.
          dim: '#9c8f8b'
        },
        // T-56: the ember highlight was JS-only (tokens.ts EMBER) because the
        // only thing that needed it — wavesurfer's cursor — is a JS context.
        // The Video Timeline's playhead is the same mark in a className
        // context, so the token now exists in both files like the rest.
        // 9.99:1 on bg-hover, 7.35:1 on the accent/25 clip-range fill.
        ember: '#fbbf24',
        // T-71: the semantic tier. Values are the raw rose/amber/emerald
        // palette classes these replace, so the migration is a rename and
        // not a redesign. DEFAULT = the readable text tone; `strong` = the
        // saturated mark tone (bars, dots, borders, /NN washes). `soft` is
        // danger-only: the hover brighten on ghost-button labels.
        //
        // No `warn.strong` on purpose — amber-400 IS `ember` to the byte, so
        // every amber-400 surface moved onto the existing token rather than
        // minting a second name for one color.
        danger: {
          DEFAULT: '#fda4af', // 9.64:1 on bg-elevated, 6.97:1 on a danger-strong/20 wash
          soft: '#fecdd3', // 12.92:1 on bg-elevated
          strong: '#fb7185' // 7.20:1 on bg-base; bg-base text ON it is 7.20:1
        },
        warn: '#fcd34d', // 12.64:1 on bg-elevated, 10.4:1 on an ember/10 wash
        ok: {
          DEFAULT: '#6ee7b7', // 11.96:1 on bg-elevated, 8.16:1 on an ok-strong/20 wash
          strong: '#34d399' // 10.08:1 on bg-base
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
}
