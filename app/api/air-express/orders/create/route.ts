import { NextRequest } from 'next/server'
import { createAayshOrder } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    const hasShopifyShape =
      body?.shipping?.firstName &&
      body?.lineItems?.length &&
      body?.pickup_location
    const hasLegacyShape =
      body?.pickup_location &&
      (body?.order_items?.length || body?.lineItems?.length)

    if (!body?.pickup_location) {
      throw new Error('Missing required field: pickup_location')
    }
    if (!hasShopifyShape && !hasLegacyShape) {
      throw new Error(
        'Missing required fields: pickup_location, shipping/lineItems (Shopify schema) or order_items (legacy)',
      )
    }
    if (hasShopifyShape && !body?.phone && !body?.shipping?.phone) {
      throw new Error('Customer phone is required')
    }
    return createAayshOrder(body)
  })
}
