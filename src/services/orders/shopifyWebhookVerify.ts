/**
 * Shared Shopify webhook HMAC verification + raw body parse.
 */

import crypto from 'crypto'
import { NextRequest } from 'next/server'

export function verifyShopifyWebhookHmac(rawBody: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!secret) {
    console.error('❌ SHOPIFY_WEBHOOK_SECRET not configured')
    return false
  }
  if (!hmacHeader) return false

  const hash = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')

  const a = Buffer.from(hash)
  const b = Buffer.from(hmacHeader)
  if (a.length !== b.length) return false

  return crypto.timingSafeEqual(a, b)
}

export async function readAndVerifyShopifyWebhook(
  req: NextRequest,
): Promise<{ ok: true; rawBody: string; order: Record<string, any> } | { ok: false; status: number; error: string }> {
  const rawBody = await req.text()
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || ''

  if (!verifyShopifyWebhookHmac(rawBody, hmacHeader)) {
    return { ok: false, status: 401, error: 'Webhook verification failed' }
  }

  try {
    const order = JSON.parse(rawBody)
    return { ok: true, rawBody, order }
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' }
  }
}
