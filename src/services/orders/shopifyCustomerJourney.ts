import type {
  ConversionVisit,
  OrderConversion,
  UtmParameters,
} from '@/src/utils/orderConversion'

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN
const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01'
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

const JOURNEY_QUERY = `
  query OrderJourneys($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        legacyResourceId
        customerJourneySummary {
          ready
          daysToConversion
          momentsCount { count }
          firstVisit {
            id
            occurredAt
            source
            sourceDescription
            sourceType
            landingPage
            referrerUrl
            referralCode
            utmParameters { source medium campaign content term }
          }
          lastVisit {
            id
            occurredAt
            source
            sourceDescription
            sourceType
            landingPage
            referrerUrl
            referralCode
            utmParameters { source medium campaign content term }
          }
        }
      }
    }
  }
`

type RawUtm = {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  content?: string | null
  term?: string | null
} | null

type RawVisit = {
  id?: string | null
  occurredAt?: string | null
  source?: string | null
  sourceDescription?: string | null
  sourceType?: string | null
  landingPage?: string | null
  referrerUrl?: string | null
  referralCode?: string | null
  utmParameters?: RawUtm
} | null

type RawSummary = {
  ready?: boolean | null
  daysToConversion?: number | null
  momentsCount?: { count?: number | null } | null
  firstVisit?: RawVisit
  lastVisit?: RawVisit
} | null

const cache = new Map<string, { at: number; value: OrderConversion | null }>()
const CACHE_MS = 10 * 60 * 1000

function cleanUtm(raw: RawUtm): UtmParameters | null {
  if (!raw) return null
  const utm: UtmParameters = {
    source: raw.source || null,
    medium: raw.medium || null,
    campaign: raw.campaign || null,
    content: raw.content || null,
    term: raw.term || null,
  }
  return Object.values(utm).some(Boolean) ? utm : null
}

function prettySource(source?: string | null): string {
  const src = (source || '').trim()
  if (!src) return 'an unknown source'
  if (src === 'direct') return 'direct'
  if (!src.includes('://')) return src
  try {
    return new URL(src).hostname.replace(/^www\./, '')
  } catch {
    return src
  }
}

function toVisit(raw: RawVisit, kind: 'first' | 'converting'): ConversionVisit | null {
  if (!raw?.id) return null
  const utmParameters = cleanUtm(raw.utmParameters || null)
  const name = prettySource(raw.source)
  const fallback =
    kind === 'first'
      ? raw.source === 'direct'
        ? '1st session was direct'
        : `1st session from ${name}`
      : raw.source === 'direct'
        ? 'Converted after a direct visit'
        : `Converted after a visit from ${name}`
  return {
    id: raw.id,
    occurredAt: raw.occurredAt || null,
    source: raw.source || null,
    sourceType: raw.sourceType || null,
    headline: raw.sourceDescription || fallback,
    landingPage: raw.landingPage || null,
    referrerUrl: raw.referrerUrl || null,
    referralCode: raw.referralCode || null,
    utmParameters,
    viaUtm: !!utmParameters,
  }
}

export function mapCustomerJourney(summary: RawSummary): OrderConversion {
  const firstVisit = toVisit(summary?.firstVisit || null, 'first')
  const lastVisit = toVisit(summary?.lastVisit || null, 'converting')
  const convertingVisit =
    lastVisit && firstVisit && lastVisit.id !== firstVisit.id
      ? lastVisit
      : lastVisit && !firstVisit
        ? lastVisit
        : null
  const ready = summary?.ready !== false
  return {
    ready,
    totalSessions:
      typeof summary?.momentsCount?.count === 'number' ? summary.momentsCount.count : null,
    daysToConversion:
      typeof summary?.daysToConversion === 'number' ? summary.daysToConversion : null,
    firstVisit,
    convertingVisit,
    statusLabel: 'No UTM',
    viaUtm: false,
  }
}

function statusFromVisit(visit: ConversionVisit): string {
  const src = (visit.source || '').trim()
  if (src && src !== 'direct' && !src.includes('://')) return src
  const utmSource = visit.utmParameters?.source
  if (utmSource) {
    return utmSource === utmSource.toLowerCase()
      ? utmSource.charAt(0).toUpperCase() + utmSource.slice(1)
      : utmSource
  }
  if (src === 'direct') return 'Direct'
  return prettySource(src)
}

/** Fix status label using the already-normalized visit (channel name, not the URL). */
function withStatusLabel(conversion: OrderConversion): OrderConversion {
  if (!conversion.ready) return { ...conversion, statusLabel: 'Pending', viaUtm: false }
  const utmVisit = [conversion.convertingVisit, conversion.firstVisit].find((visit) => visit?.viaUtm)
  if (!utmVisit) return { ...conversion, statusLabel: 'No UTM', viaUtm: false }
  return { ...conversion, statusLabel: statusFromVisit(utmVisit), viaUtm: true }
}

export async function fetchOrderConversions(
  orderIds: string[],
): Promise<Record<string, OrderConversion | null>> {
  const ids = [...new Set(orderIds.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id)))]
  const now = Date.now()
  const result: Record<string, OrderConversion | null> = {}
  const missing: string[] = []

  for (const id of ids) {
    const hit = cache.get(id)
    if (hit && now - hit.at < CACHE_MS) result[id] = hit.value
    else missing.push(id)
  }

  if (!missing.length) return result
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
    throw new Error('Shopify credentials are not configured.')
  }

  const chunks: string[][] = []
  for (let i = 0; i < missing.length; i += 50) chunks.push(missing.slice(i, i + 50))

  const loadChunk = async (chunk: string[]) => {
    const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN,
      },
      body: JSON.stringify({
        query: JOURNEY_QUERY,
        variables: { ids: chunk.map((id) => `gid://shopify/Order/${id}`) },
      }),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.errors) {
      const message =
        body?.errors?.[0]?.message ||
        `Shopify conversion lookup failed (${res.status})`
      throw new Error(message)
    }

    const seen = new Set<string>()
    for (const node of body?.data?.nodes || []) {
      const id = node?.legacyResourceId ? String(node.legacyResourceId) : ''
      if (!id) continue
      seen.add(id)
      const value = withStatusLabel(mapCustomerJourney(node.customerJourneySummary || null))
      cache.set(id, { at: now, value })
      result[id] = value
    }
    for (const id of chunk) {
      if (seen.has(id)) continue
      cache.set(id, { at: now, value: null })
      result[id] = null
    }
  }

  for (let i = 0; i < chunks.length; i += 3) {
    await Promise.all(chunks.slice(i, i + 3).map((chunk) => loadChunk(chunk)))
  }

  return result
}
