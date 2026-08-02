import React from 'react'
import { beforeEach, describe, expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PreferencesProvider, usePreferences } from '@renderer/contexts/preferences'

const PreferenceProbe: React.FC = () => {
  const { language, theme, t, toggleLanguage, toggleTheme } = usePreferences()
  return (
    <div>
      <span>{t('中文界面', 'English interface')}</span>
      <span data-testid="theme">{theme}</span>
      <span data-testid="language">{language}</span>
      <button onClick={toggleTheme}>theme</button>
      <button onClick={toggleLanguage}>language</button>
    </div>
  )
}

describe('interface preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.className = 'dark'
    document.documentElement.lang = 'zh-CN'
  })

  test('switches theme and language and persists both choices', () => {
    const first = render(
      <PreferencesProvider>
        <PreferenceProbe />
      </PreferencesProvider>
    )

    expect(screen.getByText('中文界面')).toBeInTheDocument()
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')

    fireEvent.click(screen.getByRole('button', { name: 'theme' }))
    fireEvent.click(screen.getByRole('button', { name: 'language' }))

    expect(screen.getByText('English interface')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(document.documentElement).not.toHaveClass('dark')

    first.unmount()
    render(
      <PreferencesProvider>
        <PreferenceProbe />
      </PreferencesProvider>
    )

    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(screen.getByTestId('language')).toHaveTextContent('en')
  })
})
