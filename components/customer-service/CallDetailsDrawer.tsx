'use client'

import { X, Phone, User, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import type { CallData } from '@/lib/customerServiceApi'
import { copyText, formatDateTime, formatDuration } from '@/lib/customerServiceApi'
import { CallAudioPlayer } from './CallAudioPlayer'
import { CallStatusBadge, boolBadge } from './CallStatusBadge'

interface CallDetailsDrawerProps {
  call: CallData | null
  onClose: () => void
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-[11px] font-bold uppercase tracking-wider text-white/40 shrink-0">
        {label}
      </span>
      <span className="text-sm text-white text-right break-all">{value || '—'}</span>
    </div>
  )
}

export function CallDetailsDrawer({ call, onClose }: CallDetailsDrawerProps) {
  const [copied, setCopied] = useState<string | null>(null)

  if (!call) return null

  const handleCopy = async (key: string, value: string) => {
    const ok = await copyText(value)
    if (ok) {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    }
  }

  const answered = boolBadge(call.answered, 'Answered', 'Missed')
  const direction = boolBadge(call.inbound, 'Inbound', 'Outbound')
  const integrated = boolBadge(call.integrated, 'Integrated', 'Not Integrated')

  return (
    <div
      className="order-drawer-overlay fixed inset-0 z-50 flex justify-end backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="order-drawer-panel border-l w-full max-w-xl h-full p-6 shadow-2xl relative flex flex-col animate-slide-left overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 order-drawer-muted hover:opacity-80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6 border-b order-drawer-divider pb-4 pr-8">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
            <Phone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-extrabold flex items-center gap-2 flex-wrap">
              {call.formattedNumber || call.number || 'Unknown'}
              <CallStatusBadge label={answered.label} variant={answered.variant} />
              <CallStatusBadge label={direction.label} variant={direction.variant} />
            </h3>
            <p className="text-xs order-drawer-muted mt-1">
              {formatDateTime(call.startTime || call.createdAt)} · {formatDuration(call.duration)}
            </p>
          </div>
        </div>

        <div className="space-y-6 flex-1">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-2">
              Call Details
            </p>
            <div className="order-drawer-surface rounded-2xl p-4">
              <DetailRow
                label="Call ID"
                value={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 hover:text-purple-300"
                    onClick={() => handleCopy('callId', call.callId)}
                  >
                    {call.callId}
                    {copied === 'callId' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 opacity-50" />
                    )}
                  </button>
                }
              />
              <DetailRow
                label="Phone Number"
                value={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 hover:text-purple-300"
                    onClick={() => handleCopy('number', call.number)}
                  >
                    {call.number}
                    {copied === 'number' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 opacity-50" />
                    )}
                  </button>
                }
              />
              <DetailRow label="Customer Name" value={call.customerName || '—'} />
              <DetailRow
                label="Order ID"
                value={
                  call.orderName || call.orderId ? (
                    call.orderId ? (
                      <a
                        href={`/orders/${call.orderId}`}
                        className="text-purple-300 hover:text-purple-200"
                      >
                        {call.orderName || call.orderId}
                      </a>
                    ) : (
                      call.orderName
                    )
                  ) : (
                    '—'
                  )
                }
              />
              <DetailRow label="Formatted Number" value={call.formattedNumber || '—'} />
              <DetailRow label="Phonebook Name" value={call.phonebookName || '—'} />
              <DetailRow label="Duration" value={formatDuration(call.duration)} />
              <DetailRow
                label="Answered"
                value={<CallStatusBadge label={answered.label} variant={answered.variant} />}
              />
              <DetailRow
                label="Direction"
                value={<CallStatusBadge label={direction.label} variant={direction.variant} />}
              />
              <DetailRow
                label="Integrated"
                value={<CallStatusBadge label={integrated.label} variant={integrated.variant} />}
              />
              <DetailRow label="Created At" value={formatDateTime(call.createdAt)} />
              <DetailRow label="Start Time" value={formatDateTime(call.startTime)} />
              <DetailRow label="Source" value={call.source || '—'} />
              <DetailRow label="Source Detail" value={call.sourceDetail || '—'} />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-2 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              User
            </p>
            <div className="order-drawer-surface rounded-2xl p-4">
              <DetailRow label="Name" value={call.userName || '—'} />
              <DetailRow label="Email" value={call.userEmail || '—'} />
              <DetailRow label="Phone" value={call.userPhone || '—'} />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-2">
              Recording
            </p>
            <div className="order-drawer-surface rounded-2xl p-4">
              {call.recUrl || call.callId ? (
                <CallAudioPlayer callId={call.callId} recUrl={call.recUrl} />
              ) : (
                <p className="text-sm text-white/40">Recording not available</p>
              )}
            </div>
          </div>

          {Array.isArray(call.userTeams) && call.userTeams.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-2">
                Teams
              </p>
              <div className="order-drawer-surface rounded-2xl p-4 space-y-2">
                {call.userTeams.map((team, idx) => (
                  <div
                    key={idx}
                    className="text-xs text-white/70 bg-white/5 rounded-lg px-3 py-2 border border-white/5"
                  >
                    {Object.entries(team)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
