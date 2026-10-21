'use client'

import { useEffect, useState } from 'react'
import { Clock, Eye, History, Loader2, X } from 'lucide-react'
import {
  formatConversionDate,
  type ConversionVisit,
  type OrderConversion,
  type UtmParameters,
} from '@/src/utils/orderConversion'

function utmRows(utm: UtmParameters | null): Array<[string, string]> {
  if (!utm) return []
  return [
    ['Source', utm.source],
    ['Medium', utm.medium],
    ['Campaign', utm.campaign],
    ['Content', utm.content],
    ['Term', utm.term],
  ].filter((row): row is [string, string] => Boolean(row[1]))
}

function VisitDetails({ visit }: { visit: ConversionVisit }) {
  const rows: Array<[string, string]> = [
    ['Source', visit.source || ''],
    ['Source type', visit.sourceType || ''],
    ['Landing page', visit.landingPage || ''],
    ['Referrer', visit.referrerUrl || ''],
    ['Referral code', visit.referralCode || ''],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  const utm = utmRows(visit.utmParameters)

  return (
    <div
      className="mt-3 rounded-xl border px-3 py-3 text-xs space-y-2"
      style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
    >
      {rows.map(([label, value]) => (
        <div key={label}>
          <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>
            {label}
          </p>
          {value.startsWith('http') ? (
            <a href={value} target="_blank" rel="noreferrer" className="font-medium text-purple-600 break-all hover:underline">
              {value}
            </a>
          ) : (
            <p className="font-medium break-all" style={{ color: 'var(--foreground)' }}>{value}</p>
          )}
        </div>
      ))}
      {utm.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--foreground-muted)' }}>
            UTM parameters
          </p>
          <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1">
            {utm.map(([label, value]) => (
              <div key={label} className="contents">
                <dt style={{ color: 'var(--foreground-muted)' }}>{label}</dt>
                <dd className="font-medium break-all" style={{ color: 'var(--foreground)' }}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {rows.length === 0 && utm.length === 0 && (
        <p style={{ color: 'var(--foreground-muted)' }}>No extra session details.</p>
      )}
    </div>
  )
}

function VisitRow({
  visit,
  icon,
}: {
  visit: ConversionVisit
  icon: 'first' | 'converting'
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-4">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
        >
          {icon === 'first' ? <Clock className="w-4 h-4" /> : <History className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            {visit.headline}
          </p>
          <p className="text-sm mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
            {formatConversionDate(visit.occurredAt)}
          </p>
          {visit.viaUtm && (
            <p className="text-sm mt-0.5" style={{ color: 'var(--foreground-muted)' }}>Via UTM</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-black/5"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          {open ? 'Hide details' : 'View details'}
        </button>
      </div>
      {open && <VisitDetails visit={visit} />}
    </div>
  )
}

function ConversionDialog({
  conversion,
  loading,
  error,
  onClose,
}: {
  conversion: OrderConversion | null | undefined
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sessions = conversion?.totalSessions
  const days = conversion?.daysToConversion

  return (
      <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        role="dialog"
        aria-labelledby="conversion-details-title"
        className="w-full max-w-xl rounded-2xl border shadow-2xl"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 id="conversion-details-title" className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
            Conversion details
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border hover:bg-black/5"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--foreground-muted)' }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading conversion details…
            </div>
          )}

          {!loading && error && (
            <p className="py-8 text-sm text-red-600">{error}</p>
          )}

          {!loading && !error && (
            <>
              <div className="grid grid-cols-2 gap-4 rounded-xl px-4 py-4" style={{ background: 'var(--background)' }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>Total sessions</p>
                  <p className="text-3xl font-semibold mt-1" style={{ color: 'var(--foreground)' }}>
                    {sessions ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>Days to conversion</p>
                  <p className="text-3xl font-semibold mt-1" style={{ color: 'var(--foreground)' }}>
                    {days ?? '—'}
                  </p>
                </div>
              </div>

              <div className="mt-2">
                {conversion?.firstVisit && (
                  <VisitRow visit={conversion.firstVisit} icon="first" />
                )}
                {conversion?.convertingVisit && (
                  <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <VisitRow visit={conversion.convertingVisit} icon="converting" />
                  </div>
                )}
                {!conversion?.firstVisit && !conversion?.convertingVisit && (
                  <p className="py-6 text-sm" style={{ color: 'var(--foreground-muted)' }}>
                    {conversion?.ready === false
                      ? 'Shopify is still preparing this conversion summary.'
                      : 'No session was recorded for this order.'}
                  </p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border px-4 py-2 text-sm font-semibold hover:bg-black/5"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OrderUtmStatus({
  tracked,
  conversion,
  loading,
  error,
}: {
  tracked: boolean
  conversion: OrderConversion | null | undefined
  loading: boolean
  error: string | null
}) {
  const [open, setOpen] = useState(false)

  if (!tracked) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
        <span className="font-semibold" style={{ color: 'var(--foreground)' }}>UTM</span>
        —
      </span>
    )
  }

  const label = loading && !conversion
    ? 'Loading'
    : error
      ? 'Unavailable'
      : conversion?.statusLabel || 'No UTM'
  const viaUtm = !!conversion?.viaUtm
  const tone = viaUtm
    ? 'bg-purple-500/10 text-purple-700 border-purple-500/30'
    : 'bg-black/5 text-[var(--foreground-muted)] border-[var(--border)]'

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--foreground)' }}>UTM</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${tone}`}>
          {label}
        </span>
        {viaUtm && (
          <span className="text-[10px] font-semibold" style={{ color: 'var(--foreground-muted)' }}>
            Via UTM
          </span>
        )}
        <button
          type="button"
          title="View conversion details"
          aria-label="View conversion details"
          onClick={(event) => {
            event.stopPropagation()
            setOpen(true)
          }}
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg border bg-[var(--card)] hover:bg-purple-500/10 hover:border-purple-500/40 transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          {loading && !conversion ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </span>
      {open && (
        <ConversionDialog
          conversion={conversion}
          loading={loading && !conversion}
          error={error}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
