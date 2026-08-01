import { apiFetch } from '@/lib/auth'
export type TicketStatus = 'open' | 'in_progress' | 'closed'

export interface SupportTicket {
  id: string
  ticketId?: string
  name?: string
  phone?: string
  orderId?: string
  description?: string
  imageUrl?: string
  status?: TicketStatus
  createdAt?: string
  lastMessagePreview?: string
}

export interface TicketComment {
  id?: string
  message: string
  authorName?: string
  authorType: 'user' | 'agent' | 'system'
  createdAt?: string
}

const parseJson = async (response: Response) => response.json().catch(() => ({}))

export async function listTickets(status?: TicketStatus, limit = 100): Promise<SupportTicket[]> {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (status) {
    params.set('status', status)
  }

  const response = await apiFetch(`/api/support/tickets?${params.toString()}`)
  const data = await parseJson(response)
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch tickets')
  }

  return Array.isArray(data.tickets) ? data.tickets : []
}

export async function getComments(ticketId: string): Promise<TicketComment[]> {
  const response = await apiFetch(`/api/support/tickets/${ticketId}/comments`)
  const data = await parseJson(response)
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch comments')
  }

  return Array.isArray(data.comments) ? data.comments : []
}

export async function replyToTicket(
  ticketId: string,
  payload: { message: string; authorName: string; authorType: 'agent' },
) {
  const response = await apiFetch(`/api/support/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJson(response)
  if (!response.ok) {
    throw new Error(data.error || 'Failed to post comment')
  }

  return data
}

export async function updateTicketStatus(id: string, status: TicketStatus) {
  const response = await apiFetch('/api/support/tickets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status }),
  })
  const data = await parseJson(response)
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update ticket status')
  }

  return data
}
