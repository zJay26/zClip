/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: { base: token('app-bg'), canvas: token('canvas-bg'), elevated: token('workspace-bg') },
        panel: { DEFAULT: token('panel-bg'), muted: token('panel-muted'), hover: token('panel-hover') },
        border: { DEFAULT: token('border'), subtle: token('border-subtle'), strong: token('border-strong') },
        surface: { DEFAULT: token('workspace-bg'), light: token('panel-bg'), lighter: token('panel-hover'), border: token('border') },
        accent: { DEFAULT: token('accent'), hover: token('accent-hover'), dim: token('accent'), soft: token('accent-soft') },
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        timeline: { video: token('timeline-video'), audio: token('timeline-audio') },
        text: { primary: token('text-primary'), secondary: token('text-secondary'), muted: token('text-muted') }
      },
      borderRadius: { xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)' },
      boxShadow: { panel: 'var(--shadow-panel)', focus: 'var(--shadow-focus)', floating: 'var(--shadow-floating)', accent: '0 7px 18px rgb(var(--accent) / 0.18)' },
      transitionDuration: { instant: 'var(--duration-instant)', fast: 'var(--duration-fast)', base: 'var(--duration-base)', slow: 'var(--duration-slow)' },
      fontFamily: {
        sans: ['Segoe UI Variable Text', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
