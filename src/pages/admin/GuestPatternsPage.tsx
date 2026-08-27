import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDate, todayISO } from '../../lib/dates'
import { displayPhone } from '../../lib/phone'
import { PERMISSIONS } from '../../lib/permissions'
import { supabase } from '../../lib/supabase'

type PatternFlag =
  | 'distinct_guests'
  | 'new_name_ratio'
  | 'name_reuse'
  | 'cross_unit'
  | 'issue_to_arrival_gap'
  | 'weekend_saturation'
  | 'device_ping_pong'

interface PatternUnit {
  asset_id: string
  label: string
  asset_type: string
  invites_suspended_until: string | null
  invites: number
  validated: number
  distinct_guests: number
  distinct_flag_threshold: number
  new_name_ratio_pct: number
  top_name_visits: number
  cross_unit_guests: number
  short_gap_validations: number
  weekend_invites: number
  device_takeovers: number
  distinct_devices: number
  risk_score: number
  flags: PatternFlag[]
  flagged: boolean
}

interface GuestDetail {
  invitee_name: string
  invitee_phone: string | null
  issued_by_phone: string
  visit_date: string
  status: string
  created_at: string
  validated_at: string | null
}

function monthStartISO(): string {
  const today = todayISO()
  return `${today.slice(0, 7)}-01`
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function GuestPatternsPage() {
  const { t } = useTranslation()
  const { resortId, hasPermission } = useAuth()
  const canSuspend = hasPermission(PERMISSIONS.UNITS_WRITE)

  const [month, setMonth] = useState(monthStartISO())
  const [units, setUnits] = useState<PatternUnit[]>([])
  const [thresholds, setThresholds] = useState<{ chalet: number; cabine: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flaggedOnly, setFlaggedOnly] = useState(true)

  const [detailUnit, setDetailUnit] = useState<PatternUnit | null>(null)
  const [guests, setGuests] = useState<GuestDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [suspendUntil, setSuspendUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('resort_guest_patterns', {
      p_resort_id: resortId,
      p_month: month,
    })

    if (rpcError) {
      setError(rpcError.message)
      setUnits([])
      setLoading(false)
      return
    }

    const payload = data as {
      error?: string
      units?: PatternUnit[]
      thresholds?: { chalet: number; cabine: number }
    } | null

    if (payload?.error) {
      setError(
        payload.error === 'NOT_AUTHORIZED'
          ? t('guestPatterns.notAuthorized')
          : payload.error,
      )
      setUnits([])
      setLoading(false)
      return
    }

    setUnits(payload?.units ?? [])
    setThresholds(payload?.thresholds ?? null)
    setLoading(false)
  }, [resortId, month, t])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (flaggedOnly ? units.filter((u) => u.flagged || u.risk_score > 0) : units),
    [units, flaggedOnly],
  )

  async function openDetail(unit: PatternUnit) {
    setDetailUnit(unit)
    setActionError(null)
    setSuspendUntil(unit.invites_suspended_until ?? addDaysISO(todayISO(), 30))
    setDetailLoading(true)
    setGuests([])

    const { data, error: rpcError } = await supabase.rpc('resort_guest_pattern_unit_detail', {
      p_asset_id: unit.asset_id,
      p_month: month,
    })

    setDetailLoading(false)
    if (rpcError) {
      setActionError(rpcError.message)
      return
    }
    const payload = data as { error?: string; guests?: GuestDetail[] } | null
    if (payload?.error) {
      setActionError(payload.error)
      return
    }
    setGuests(payload?.guests ?? [])
  }

  async function handleSuspend(clear = false) {
    if (!detailUnit) return
    setSaving(true)
    setActionError(null)

    const { data, error: rpcError } = await supabase.rpc('set_asset_invites_suspended', {
      p_asset_id: detailUnit.asset_id,
      p_until: clear ? null : suspendUntil || null,
    })

    setSaving(false)
    if (rpcError) {
      setActionError(rpcError.message)
      return
    }
    const payload = data as { error?: string } | null
    if (payload?.error) {
      setActionError(payload.error)
      return
    }

    setDetailUnit(null)
    await load()
  }

  if (loading) return <Spinner label={t('common.loading')} />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">
            {t('guestPatterns.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{t('guestPatterns.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t('guestPatterns.month')}
            type="month"
            value={month.slice(0, 7)}
            onChange={(e) => setMonth(`${e.target.value}-01`)}
          />
          <label className="flex items-center gap-2 pb-2.5 text-sm text-gray-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={flaggedOnly}
              onChange={(e) => setFlaggedOnly(e.target.checked)}
            />
            {t('guestPatterns.flaggedOnly')}
          </label>
        </div>
      </div>

      {thresholds ? (
        <p className="text-sm text-gray-500">
          {t('guestPatterns.thresholds', {
            chalet: thresholds.chalet,
            cabine: thresholds.cabine,
          })}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-8 text-center text-sm text-gray-500">
          {t('guestPatterns.empty')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[#ECECEC] bg-[#FAFAFA] text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('guestPatterns.colUnit')}</th>
                  <th className="px-4 py-3 font-medium">{t('guestPatterns.colRisk')}</th>
                  <th className="px-4 py-3 font-medium">{t('guestPatterns.colDistinct')}</th>
                  <th className="px-4 py-3 font-medium">{t('guestPatterns.colNewNames')}</th>
                  <th className="px-4 py-3 font-medium">{t('guestPatterns.colFlags')}</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((unit) => (
                  <tr key={unit.asset_id} className="border-b border-[#F3F3F3] last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#1A1A1A]">{unit.label}</p>
                      <p className="text-xs text-gray-500">
                        {unit.asset_type}
                        {unit.invites_suspended_until
                          ? ` · ${t('guestPatterns.suspendedUntil', {
                              date: formatDate(unit.invites_suspended_until),
                            })}`
                          : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#1A1A1A]">{unit.risk_score}</td>
                    <td className="px-4 py-3">
                      {unit.distinct_guests}
                      <span className="text-gray-400"> / {unit.distinct_flag_threshold}</span>
                    </td>
                    <td className="px-4 py-3">{unit.new_name_ratio_pct}%</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(unit.flags ?? []).map((flag) => (
                          <span
                            key={flag}
                            className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                          >
                            {t(`guestPatterns.flags.${flag}`, { defaultValue: flag })}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" onClick={() => void openDetail(unit)}>
                        {t('guestPatterns.view')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailUnit ? (
        <Modal
          title={`${detailUnit.label} — ${t('guestPatterns.evidence')}`}
          onClose={() => setDetailUnit(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDetailUnit(null)}>
                {t('common.close', { defaultValue: 'Close' })}
              </Button>
              {canSuspend && detailUnit.invites_suspended_until ? (
                <Button variant="secondary" disabled={saving} onClick={() => void handleSuspend(true)}>
                  {t('guestPatterns.clearSuspension')}
                </Button>
              ) : null}
              {canSuspend ? (
                <Button disabled={saving || !suspendUntil} onClick={() => void handleSuspend(false)}>
                  {t('guestPatterns.suspend')}
                </Button>
              ) : null}
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={t('guestPatterns.colDistinct')} value={detailUnit.distinct_guests} />
              <Stat label={t('guestPatterns.colNewNames')} value={`${detailUnit.new_name_ratio_pct}%`} />
              <Stat label={t('guestPatterns.deviceTakeovers')} value={detailUnit.device_takeovers} />
              <Stat label={t('guestPatterns.crossUnit')} value={detailUnit.cross_unit_guests} />
              <Stat label={t('guestPatterns.shortGap')} value={detailUnit.short_gap_validations} />
              <Stat label={t('guestPatterns.topName')} value={detailUnit.top_name_visits} />
            </div>

            {canSuspend ? (
              <Input
                label={t('guestPatterns.suspendUntil')}
                type="date"
                value={suspendUntil}
                onChange={(e) => setSuspendUntil(e.target.value)}
                min={todayISO()}
              />
            ) : null}

            {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}

            {detailLoading ? (
              <Spinner label={t('common.loading')} />
            ) : guests.length === 0 ? (
              <p className="text-sm text-gray-500">{t('guestPatterns.noGuests')}</p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-xl border border-[#ECECEC]">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#FAFAFA] text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">{t('guestPatterns.guest')}</th>
                      <th className="px-3 py-2">{t('guestPatterns.visitDate')}</th>
                      <th className="px-3 py-2">{t('guestPatterns.issuedBy')}</th>
                      <th className="px-3 py-2">{t('guestPatterns.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g, idx) => (
                      <tr key={`${g.visit_date}-${g.invitee_name}-${idx}`} className="border-t border-[#F3F3F3]">
                        <td className="px-3 py-2">
                          <p className="font-medium text-[#1A1A1A]">{g.invitee_name}</p>
                          {g.invitee_phone ? (
                            <p className="text-xs text-gray-500">{displayPhone(g.invitee_phone)}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{formatDate(g.visit_date)}</td>
                        <td className="px-3 py-2">{displayPhone(g.issued_by_phone)}</td>
                        <td className="px-3 py-2">{g.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[#1A1A1A]">{value}</p>
    </div>
  )
}
