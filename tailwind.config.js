/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#111124',
          canvas: '#14142a',
          elevated: '#1d1d37'
        },
        panel: {
          DEFAULT: '#1f1f3a',
          muted: '#1a1a30',
          hover: '#29294a'
        },
        border: {
          DEFAULT: '#3a3a5c',
          subtle: '#2f2f4a',
          strong: '#4b4b70'
        },
        surface: {
          DEFAULT: '#1a1a2e',
          light: '#222240',
          lighter: '#2a2a4a',
          border: '#3a3a5c'
        },
        accent: {
          DEFAULT: '#6c63ff',
          hover: '#7b73ff',
          dim: '#4a4580',
          soft: '#857dff'
        },
        success: '#34d399',
        warning: '#f59e0b',
        danger: '#ef4444',
        text: {
          primary: '#e8e8f0',
          secondary: '#a0a0b8',
          muted: '#6a6a80'
        }
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '10px',
        lg: '14px'
      },
      boxShadow: {
        panel: '0 8px 24px rgba(8, 8, 24, 0.22)',
        focus: '0 0 0 2px rgba(108, 99, 255, 0.35)',
        accent: '0 0px 0px rgba(108, 99, 255, 0.24)'
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '260ms'
      },
      fontFamily: {
        sans: ['Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
