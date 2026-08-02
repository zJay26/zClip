import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react'

export type AppTheme = 'dark' | 'light'
export type AppLanguage = 'zh-CN' | 'en'

interface StoredPreferences {
  theme: AppTheme
  language: AppLanguage
}

interface PreferencesContextValue extends StoredPreferences {
  toggleTheme: () => void
  toggleLanguage: () => void
  t: (chinese: string, english: string) => string
}

const STORAGE_KEY = 'zclip.ui.preferences.v1'
const DEFAULT_PREFERENCES: StoredPreferences = {
  theme: 'dark',
  language: 'zh-CN'
}

let activeLanguage: AppLanguage = DEFAULT_PREFERENCES.language

function readPreferences(): StoredPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<StoredPreferences>
    return {
      theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : DEFAULT_PREFERENCES.theme,
      language: value.language === 'en' || value.language === 'zh-CN'
        ? value.language
        : DEFAULT_PREFERENCES.language
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function translate(chinese: string, english: string): string {
  return activeLanguage === 'en' ? english : chinese
}

const PreferencesContext = createContext<PreferencesContextValue>({
  ...DEFAULT_PREFERENCES,
  toggleTheme: () => {},
  toggleLanguage: () => {},
  t: (chinese) => chinese
})

export const PreferencesProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [preferences, setPreferences] = useState<StoredPreferences>(readPreferences)
  activeLanguage = preferences.language

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = preferences.theme
    root.classList.toggle('dark', preferences.theme === 'dark')
    root.style.colorScheme = preferences.theme
    root.lang = preferences.language
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      // Preference persistence is best-effort; the controls should still work.
    }
  }, [preferences])

  const toggleTheme = useCallback(() => {
    setPreferences((current) => ({
      ...current,
      theme: current.theme === 'dark' ? 'light' : 'dark'
    }))
  }, [])

  const toggleLanguage = useCallback(() => {
    setPreferences((current) => ({
      ...current,
      language: current.language === 'zh-CN' ? 'en' : 'zh-CN'
    }))
  }, [])

  const t = useCallback(
    (chinese: string, english: string) => preferences.language === 'en' ? english : chinese,
    [preferences.language]
  )

  const value = useMemo<PreferencesContextValue>(() => ({
    ...preferences,
    toggleTheme,
    toggleLanguage,
    t
  }), [preferences, t, toggleLanguage, toggleTheme])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext)
}
