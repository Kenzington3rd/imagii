import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
// Inter is bundled (T-126 (18)); its three @font-face rules, woff2 only (T-128 (2)), are the top of styles/index.css.
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
