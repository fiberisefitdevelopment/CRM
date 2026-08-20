/**
 * Resolve and persist customer phone for Shiprocket-sourced orders.
 * Shiprocket list/show APIs mask phones — we recover from phone store,
 * Shopify parent/clone links, and name+pincode index.
 */

import { lookupPhone, lookupPhoneByChannel, storePhone, storePhoneByChannel } from '@/src/services/phoneStore'
import { cleanOrderChannelKey } from '@/src/services/orders/shiprocketMergeHelpers'
import { isMaskedPhone, pickFirstRealPhone } from '@/src/utils/orderPhone'

function normalizeNamePart(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function buildNameZipKey(name?: string | null, zip?: string | null): string {
  const n = normalizeNamePart(name)
  const z = String(zip || '').trim()
  if (!n || !z) return ''
  return `${n}|${z}`
}

export type ShiprocketPhoneContext = {
  shopifyMap: Map<string, any>
  nameZipIndex: Map<string, string>
  nameOnlyIndex: Map<string, string>
  existingById?: Map<string, any>
}

function extractCustomerName(order: any): string {
  return (
    order?.customer?.first_name ||
    order?.shipping_address?.first_name ||
    order?.customer_name ||
    order?.billing_customer_name ||
    ''
  )
}

function extractCustomerZip(order: any): string {
  return String(
    order?.shipping_address?.zip ||
      order?.customer_pincode ||
      order?.billing_pincode ||
      '',
  ).trim()
}

export function buildNameZipPhoneIndex(orders: any[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const o of orders) {
    const phone = pickFirstRealPhone(
      o?.customer?.phone,
      o?.shipping_address?.phone,
      o?.shiprocket_meta?.customer_phone_unmasked,
    )
    if (!phone) continue
    const key = buildNameZipKey(extractCustomerName(o), extractCustomerZip(o))
    if (key && !index.has(key)) index.set(key, phone)
  }
  return index
}

/** When exactly one real phone exists for a customer name across the cache. */
export function buildCustomerNamePhoneIndex(orders: any[]): Map<string, string> {
  const phonesByName = new Map<string, Set<string>>()
  for (const o of orders) {
    const phone = pickFirstRealPhone(
      o?.customer?.phone,
      o?.shipping_address?.phone,
      o?.shiprocket_meta?.customer_phone_unmasked,
    )
    if (!phone) continue
    const name = normalizeNamePart(extractCustomerName(o))
    if (!name) continue
    if (!phonesByName.has(name)) phonesByName.set(name, new Set())
    phonesByName.get(name)!.add(phone)
  }

  const index = new Map<string, string>()
  for (const [name, phones] of phonesByName) {
    if (phones.size === 1) index.set(name, [...phones][0])
  }
  return index
}

/** Resolve phone while merging a raw Shiprocket API row into CRM order shape. */
export function resolveShiprocketOrderPhone(
  srOrder: any,
  ctx: ShiprocketPhoneContext,
): string {
  let phone = pickFirstRealPhone(
    srOrder?.customer_phone_unmasked,
    srOrder?.billing_phone,
    srOrder?.phone,
    srOrder?.billing_customer_phone,
    srOrder?.shipping_phone,
    typeof srOrder?.billing_address === 'object' ? srOrder?.billing_address?.phone : '',
    srOrder?.customer_phone,
  )

  if (!phone && srOrder?.id != null) {
    phone = lookupPhone(srOrder.id)
  }
  if (!phone && srOrder?.channel_order_id) {
    phone = lookupPhoneByChannel(String(srOrder.channel_order_id))
  }

  if (!phone && ctx.existingById && srOrder?.id != null) {
    const cached = ctx.existingById.get(String(srOrder.id))
    phone = pickFirstRealPhone(cached?.customer?.phone, cached?.shipping_address?.phone)
  }

  const channelKey = cleanOrderChannelKey(srOrder?.channel_order_id)
  if (!phone && channelKey.endsWith('-c')) {
    const parent = ctx.shopifyMap.get(channelKey.slice(0, -2))
    phone = pickFirstRealPhone(parent?.customer?.phone, parent?.shipping_address?.phone)
  }

  if (!phone) {
    const key = buildNameZipKey(
      srOrder?.customer_name || srOrder?.billing_customer_name,
      srOrder?.customer_pincode,
    )
    if (key) phone = ctx.nameZipIndex.get(key) || ''
  }

  if (!phone) {
    const name = normalizeNamePart(srOrder?.customer_name || srOrder?.billing_customer_name)
    if (name) phone = ctx.nameOnlyIndex.get(name) || ''
  }

  if (phone && srOrder?.id != null) {
    storePhone(srOrder.id, phone)
    if (srOrder.channel_order_id) storePhoneByChannel(String(srOrder.channel_order_id), phone)
  }

  return phone
}

function applyPhoneToOrder(order: any, phone: string): any {
  if (!phone || isMaskedPhone(phone)) return order
  return {
    ...order,
    customer: { ...(order.customer || {}), phone },
    shipping_address: { ...(order.shipping_address || {}), phone },
    shiprocket_meta: {
      ...(order.shiprocket_meta || {}),
      customer_phone_unmasked: phone,
    },
  }
}

/** Fill missing phones on cached orders (serve-time / post-merge). */
export function enrichOrdersWithShiprocketPhones(orders: any[]): any[] {
  if (!Array.isArray(orders) || !orders.length) return orders

  const nameZipIndex = buildNameZipPhoneIndex(orders)
  const nameOnlyIndex = buildCustomerNamePhoneIndex(orders)
  const byName = new Map<string, any>()
  for (const o of orders) {
    const key = cleanOrderChannelKey(o?.name)
    if (key) byName.set(key, o)
  }

  return orders.map((order) => {
    if (pickFirstRealPhone(order?.customer?.phone, order?.shipping_address?.phone)) {
      return order
    }

    let phone = pickFirstRealPhone(
      order?.shiprocket_meta?.customer_phone_unmasked,
      order?.shiprocket_meta?.customer_phone,
    )

    if (!phone && order?.id != null) {
      phone = lookupPhone(order.id)
    }
    if (!phone) {
      phone = lookupPhoneByChannel(cleanOrderChannelKey(order?.name))
    }

    const channelKey = cleanOrderChannelKey(order?.name)
    if (!phone && channelKey.endsWith('-c')) {
      const parent = byName.get(channelKey.slice(0, -2))
      phone = pickFirstRealPhone(parent?.customer?.phone, parent?.shipping_address?.phone)
    }

    if (!phone) {
      const key = buildNameZipKey(extractCustomerName(order), extractCustomerZip(order))
      if (key) phone = nameZipIndex.get(key) || ''
    }

    if (!phone) {
      const name = normalizeNamePart(extractCustomerName(order))
      if (name) phone = nameOnlyIndex.get(name) || ''
    }

    if (!phone) return order

    if (order?.source === 'shiprocket' || order?.shiprocket_order_id) {
      storePhone(order.id, phone)
      storePhoneByChannel(cleanOrderChannelKey(order.name), phone)
    }

    return applyPhoneToOrder(order, phone)
  })
}

export { applyPhoneToOrder }
