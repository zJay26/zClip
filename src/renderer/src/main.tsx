import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

if (import.meta.env.DEV) {
  void import('@axe-core/react')
    .then(({ default: axe }) => {
      axe(React, ReactDOM, 1000)
    })
    .catch(() => {
      // Ignore diagnostics bootstrap failures in dev.
    })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
