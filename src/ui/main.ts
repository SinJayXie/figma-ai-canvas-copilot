import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initTheme } from './composables/useTheme'
import './styles/index.css'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
initTheme()
