import { useTranslation } from 'react-i18next'

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
  { code: 'ar', label: 'AR' },
] as const

function activeLang(current: string, code: string): boolean {
  return current === code || current.startsWith(`${code}-`)
}

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation()

  return (
    <div className={`inline-flex gap-0.5 rounded-lg border border-[#ECECEC] bg-[#FAFAFA] p-0.5 ${className}`}>
      {LANGS.map(({ code, label }) => {
        const active = activeLang(i18n.language, code)
        return (
          <button
            key={code}
            type="button"
            onClick={() => void i18n.changeLanguage(code)}
            className={`min-w-[2.25rem] rounded-md px-2 py-1 text-xs font-semibold transition ${
              active ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-gray-500 hover:text-[#1A1A1A]'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
