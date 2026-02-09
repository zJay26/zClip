/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1a1a2e',
          light: '#222240',
          lighter: '#2a2a4a',
          border: '#3a3a5c'
        },
        accent: {
          DEFAULT: '#6c63ff',
          hover: '#7b73ff',
          dim: '#4a4580'
        },
        text: {
          primary: '#e8e8f0',
          secondary: '#a0a0b8',
          muted: '#6a6a80'
        }
      },
      fontFamily: {
        sans: ['Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
