import { createApp, h } from 'vue'
import { installUI, UIModalProvider } from '@devline/ui-web'
import { createI18n } from 'vue-i18n'
import App from './components/StudioEditor.vue'
import Settings from './components/StudioSettings.vue'
import en from './locales/en.json'
import ru from './locales/ru.json'
import { sdk } from './sdk'
import '@devline/ui-web/style.css'
import './styles/studio.scss'

void sdk.ready.then(() => {
  const context = sdk.getContext()
  const app = createApp({ render: () => h(UIModalProvider, () => h(context.view?.location === 'settings' ? Settings : App)) })
  installUI(app)
  app.use(createI18n({ legacy: false, locale: context.locale.startsWith('ru') ? 'ru' : 'en', fallbackLocale: 'en', messages: { en, ru } }))
  app.mount('#app')
})
