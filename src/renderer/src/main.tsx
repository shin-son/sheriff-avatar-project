import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

if (window.svp.frameless) document.body.classList.add('frameless')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
