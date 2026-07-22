import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { formatDate, formatDateTime } from '../../lib/dates'
import { PERMISSIONS } from '../../lib/permissions'
import { playError, playSuccess, primeAudio } from '../../lib/sound'
import { scanOrValidate } from '../../lib/scanInvitation'
import { extractInvitationToken } from '../../lib/token'
import type { ScanCheckpoint, ValidateResult } from '../../types/database'

type ScannerPhase = 'scanning' | 'result'

interface InvitationScannerProps {
  checkpoint: ScanCheckpoint
}

function resultBackground(result: ValidateResult): string {
  if (!result.ok) {
    if (result.reason === 'RECEPTION_REQUIRED_FIRST') return 'bg-orange-500'
    return 'bg-rose-700'
  }
  // Dual-scan first checkpoint (reception) → yellow; final validation → green
  if (result.next_checkpoint || result.final === false) return 'bg-amber-400'
  return 'bg-emerald-600'
}

function resultTextClass(result: ValidateResult): string {
  if (result.ok && (result.next_checkpoint || result.final === false)) {
    return 'text-[#1A1A1A]'
  }
  return 'text-white'
}

export function InvitationScanner({ checkpoint }: InvitationScannerProps) {
  const { t } = useTranslation()
  const { signOut, hasDashboard, hasPermission, setView } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<ScannerPhase>('scanning')
  const [result, setResult] = useState<ValidateResult | null>(null)
  const [processing, setProcessing] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const processingRef = useRef(false)

  const canReception = hasPermission(PERMISSIONS.SCANNER_RECEPTION)
  const canGate = hasPermission(PERMISSIONS.SCANNER_GATE)
  const title = checkpoint === 'reception' ? t('scanner.reception') : t('scanner.gate')
  const otherPath = checkpoint === 'reception' ? '/scanner/gate' : '/scanner'
  const otherLabel = checkpoint === 'reception' ? t('scanner.gate') : t('scanner.reception')
  const canSwitchCheckpoint =
    checkpoint === 'reception' ? canGate : canReception

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
      if (!token) {
        setResult({ ok: false, reason: 'EMPTY_TOKEN' })
        setPhase('result')
        setProcessing(false)
        processingRef.current = false
        playError()
        return
      }
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

    const scanner = new Html5Qrcode('qr-reader', {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    })
    scannerRef.current = scanner

    try {
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 18,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72)
            return { width: Math.max(180, edge), height: Math.max(180, edge) }
          },
          aspectRatio: 1,
          disableFlip: false,
        },
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
    const bg = resultBackground(result)
    const text = resultTextClass(result)
    const ghostBtn =
      text === 'text-white'
        ? '!text-white hover:!bg-white/10'
        : '!text-[#1A1A1A] hover:!bg-black/5'
    const primaryBtn =
      text === 'text-white'
        ? '!bg-white !py-4 !text-lg !font-bold !text-[#1A1A1A] hover:!bg-gray-100'
        : '!bg-[#1A1A1A] !py-4 !text-lg !font-bold !text-white hover:!bg-black'

    return (
      <div className={`flex min-h-dvh flex-col ${bg}`}>
        <div className={`flex flex-1 flex-col items-center justify-center px-6 py-10 text-center ${text}`}>
          {result.ok ? (
            <>
              <div className="mb-6 text-7xl">✓</div>
              <h1 className="text-3xl font-bold">
                {result.next_checkpoint || result.final === false
                  ? t('scanner.validPartial')
                  : t('scanner.valid')}
              </h1>
              {result.next_checkpoint ? (
                <p className="mt-4 text-lg opacity-90">{t('scanner.proceedToGate')}</p>
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
              <div className="mb-6 text-7xl">
                {result.reason === 'RECEPTION_REQUIRED_FIRST' ? '!' : '✕'}
              </div>
              <h1 className="text-3xl font-bold">
                {result.reason === 'RECEPTION_REQUIRED_FIRST'
                  ? t('scanner.outOfOrder')
                  : t('scanner.invalid')}
              </h1>
              <div className="mt-8 space-y-3 text-lg">
                <FailureMessage result={result} t={t} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-3 p-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <Button fullWidth className={primaryBtn} onClick={scanNext}>
            {t('scanner.scanNext')}
          </Button>
          {hasDashboard ? (
            <Button fullWidth variant="ghost" className={ghostBtn} onClick={backToAdmin}>
              {t('common.backToDashboard')}
            </Button>
          ) : (
            <Button fullWidth variant="ghost" className={ghostBtn} onClick={() => void signOut()}>
              {t('common.signOut')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#FAFAFA]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECECEC] bg-white px-3 py-3 sm:px-4">
        <p className="text-sm font-semibold text-[#1A1A1A]">{title}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <LanguageSwitcher />
          {canSwitchCheckpoint ? (
            <Link
              to={otherPath}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-[#1A1A1A]"
            >
              {otherLabel}
            </Link>
          ) : null}
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

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8 pt-6" dir="ltr">
        {processing ? (
          <p className="mb-4 text-lg font-medium text-[#1A1A1A]">{t('scanner.validating')}</p>
        ) : (
          <p className="mb-4 text-center text-gray-500">{t('scanner.pointCamera')}</p>
        )}
        <div
          id="qr-reader"
          className="w-full max-w-md overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm [&_video]:!scale-x-100"
          style={{ direction: 'ltr' }}
        />
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
    case 'EMPTY_TOKEN':
      return <p className="text-2xl font-semibold">{t('scanner.invalidCode')}</p>
    case 'CANCELLED':
      return <p className="text-2xl font-semibold">{t('scanner.cancelled')}</p>
    case 'ALREADY_SCANNED_RECEPTION':
      return <p className="text-2xl font-semibold">{t('scanner.alreadyScannedReception')}</p>
    case 'NOT_AUTHORIZED':
      return <p className="text-2xl font-semibold">{t('scanner.notAuthorized')}</p>
    case 'RECEPTION_REQUIRED_FIRST':
      return (
        <>
          <p className="text-2xl font-semibold">{t('scanner.receptionRequired')}</p>
          {result.invitee ? <p>{result.invitee}</p> : null}
          {result.chalet ? <p>{result.chalet}</p> : null}
        </>
      )
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
