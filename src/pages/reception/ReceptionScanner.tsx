import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import { extractInvitationToken } from '../../lib/token'
import type { ValidateResult } from '../../types/database'

type ScannerPhase = 'scanning' | 'result'

export function ReceptionScanner() {
  const { signOut, hasAdmin, setView } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<ScannerPhase>('scanning')
  const [result, setResult] = useState<ValidateResult | null>(null)
  const [processing, setProcessing] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const processingRef = useRef(false)

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    if (!scanner) return

    try {
      if (scanner.isScanning) await scanner.stop()
      scanner.clear()
    } catch {
      // Scanner may already be stopped
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

      const { data, error } = await supabase.rpc('validate_invitation', {
        p_token: token,
      })

      if (error) {
        setResult({ ok: false, reason: error.message })
      } else {
        setResult(data as ValidateResult)
      }

      setPhase('result')
      setProcessing(false)
      processingRef.current = false
    },
    [stopScanner],
  )

  const startScanner = useCallback(async () => {
    setCameraError(null)
    setResult(null)
    setPhase('scanning')
    processingRef.current = false

    await stopScanner()

    const scanner = new Html5Qrcode('qr-reader')
    scannerRef.current = scanner

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        (decodedText) => {
          void handleScan(decodedText)
        },
        () => {
          // Ignore per-frame scan failures
        },
      )
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? err.message
          : 'Camera unavailable. HTTPS is required for scanning.',
      )
    }
  }, [handleScan, stopScanner])

  useEffect(() => {
    void startScanner()
    return () => {
      void stopScanner()
    }
  }, [startScanner, stopScanner])

  function scanNext() {
    void startScanner()
  }

  function backToAdmin() {
    setView('admin')
    navigate('/admin/chalets')
  }

  if (phase === 'result' && result) {
    return (
      <div
        className={`flex min-h-screen flex-col ${result.ok ? 'bg-emerald-600' : 'bg-rose-700'}`}
      >
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center text-white">
          {result.ok ? (
            <>
              <div className="mb-6 text-7xl">✓</div>
              <h1 className="text-3xl font-bold">Valid invitation</h1>
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
              <h1 className="text-3xl font-bold">Invalid</h1>
              <div className="mt-8 space-y-3 text-lg">
                <FailureMessage result={result} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-3 p-4 pb-8">
          <Button
            fullWidth
            className="!bg-white !py-4 !text-lg !font-bold !text-slate-900 hover:!bg-slate-100"
            onClick={scanNext}
          >
            Scan next
          </Button>
          {hasAdmin ? (
            <Button
              fullWidth
              variant="ghost"
              className="!text-white hover:!bg-white/10"
              onClick={backToAdmin}
            >
              Back to admin
            </Button>
          ) : (
            <Button
              fullWidth
              variant="ghost"
              className="!text-white hover:!bg-white/10"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <header className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium text-sky-400">Reception scanner</p>
        {hasAdmin ? (
          <button
            type="button"
            onClick={backToAdmin}
            className="text-sm text-slate-400 hover:text-white"
          >
            Admin
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-sm text-slate-400 hover:text-white"
          >
            Sign out
          </button>
        )}
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8">
        {processing ? (
          <p className="mb-4 text-lg text-white">Validating…</p>
        ) : (
          <p className="mb-4 text-center text-slate-400">Point camera at invitation QR code</p>
        )}

        <div
          id="qr-reader"
          className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700"
        />

        {cameraError ? (
          <p className="mt-4 max-w-md text-center text-sm text-rose-400">{cameraError}</p>
        ) : null}
      </div>
    </div>
  )
}

function FailureMessage({ result }: { result: Extract<ValidateResult, { ok: false }> }) {
  switch (result.reason) {
    case 'ALREADY_USED':
      return (
        <>
          <p className="text-2xl font-semibold">Already used</p>
          {result.validated_at ? <p>Validated: {result.validated_at}</p> : null}
          {result.invitee ? <p>{result.invitee}</p> : null}
          {result.chalet ? <p>{result.chalet}</p> : null}
        </>
      )
    case 'WRONG_DATE':
      return (
        <>
          <p className="text-2xl font-semibold">Wrong date</p>
          {result.valid_for ? <p>Valid for: {formatDate(result.valid_for)}</p> : null}
          {result.invitee ? <p>{result.invitee}</p> : null}
          {result.chalet ? <p>{result.chalet}</p> : null}
        </>
      )
    case 'NOT_FOUND':
      return <p className="text-2xl font-semibold">Invalid code</p>
    case 'NOT_AUTHORIZED':
      return <p className="text-2xl font-semibold">Not authorized</p>
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
