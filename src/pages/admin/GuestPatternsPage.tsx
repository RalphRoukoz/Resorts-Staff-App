import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
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

type RiskLevel = 'none' | 'low' | 'medium' | 'high'

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

const RISK_STYLES: Record<RiskLevel, string> = {
  none: 'bg-gray-100 text-gray-600',
  low: 'bg-sky-50 text-sky-800',
  medium: 'bg-amber-50 text-amber-900',
  high: 'bg-red-50 text-red-700',
}

function riskLevel(score: number): RiskLevel {
  if (score >= 50) return 'high'
  if (score >= 30) return 'medium'
  if (score > 0) return 'low'
  return 'none'
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

function signalText(t: TFunction, unit: PatternUnit, flag: PatternFlag): string {
  const values: Record<PatternFlag, Record<string, string | number>> = {
    distinct_guests: { count: unit.distinct_guests, threshold: unit.distinct_flag_threshold },
    new_name_ratio: { pct: unit.new_name_ratio_pct },
    name_reuse: { count: unit.top_name_visits },
    cross_unit: { count: unit.cross_unit_guests },
    issue_to_arrival_gap: { count: unit.short_gap_validations },
    weekend_saturation: { count: unit.invites },
    device_ping_pong: { count: unit.device_takeovers },
  }
  return t(`guestPatterns.signals.${flag}`, values[flag])
}

export function GuestPatternsPage() {
  const { t } = useTranslation()
  const { resortId, resort, hasPermission } = useAuth()
  const canSuspend = hasPermission(PERMISSIONS.UNITS_WRITE)
  const cabineInvitesEnabled = resort?.cabine_invites_enabled === true

  const [month, setMonth] = useState(monthStartISO())
  const [units, setUnits] = useState<PatternUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsReviewOnly, setNeedsReviewOnly] = useState(true)

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

    const payload = data as { error?: string; units?: PatternUnit[] } | null

    if (payload?.error) {
      setError(payload.error === 'NOT_AUTHORIZED' ? t('guestPatterns.notAuthorized') : payload.error)
      setUnits([])
      setLoading(false)
      return
    }

    setUnits(payload?.units ?? [])
    setLoading(false)
  }, [resortId, month, t])

  useEffect(() => {
    void load()
  }, [load])

  const relevantUnits = useMemo(
    () =>
      units
        .filter((u) => cabineInvitesEnabled || u.asset_type !== 'cabine')
        .sort((a, b) => b.risk_score - a.risk_score),
    [units, cabineInvitesEnabled],
  )

  const visible = useMemo(
    () => (needsReviewOnly ? relevantUnits.filter((u) => u.risk_score > 0) : relevantUnits),
    [relevantUnits, needsReviewOnly],
  )

  const needsReviewCount = relevantUnits.filter((u) => u.risk_score > 0).length
  const monthLabel = new Date(`${month}T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('guestPatterns.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{t('guestPatterns.subtitle')}</p>
        </div>
        <div className="w-44">
          <Input
            label={t('guestPatterns.month')}
            type="month"
            value={month.slice(0, 7)}
            onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)}
          />
        </div>
      </div>

      <section
        aria-label={t('guestPatterns.howItWorks')}
        className="grid gap-4 rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm sm:grid-cols-3"
      >
        <Explainer title={t('guestPatterns.explainWhatTitle')} body={t('guestPatterns.explainWhatBody')} />
        <Explainer title={t('guestPatterns.explainSafeTitle')} body={t('guestPatterns.explainSafeBody')} />
        <Explainer title={t('guestPatterns.explainActionTitle')} body={t('guestPatterns.explainActionBody')} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t('guestPatterns.filterLabel')} className="inline-flex rounded-xl bg-gray-100 p-1">
          <FilterTab active={needsReviewOnly} onClick={() => setNeedsReviewOnly(true)}>
            {t('guestPatterns.filterNeedsReview', { count: needsReviewCount })}
          </FilterTab>
          <FilterTab active={!needsReviewOnly} onClick={() => setNeedsReviewOnly(false)}>
            {t('guestPatterns.filterAll', { count: relevantUnits.length })}
          </FilterTab>
        </div>
        <p className="text-sm text-gray-500">{t('guestPatterns.sortedHint')}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {loading ? (
        <Spinner label={t('common.loading')} />
      ) : visible.length === 0 && !error ? (
        <div className="rounded-2xl border border-[#ECECEC] bg-white px-6 py-12 text-center">
          <p className="text-base font-medium text-[#1A1A1A]">
            {needsReviewOnly
              ? t('guestPatterns.emptyCalmTitle', { month: monthLabel })
              : t('guestPatterns.emptyNoInvitesTitle', { month: monthLabel })}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            {needsReviewOnly ? t('guestPatterns.emptyCalmBody') : t('guestPatterns.emptyNoInvitesBody')}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((unit) => {
            const level = riskLevel(unit.risk_score)
            const signals = unit.flags ?? []
            return (
              <li
                key={unit.asset_id}
                className="flex flex-col gap-4 rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm sm:flex-row sm:items-center"
              >
                <div className="min-w-0 sm:w-56 sm:shrink-0">
                  <p className="truncate font-medium text-[#1A1A1A]">{unit.label}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${RISK_STYLES[level]}`}>
                      {t(`guestPatterns.level.${level}`)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {t(`guestPatterns.unitType.${unit.asset_type}`, { defaultValue: unit.asset_type })}
                    </span>
                  </div>
                  {unit.invites_suspended_until ? (
                    <p className="mt-1.5 text-xs font-medium text-red-700">
                      {t('guestPatterns.suspendedUntil', { date: formatDate(unit.invites_suspended_until) })}
                    </p>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 text-sm text-gray-600">
                  {signals.length === 0 ? (
                    <p>{t('guestPatterns.noSignals', { count: unit.invites })}</p>
                  ) : (
                    <>
                      <p className="text-[#1A1A1A]">{signalText(t, unit, signals[0])}</p>
                      {signals.length > 1 ? (
                        <p className="mt-1 text-gray-500">
                          {t('guestPatterns.moreSignals', { count: signals.length - 1 })}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                <Button variant="secondary" className="sm:shrink-0" onClick={() => void openDetail(unit)}>
                  {t('guestPatterns.review')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {detailUnit ? (
        <Modal
          title={t('guestPatterns.reviewTitle', { unit: detailUnit.label })}
          onClose={() => setDetailUnit(null)}
          footer={
            <Button variant="secondary" onClick={() => setDetailUnit(null)}>
              {t('common.close', { defaultValue: 'Close' })}
            </Button>
          }
        >
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('guestPatterns.statInvites')} value={detailUnit.invites} />
              <Stat label={t('guestPatterns.statGuests')} value={detailUnit.distinct_guests} />
              <Stat label={t('guestPatterns.statArrived')} value={detailUnit.validated} />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#1A1A1A]">{t('guestPatterns.whyTitle')}</h3>
              {(detailUnit.flags ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t('guestPatterns.whyNone')}</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-gray-700">
                  {detailUnit.flags.map((flag) => (
                    <li key={flag}>{signalText(t, detailUnit, flag)}</li>
                  ))}
                </ul>
              )}
            </div>

            {canSuspend ? (
              <div className="space-y-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] p-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#1A1A1A]">{t('guestPatterns.pauseTitle')}</h3>
                  <p className="mt-1 text-sm text-gray-500">{t('guestPatterns.pauseHint')}</p>
                </div>
                <Input
                  label={t('guestPatterns.suspendUntil')}
                  type="date"
                  value={suspendUntil}
                  onChange={(e) => setSuspendUntil(e.target.value)}
                  min={todayISO()}
                />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={saving || !suspendUntil} onClick={() => void handleSuspend(false)}>
                    {t('guestPatterns.suspend')}
                  </Button>
                  {detailUnit.invites_suspended_until ? (
                    <Button variant="secondary" disabled={saving} onClick={() => void handleSuspend(true)}>
                      {t('guestPatterns.clearSuspension')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {actionError ? (
              <p role="alert" className="text-sm text-red-600">
                {actionError}
              </p>
            ) : null}

            <div>
              <h3 className="text-sm font-semibold text-[#1A1A1A]">{t('guestPatterns.guestsTitle')}</h3>
              {detailLoading ? (
                <Spinner label={t('common.loading')} />
              ) : guests.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t('guestPatterns.noGuests')}</p>
              ) : (
                <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-[#ECECEC]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-[#FAFAFA] text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('guestPatterns.guest')}</th>
                        <th className="px-3 py-2 font-medium">{t('guestPatterns.visitDate')}</th>
                        <th className="px-3 py-2 font-medium">{t('guestPatterns.issuedBy')}</th>
                        <th className="px-3 py-2 font-medium">{t('guestPatterns.status')}</th>
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
                          <td className="px-3 py-2">
                            {t(`guestPatterns.guestStatus.${g.status}`, { defaultValue: g.status })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function Explainer({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-[#1A1A1A]">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">{body}</p>
    </div>
  )
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
        active ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-gray-500 hover:text-[#1A1A1A]'
      }`}
    >
      {children}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="tnum mt-0.5 text-lg font-semibold text-[#1A1A1A]">{value}</p>
    </div>
  )
}
