export interface UtmParameters {
  source: string | null
  medium: string | null
  campaign: string | null
  content: string | null
  term: string | null
}

export interface ConversionVisit {
  id: string
  occurredAt: string | null
  source: string | null
  sourceType: string | null
  headline: string
  landingPage: string | null
  referrerUrl: string | null
  referralCode: string | null
  utmParameters: UtmParameters | null
  viaUtm: boolean
}

/** Shopify customer-journey summary, shaped for the order tile and details dialog. */
export interface OrderConversion {
  ready: boolean
  totalSessions: number | null
  daysToConversion: number | null
  firstVisit: ConversionVisit | null
  /** Set only when the converting visit is a different session from the first. */
  convertingVisit: ConversionVisit | null
  /** Short tile label: channel name when a UTM exists, otherwise "No UTM". */
  statusLabel: string
  viaUtm: boolean
}

export function formatConversionDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date)
}
