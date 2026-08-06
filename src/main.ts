import { mount } from 'svelte'
import { installGlobalHoverTooltips } from '@xproeditor/svelte'
import App from './App.svelte'
import { applyPhoneUiAttr, watchPhoneUi } from './lib/phoneUi'
import { initTheme } from './theme'

initTheme()
// Before first paint of interactive UI: iPhone WebXDC often needs UA-based phone mode.
applyPhoneUiAttr()
watchPhoneUi(() => {})

// Load after editor styles so theme tokens override package defaults.
// Shabnam is loaded from public/ via index.html (not importable as a module).
import './style.css'

mount(App, { target: document.getElementById('app')! })

// Delayed (1s) hover tips for buttons app-wide (title / aria-label / data-tooltip).
installGlobalHoverTooltips({ delay: 1000 })
