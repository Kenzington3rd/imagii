import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
// T-126 (18): Inter, bundled (DESIGN_GUIDE: "Inter, with system-ui fallbacks"; BRANDING: the wordmark is Inter Semibold). The three
// weights the guide names, latin only, from the installed package - electron-vite emits the font files beside the page and the
// stylesheet points at them, so the app draws Inter on a machine that has never had it and asks nobody for it (local-first).
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
