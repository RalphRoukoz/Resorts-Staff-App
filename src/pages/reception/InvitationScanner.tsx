import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Html5Qrcode } from 'html5-qrcode'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { formatDate, formatDateTime } from '../../lib/dates'
import { playError, playSuccess, primeAudio } from '../../lib/sound'
import { scanOrValidate } from '../../lib/scanInvitation'
import { extractInvitationToken } from '../../lib/token'
import type { ScanCheckpoint, ValidateResult } from '../../types/database'

type ScannerPhase = 'scanning' | 'result'

interface InvitationScannerProps {
  checkpoint: ScanCheckpoint
}

export function InvitationScanner({ checkpoint }: InvitationScannerProps) {
  const { t } = useTranslation()
  const { signOut, hasDashboard, setView } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<ScannerPhase>('scanning')
  const [result, setResult] = useState<ValidateResult | null>(null)
  const [processing, setProcessing] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const processingRef = useRef(false)

  const title = checkpoint === 'reception' ? t('scanner.reception') : t('scanner.gate')
  const otherPath = checkpoint === 'reception' ? '/scanner/gate' : '/scanner'
  const otherLabel = checkpoint === 'reception' ? t('scanner.gate') : t('scanner.reception')

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      if (scanner.isScanning) await scanner.stop()
      scanner.clear()
    } catch {
      // already stopped
    }
    scannerRef.current = null
  }, [])

  const handleScan = useCallback(
    async (decodedText: string) => {
      if (processingRef.current) return
      processingRef.current = true
      setProcessing(true)
      await stopScanner()

      const token = extractInvitationToken(decodedText)
      const finalResult = await scanOrValidate(token, checkpoint)

      if (finalResult.ok) playSuccess()
      else playError()

      setResult(finalResult)
      setPhase('result')
      setProcessing(false)
      processingRef.current = false
    },
    [checkpoint, stopScanner],
  )

  const startScanner = useCallback(async () => {
    setCameraError(null)
    setResult(null)
    setPhase('scanning')
    processingRef.current = false
    primeAudio()
    await stopScanner()

    const scanner = new Html5Qrcode('qr-reader')
    scannerRef.current = scanner

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        (decodedText) => void handleScan(decodedText),
        () => {},
      )
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Camera unavailable. HTTPS is required for scanning.')
    }
  }, [handleScan, stopScanner])

  useEffect(() => {
    void startScanner()
    return () => {
      void stopScanner()
    }
  }, [startScanner, stopScanner])

  function scanNext() {
    primeAudio()
    void startScanner()
  }

  function backToAdmin() {
    setView('admin')
    navigate('/admin/units')
  }

  if (phase === 'result' && result) {
    return (
      <div className={`flex min-h-screen flex-col ${result.ok ? 'bg-emerald-600' : 'bg-rose-700'}`}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center text-white">
          {result.ok ? (
            <>
              <div className="mb-6 text-7xl">✓</div>
              <h1 className="text-3xl font-bold">{t('scanner.valid')}</h1>
              {result.next_checkpoint ? (
                <p className="mt-4 text-lg opacity-90">
                  {checkpoint === 'reception' ? t('scanner.gate') : ''}
                </p>
              ) : null}
              <div className="mt-8 space-y-3 text-xl">
                <p>{result.invitee}</p>
                <p className="font-semibold">{result.chalet}</p>
                <p>{result.resort}</p>
                <p>{formatDate(result.visit_date)}</p>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6 text-7xl">✕</div>
              <h1 className="text-3xl font-bold">{t('scanner.invalid')}</h1>
              <div className="mt-8 space-y-3 text-lg">
                <FailureMessage result={result} t={t} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-3 p-4 pb-8">
          <Button
            fullWidth
            className="!bg-white !py-4 !text-lg !font-bold !text-[#1A1A1A] hover:!bg-gray-100"
            onClick={scanNext}
          >
            {t('scanner.scanNext')}
          </Button>
          {hasDashboard ? (
            <Button fullWidth variant="ghost" className="!text-white hover:!bg-white/10" onClick={backToAdmin}>
              {t('common.backToDashboard')}
            </Button>
          ) : (
            <Button fullWidth variant="ghost" className="!text-white hover:!bg-white/10" onClick={() => void signOut()}>
              {t('common.signOut')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFA]">
      <header className="flex items-center justify-between border-b border-[#ECECEC] bg-white px-4 py-3">
        <p className="text-sm font-semibold text-[#1A1A1A]">{title}</p>
        <div className="flex items-center gap-3">
          <Link
            to={otherPath}
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-[#1A1A1A]"
          >
            {otherLabel}
          </Link>
          {hasDashboard ? (
            <button type="button" onClick={backToAdmin} className="text-sm text-gray-500 hover:text-[#1A1A1A]">
              {t('common.dashboard')}
            </button>
          ) : (
            <button type="button" onClick={() => void signOut()} className="text-sm text-gray-500 hover:text-[#1A1A1A]">
              {t('common.signOut')}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8 pt-6">
        {processing ? (
          <p className="mb-4 text-lg font-medium text-[#1A1A1A]">{t('scanner.validating')}</p>
        ) : (
          <p className="mb-4 text-center text-gray-500">{t('scanner.pointCamera')}</p>
        )}
        <div id="qr-reader" className="w-full max-w-md overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm" />
        {cameraError ? <p className="mt-4 max-w-md text-center text-sm text-red-600">{cameraError}</p> : null}
      </div>
    </div>
  )
}

function FailureMessage({
  result,
  t,
}: {
  result: Extract<ValidateResult, { ok: false }>
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  switch (result.reason) {
    case 'ALREADY_USED':
      return (
        <>
          <p className="text-2xl font-semibold">{t('scanner.alreadyUsed')}</p>
          {result.validated_at ? <p>{t('scanner.validatedAt', { date: formatDateTime(result.validated_at) })}</p> : null}
          {result.invitee ? <p>{result.invitee}</p> : null}
          {result.chalet ? <p>{result.chalet}</p> : null}
        </>
      )
    case 'WRONG_DATE':
      return (
        <>
          <p className="text-2xl font-semibold">{t('scanner.wrongDate')}</p>
          {result.valid_for ? <p>{t('scanner.validFor', { date: formatDate(result.valid_for) })}</p> : null}
          {result.invitee ? <p>{result.invitee}</p> : null}
          {result.chalet ? <p>{result.chalet}</p> : null}
        </>
      )
    case 'NOT_FOUND':
      return <p className="text-2xl font-semibold">{t('scanner.invalidCode')}</p>
    case 'NOT_AUTHORIZED':
      return <p className="text-2xl font-semibold">{t('scanner.notAuthorized')}</p>
    case 'RECEPTION_REQUIRED_FIRST':
      return <p className="text-2xl font-semibold">{t('scanner.receptionRequired')}</p>
    case 'PAYMENT_REQUIRED':
      return <p className="text-2xl font-semibold">{t('scanner.paymentRequired')}</p>
    default:
      return (
        <>
          <p className="text-2xl font-semibold">{result.reason}</p>
          {result.invitee ? <p>{result.invitee}</p> : null}
          {result.chalet ? <p>{result.chalet}</p> : null}
        </>
      )
  }
}
