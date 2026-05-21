/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0b0b0f',
          elevated: '#16161e',
          hover: '#20202c'
        },
        accent: {
          DEFAULT: '#a78bfa',
          muted: '#7c5cf0'
        },
        ink: {
          base: '#e5e5ee',
          muted: '#9595a5',
          // B9 fix (round 15): #5d5d6e on #0b0b0f measures ~3.04:1, below WCAG
          // AA's 4.5:1 minimum for body text. #8b8b9c hits ~6.6:1 (verified
          // in https://webaim.org/resources/contrastchecker/ — 0b0b0f vs
          // 8b8b9c). The token still reads as "dim/secondary" against the
          // brighter ink.base #e5e5ee.
          dim: '#8b8b9c'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
}
