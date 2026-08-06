'use client'

import Link from 'next/link'
import { AlertCircle, CheckCircle2, ChevronLeft, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export const airExpressInputClass =
  'crm-input w-full px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/25'

export const airExpressSelectClass = airExpressInputClass

export function AirExpressSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('crm-card p-5', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {title && (
              <h2 className="text-sm font-bold tracking-wide uppercase" style={{ color: 'var(--foreground)' }}>
                {title}
              </h2>
            )}
            {description && (
              <p className="text-xs mt-1" style={{ color: 'var(--foreground-muted)' }}>
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function AirExpressErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 p-4 rounded-xl border border-red-500/30 bg-red-500/8 text-sm flex items-start gap-2 text-red-600">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <p>{message}</p>
    </div>
  )
}

export function AirExpressSuccessBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/8 text-sm flex items-start gap-2 text-emerald-600">
      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
      <p>{message}</p>
    </div>
  )
}

export function AirExpressLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="crm-card p-12 flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-7 h-7 animate-spin text-sky-500" />
      <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
        {label}
      </p>
    </div>
  )
}

export function AirExpressEmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="crm-card p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mx-auto mb-4">
        <Package className="w-7 h-7 text-sky-500" />
      </div>
      <p className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
        {title}
      </p>
      {description && (
        <p className="text-sm mt-1 max-w-md mx-auto" style={{ color: 'var(--foreground-muted)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function AirExpressPrimaryButton({
  children,
  loading,
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={loading || props.disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 transition-colors',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

export function AirExpressSecondaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn('btn-secondary inline-flex items-center justify-center gap-2 text-sm', className)}
      {...props}
    >
      {children}
    </button>
  )
}

export function AirExpressRefreshButton({
  loading,
  onClick,
  label = 'Refresh',
}: {
  loading?: boolean
  onClick: () => void
  label?: string
}) {
  return (
    <AirExpressPrimaryButton onClick={onClick} loading={loading}>
      <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
      {label}
    </AirExpressPrimaryButton>
  )
}

export function AirExpressSearchInput({
  value,
  onChange,
  onEnter,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
        style={{ color: 'var(--foreground-muted)' }}
      />
      <input
        className={cn(airExpressInputClass, 'pl-10')}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
    </div>
  )
}

export function AirExpressSelect({
  value,
  onChange,
  children,
  className,
}: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <select
      className={cn(airExpressSelectClass, className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  )
}

export function AirExpressFilterBar({ children }: { children: React.ReactNode }) {
  return <div className="crm-card p-4 mb-5">{children}</div>
}

export function AirExpressStatusBadge({ status }: { status?: string | null }) {
  const label = status || '—'
  const tone = (() => {
    const s = label.toLowerCase()
    if (s.includes('deliver')) return 'badge-success'
    if (s.includes('cancel') || s.includes('rto') || s.includes('fail')) return 'badge-danger'
    if (s.includes('transit') || s.includes('ship') || s.includes('book')) return 'badge-info'
    if (s.includes('pending') || s.includes('pickup')) return 'badge-warning'
    return 'badge-purple'
  })()

  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded-md text-xs font-semibold border', tone)}>
      {label}
    </span>
  )
}

export function AirExpressPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t"
      style={{ borderColor: 'var(--border)' }}
    >
      <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
        {total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <AirExpressSecondaryButton disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </AirExpressSecondaryButton>
        <span className="text-xs px-2" style={{ color: 'var(--foreground-muted)' }}>
          Page {page} of {totalPages}
        </span>
        <AirExpressSecondaryButton disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </AirExpressSecondaryButton>
      </div>
    </div>
  )
}

export function AirExpressBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-500 mb-4"
    >
      <ChevronLeft className="w-4 h-4" />
      {label}
    </Link>
  )
}

export function AirExpressCodeBlock({ data }: { data: unknown }) {
  return (
    <pre
      className="p-4 rounded-xl text-xs overflow-auto max-h-96 border"
      style={{
        backgroundColor: 'var(--card-elevated)',
        borderColor: 'var(--border)',
        color: 'var(--foreground-muted)',
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export function AirExpressLinkButton({
  href,
  children,
  variant = 'primary',
}: {
  href: string
  children: React.ReactNode
  variant?: 'primary' | 'danger'
}) {
  return (
    <Link
      href={href}
      className={cn(
        'text-xs font-semibold',
        variant === 'danger' ? 'text-red-500 hover:text-red-400' : 'text-sky-600 hover:text-sky-500',
      )}
    >
      {children}
    </Link>
  )
}
