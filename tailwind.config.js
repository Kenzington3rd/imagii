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
          dim: '#5d5d6e'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
}
