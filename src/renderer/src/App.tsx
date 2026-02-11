import React from 'react'
import AppLayout from './components/Layout/AppLayout'
import { useUiPerformance } from './hooks/useUiPerformance'

const App: React.FC = () => {
  useUiPerformance()
  return <AppLayout />
}

export default App
