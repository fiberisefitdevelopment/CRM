'use client'

import { apiFetch } from '@/lib/auth'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Send, Ticket } from 'lucide-react'
import {
  getComments,
  listTickets,
  replyToTicket,
  type SupportTicket,
  type TicketComment,
  type TicketStatus,
  updateTicketStatus,
} from '@/lib/ticketApi'

const statusTabs: Array<{ label: string; value: 'inbox' | TicketStatus }> = [
  { label: 'Inbox', value: 'inbox' },
  { label: 'Open', value: 'open' },
  { label: 'Working', value: 'in_progress' },
  { label: 'Closed', value: 'closed' },
]

export default function TicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [statusFilter, setStatusFilter] = useState<'inbox' | TicketStatus>('inbox')
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [comments, setComments] = useState<TicketComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [replyMessage, setReplyMessage] = useState('')
  const [agentName, setAgentName] = useState('Support Agent A')
  const [sendingReply, setSendingReply] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null)
  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [tickets, selectedTicketId],
  )

  const sortByCreatedAtDesc = (items: SupportTicket[]) =>
    [...items].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })

  const fetchTickets = useCallback(async (filter: 'inbox' | TicketStatus) => {
    try {
      setLoading(true)
      setError(null)
      setSuccessMessage(null)

      let nextTickets: SupportTicket[] = []

      if (filter === 'inbox') {
        const [openTickets, inProgressTickets] = await Promise.all([
          listTickets('open', 100),
          listTickets('in_progress', 100),
        ])
        const merged = [...openTickets, ...inProgressTickets]
        const uniqueMap = new Map<string, SupportTicket>()
        for (const ticket of merged) {
          uniqueMap.set(ticket.id, ticket)
        }
        nextTickets = sortByCreatedAtDesc(Array.from(uniqueMap.values()))
      } else {
        nextTickets = sortByCreatedAtDesc(await listTickets(filter, 100))
      }

      setTickets(nextTickets)
      setSelectedTicketId((prev) =>
        prev && nextTickets.some((ticket) => ticket.id === prev) ? prev : nextTickets[0]?.id || null,
      )
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tickets')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTickets(statusFilter)
  }, [statusFilter, fetchTickets])

  const fetchTicketComments = useCallback(async (ticketId: string) => {
    try {
      setCommentsLoading(true)
      setError(null)
      const nextComments = await getComments(ticketId)
      const sorted = [...nextComments].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return aTime - bTime
      })
      setComments(sorted)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch comments')
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedTicketId) {
      setComments([])
      return
    }
    fetchTicketComments(selectedTicketId)
  }, [selectedTicketId, fetchTicketComments])

  const stats = useMemo(() => {
    return {
      all: tickets.length,
      open: tickets.filter((ticket) => ticket.status === 'open').length,
      inProgress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
      closed: tickets.filter((ticket) => ticket.status === 'closed').length,
    }
  }, [tickets])

  const updateTicket = async (id: string, updates: Partial<SupportTicket>, showSuccess = true) => {
    try {
      setSavingTicketId(id)
      setError(null)
      setSuccessMessage(null)

      let data: any = null
      if (updates.status) {
        data = await updateTicketStatus(id, updates.status)
      } else {
        const res = await apiFetch('/api/support/tickets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...updates }),
        })
        data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data.error || 'Failed to update ticket')
        }
      }

      setTickets((prev) =>
        prev.map((ticket) =>
          ticket.id === id
            ? {
                ...ticket,
                ...updates,
                ...(data.ticket || {}),
              }
            : ticket,
        ),
      )

      if (showSuccess) {
        setSuccessMessage('Ticket updated successfully.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update ticket')
    } finally {
      setSavingTicketId(null)
    }
  }

  const handleSendReply = async (resolveAfterSend = false) => {
    if (!selectedTicket || !replyMessage.trim()) {
      return
    }

    try {
      setSendingReply(true)
      setError(null)
      setSuccessMessage(null)

      await replyToTicket(selectedTicket.id, {
        message: replyMessage.trim(),
        authorName: agentName.trim() || 'Support Agent',
        authorType: 'agent',
      })

      const shouldMoveToInProgress = selectedTicket.status === 'open'
      if (shouldMoveToInProgress) {
        await updateTicket(selectedTicket.id, { status: 'in_progress' }, false)
      }
      if (resolveAfterSend) {
        await updateTicket(selectedTicket.id, { status: 'closed' }, false)
      }

      setReplyMessage('')
      await fetchTicketComments(selectedTicket.id)
      await fetchTickets(statusFilter)
      setSuccessMessage(resolveAfterSend ? 'Reply sent and ticket resolved.' : 'Reply sent successfully.')
    } catch (err: any) {
      setError(err.message || 'Failed to send reply')
    } finally {
      setSendingReply(false)
    }
  }

  const getStatusBadgeClasses = (status?: TicketStatus) => {
    switch (status) {
      case 'open':
        return 'bg-blue-500/20 text-blue-200 border border-blue-400/30'
      case 'in_progress':
        return 'bg-amber-500/20 text-amber-200 border border-amber-400/30'
      case 'closed':
        return 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30'
      default:
        return 'bg-white/10 text-white/80 border border-white/20'
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-white mb-2 flex items-center gap-2">
                  <Ticket className="w-7 h-7 text-purple-400" />
                  Tasks
                </h1>
                <p className="text-white/60 text-sm">
                  Manage support issues synced from the wellness app ticket backend.
                </p>
              </div>
              <button
                onClick={() => fetchTickets(statusFilter)}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-white/10 bg-card px-4 py-3">
                <p className="text-xs text-white/60 mb-1">Total</p>
                <p className="text-white text-xl font-semibold">{stats.all}</p>
              </div>
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3">
                <p className="text-xs text-blue-200/80 mb-1">Open</p>
                <p className="text-blue-100 text-xl font-semibold">{stats.open}</p>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                <p className="text-xs text-amber-200/80 mb-1">In Progress</p>
                <p className="text-amber-100 text-xl font-semibold">{stats.inProgress}</p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                <p className="text-xs text-emerald-200/80 mb-1">Closed</p>
                <p className="text-emerald-100 text-xl font-semibold">{stats.closed}</p>
              </div>
            </div>
          </div>

          {(error || successMessage) && (
            <div
              className={`mb-4 p-4 rounded-xl border text-sm flex items-start gap-2 ${
                error
                  ? 'border-red-500/40 bg-red-500/10 text-red-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {error ? <AlertCircle className="w-4 h-4 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 mt-0.5" />}
              <p>{error || successMessage}</p>
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  statusFilter === tab.value
                    ? 'bg-purple-500/20 text-purple-200 border-purple-400/40'
                    : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-[280px]">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                <p className="text-white/60 text-sm">Fetching support tickets...</p>
              </div>
            </div>
          ) : tickets.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center border border-dashed border-white/15 rounded-2xl bg-card/40">
              <div className="text-center">
                <Ticket className="w-8 h-8 text-white/40 mx-auto mb-3" />
                <p className="text-white font-medium mb-1">No tickets found</p>
                <p className="text-white/60 text-sm">
                  Try changing status filters or check if the wellness API has ticket records.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <div className="bg-card rounded-2xl border border-white/10 overflow-hidden xl:col-span-3">
                <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/60 bg-white/5">
                      <th className="px-4 py-3 font-medium">Ticket</th>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium">Last Message</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr
                        key={ticket.id}
                        className={`border-t border-white/5 align-top cursor-pointer ${
                          selectedTicketId === ticket.id ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                        onClick={() => setSelectedTicketId(ticket.id)}
                      >
                        <td className="px-4 py-3 text-white">
                          <p className="font-medium text-purple-300">{ticket.ticketId || 'N/A'}</p>
                          <p className="text-xs text-white/50 mt-1">Doc ID: {ticket.id}</p>
                          {ticket.orderId && <p className="text-xs text-white/50 mt-1">Order: {ticket.orderId}</p>}
                        </td>
                        <td className="px-4 py-3 text-white/85">
                          <p>{ticket.name || 'Unknown'}</p>
                          {ticket.phone && <p className="text-xs text-white/50 mt-1">{ticket.phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-white/80 max-w-[220px]">
                          <p className="line-clamp-2 text-xs">
                            {ticket.lastMessagePreview || ticket.description || 'No message yet'}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                          {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'N/A'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getStatusBadgeClasses(ticket.status)}`}
                          >
                            {ticket.status || 'unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => updateTicket(ticket.id, { status: 'in_progress' }, false)}
                              disabled={savingTicketId === ticket.id || ticket.status === 'in_progress'}
                              className="px-2 py-1 rounded-md border border-amber-400/30 bg-amber-500/10 hover:bg-amber-500/20 text-xs text-amber-200 disabled:opacity-50"
                            >
                              Start
                            </button>
                            <button
                              type="button"
                              onClick={() => updateTicket(ticket.id, { status: 'closed' }, false)}
                              disabled={savingTicketId === ticket.id || ticket.status === 'closed'}
                              className="px-2 py-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs text-emerald-200 disabled:opacity-50"
                            >
                              Resolve
                            </button>
                            <button
                              type="button"
                              onClick={() => updateTicket(ticket.id, { status: 'open' }, false)}
                              disabled={savingTicketId === ticket.id || ticket.status === 'open'}
                              className="px-2 py-1 rounded-md border border-blue-400/30 bg-blue-500/10 hover:bg-blue-500/20 text-xs text-blue-200 disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              <div className="bg-card rounded-2xl border border-white/10 xl:col-span-2 p-4">
                {!selectedTicket ? (
                  <div className="h-full min-h-[340px] flex items-center justify-center text-white/50 text-sm">
                    Select a ticket to open details.
                  </div>
                ) : (
                  <div className="h-full flex flex-col">
                    <div className="mb-3 pb-3 border-b border-white/10">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-white font-semibold">{selectedTicket.ticketId || selectedTicket.id}</h2>
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusBadgeClasses(selectedTicket.status)}`}
                        >
                          {selectedTicket.status || 'unknown'}
                        </span>
                      </div>
                      <p className="text-xs text-white/60 mt-1">
                        {selectedTicket.name || 'Unknown'} {selectedTicket.phone ? `• ${selectedTicket.phone}` : ''}
                      </p>
                      {selectedTicket.orderId && (
                        <p className="text-xs text-white/50 mt-1">Order: {selectedTicket.orderId}</p>
                      )}
                    </div>

                    <div className="flex-1 min-h-[250px] max-h-[420px] overflow-y-auto space-y-3 pr-1">
                      {commentsLoading ? (
                        <div className="py-10 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                        </div>
                      ) : comments.length === 0 ? (
                        <p className="text-xs text-white/50">No comments yet.</p>
                      ) : (
                        comments.map((comment, index) => (
                          <div key={comment.id || `${comment.createdAt}-${index}`} className="rounded-lg bg-white/5 border border-white/10 p-3">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-xs text-white font-medium">{comment.authorName || 'Unknown'}</span>
                              <span
                                className={`text-[10px] uppercase px-2 py-0.5 rounded ${
                                  comment.authorType === 'agent'
                                    ? 'bg-purple-500/20 text-purple-200'
                                    : comment.authorType === 'user'
                                      ? 'bg-blue-500/20 text-blue-200'
                                      : 'bg-white/15 text-white/70'
                                }`}
                              >
                                {comment.authorType}
                              </span>
                            </div>
                            <p className="text-xs text-white/85 whitespace-pre-wrap">{comment.message}</p>
                            <p className="text-[10px] text-white/45 mt-2">
                              {comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-white/10 space-y-2">
                      <input
                        value={agentName}
                        onChange={(event) => setAgentName(event.target.value)}
                        placeholder="Agent name"
                        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/90 focus:outline-none focus:ring-1 focus:ring-purple-400/60"
                      />
                      <textarea
                        value={replyMessage}
                        onChange={(event) => setReplyMessage(event.target.value)}
                        placeholder="Type your reply to the customer..."
                        className="w-full min-h-[84px] rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/90 focus:outline-none focus:ring-1 focus:ring-purple-400/60"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleSendReply(false)}
                          disabled={sendingReply || !replyMessage.trim() || !selectedTicket}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-purple-500/20 border border-purple-400/30 text-xs text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          Send Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendReply(true)}
                          disabled={sendingReply || !replyMessage.trim() || !selectedTicket}
                          className="px-3 py-2 rounded-md bg-emerald-500/20 border border-emerald-400/30 text-xs text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                        >
                          Send & Resolve
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
