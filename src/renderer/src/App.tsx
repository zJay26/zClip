import React from 'react'
import { MotionConfig } from 'motion/react'
import AppLayout from './components/Layout/AppLayout'
import { PreferencesProvider } from './contexts/preferences'
import { useUiPerformance } from './hooks/useUiPerformance'

const App: React.FC = () => {
  useUiPerformance()
  return (
    <PreferencesProvider>
      <MotionConfig reducedMotion="user" transition={{ type: 'spring', bounce: 0, duration: 0.34 }}>
        <AppLayout />
      </MotionConfig>
    </PreferencesProvider>
  )
}

export default App
