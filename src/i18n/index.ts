import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ar from './locales/ar.json'

const savedLang = localStorage.getItem('lang') ?? 'en'

function applyDocumentDirection(lng: string) {
  const dir = lng === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.lang = lng
  document.documentElement.dir = dir
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

applyDocumentDirection(savedLang)

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('lang', lng)
  applyDocumentDirection(lng)
})

export default i18n
