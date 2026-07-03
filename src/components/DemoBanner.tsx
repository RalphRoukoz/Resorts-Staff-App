import { useTranslation } from 'react-i18next'
import { isDemoMode } from '../demo/demoData'

export function DemoBanner() {
  const { t } = useTranslation()
  if (!isDemoMode()) return null

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900">
      {t('demo.banner')}
    </div>
  )
}
