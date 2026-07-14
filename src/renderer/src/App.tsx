import React from 'react'
import { MotionConfig } from 'motion/react'
import AppLayout from './components/Layout/AppLayout'
import { useUiPerformance } from './hooks/useUiPerformance'

const App: React.FC = () => {
  useUiPerformance()
  return (
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', bounce: 0, duration: 0.34 }}>
      <AppLayout />
    </MotionConfig>
  )
}

export default App
