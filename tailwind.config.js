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
          DEFAULT: '#f2664b',
          muted: '#d94f35'
        },
        ink: {
          base: '#ece4e2',
          muted: '#a59a97',
          // Contrast note (carries the round-15 B9 lesson forward): dim
          // text must clear WCAG AA 4.5:1 on BOTH bg-base and bg-elevated.
          // #9c8f8b measures ~6.2:1 on #120c0c and ~5.8:1 on #1c1313.
          dim: '#9c8f8b'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
}
