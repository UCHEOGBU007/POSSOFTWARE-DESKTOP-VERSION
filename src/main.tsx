import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

if (
  import.meta.env.PROD &&
  window.location.protocol === 'https:' &&
  'serviceWorker' in navigator
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
