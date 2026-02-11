import { useEffect } from 'react'

/**
 * Lightweight runtime diagnostics for UI responsiveness.
 * Only active in development mode.
 */
export function useUiPerformance(): void {
  useEffect(() => {
    if (!import.meta.env.DEV || typeof PerformanceObserver === 'undefined') return

    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      entries.forEach((entry) => {
        if (entry.entryType === 'longtask' && entry.duration > 80) {
          console.warn('[ui-perf] Long task detected:', {
            name: entry.name,
            duration: Math.round(entry.duration)
          })
        }
      })
    })

    try {
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      // Some environments may not support longtask observer.
    }

    return () => observer.disconnect()
  }, [])
}
