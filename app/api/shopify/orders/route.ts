export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getAllShiprocketOrders, cancelShiprocketOrder } from '@/src/services/shiprocketClient'
import { lookupPhone, lookupPhoneByChannel, storePhone, storePhoneByChannel } from '@/src/services/phoneStore'
import { parseShiprocketDate } from '@/src/utils/orderPayment'

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN
const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01'
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

import {
  getCachedOrders,
  setCachedOrders,
  getCacheExpiresAt,
  CACHE_TTL_MS,
  getActiveFetchPromise,
  setActiveFetchPromise,
  getCachedOrderById,
  removeOrderFromCache,
  cancelOrderInCache,
  getCachedOrdersCount,
  getCachedOrdersPaginated,
  getCachedOrdersFiltered,
  getOrderStatusPaginated,
  computeTabCounts
} from '@/src/services/ordersCache'

// Reusable helper to fetch all Shopify orders (handles pagination loop)
async function fetchAllShopifyOrders(limit: number | null = null): Promise<any[]> {
  let shopifyOrders: any[] = []
  const fetchLimit = limit ? Math.min(limit, 250) : 250
  let nextUrl: string | null = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=${fetchLimit}&status=any`

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN!,
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}. ${text}`)
    }

    const data = await res.json()
    if (Array.isArray(data.orders)) {
      shopifyOrders = shopifyOrders.concat(data.orders)
    }

    // If we have a limit and we've reached or exceeded it, we stop!
    if (limit && shopifyOrders.length >= limit) {
      break
    }

    const linkHeader: string | null = res.headers.get('Link') || res.headers.get('link')
    nextUrl = null
    if (linkHeader) {
      const match: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      if (match) {
        nextUrl = match[1]
      }
    }
  }
  return limit ? shopifyOrders.slice(0, limit) : shopifyOrders
}

export async function GET(_req: NextRequest) {
  try {
    if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
      return NextResponse.json(
        {
          error:
            'Shopify credentials are not configured. Please set NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN.',
        },
        { status: 500 },
      )
    }

    const { searchParams } = new URL(_req.url)
    const forceRefresh = searchParams.get('refresh') === 'true'
    const returnAll = searchParams.get('all') === 'true' // For analytics: return full list, no pagination
    const pageParam = searchParams.get('page')
    const perPageParam = searchParams.get('per_page')
    const page = pageParam ? Math.max(1, parseInt(pageParam)) : 1
    const perPage = perPageParam ? Math.max(1, Math.min(100, parseInt(perPageParam))) : 20

    // Parse all filtering query parameters
    const tab = searchParams.get('tab') || 'all'
    const search = searchParams.get('search') || undefined
    const financial = searchParams.get('financial') || undefined
    const paymentType = searchParams.get('payment') || undefined
    const channel = searchParams.get('channel') || undefined
    const courier = searchParams.get('courier') || undefined
    const pickupLocation = searchParams.get('pickup') || undefined
    const weightClass = searchParams.get('weight') || undefined
    const rtoRisk = searchParams.get('rto') || undefined
    const minPrice = searchParams.get('min_price') || undefined
    const maxPrice = searchParams.get('max_price') || undefined
    const datePreset = searchParams.get('date_preset') || undefined
    const startDate = searchParams.get('start_date') || undefined
    const endDate = searchParams.get('end_date') || undefined
    const fulfillmentStatus = searchParams.get('fulfillment') || undefined
    const includeTest = searchParams.get('include_test') === 'true'
    const orderStatusView = searchParams.get('view') === 'order_status'
    const deliveryStatus = searchParams.get('delivery') || 'all'
    const paymentStatusUi = searchParams.get('payment_status') || undefined

    const filters = {
      tab,
      search,
      financial,
      paymentType,
      channel,
      courier,
      pickupLocation,
      weightClass,
      rtoRisk,
      minPrice,
      maxPrice,
      datePreset,
      startDate,
      endDate,
      fulfillmentStatus,
      includeTest,
    }

    // A. Check in-memory cache for instant paginated response
    const now = Date.now()
    const cached = getCachedOrders()
    const expiresAt = getCacheExpiresAt()
    const cacheHasData = cached && cached.length > 0
    const cacheIsFresh = cacheHasData && now < expiresAt

    // Helper: build a paginated JSON response from current cache
    async function serveCachedResponse(isOffline = false) {
      const { applyNotesToOrders } = require('@/src/services/orderNotesStore')
      const {
        applyCareTagsToOrders,
        ensureCareTagsHydrated,
      } = require('@/src/services/careOrderTagStore') as {
        applyCareTagsToOrders: (list: any[]) => any[]
        ensureCareTagsHydrated: () => Promise<void>
      }
      // Pull Care confirmed / cancelled from Firestore care tasks into local cache
      await ensureCareTagsHydrated()
      const decorate = (list: any[]) => applyCareTagsToOrders(applyNotesToOrders(list))

      if (orderStatusView && !returnAll) {
        const result = getOrderStatusPaginated(page, perPage, {
          ...filters,
          deliveryStatus: deliveryStatus as any,
          fulfillmentStatusUi: fulfillmentStatus,
          paymentStatusUi: paymentStatusUi || paymentType,
        })
        return NextResponse.json(
          {
            orders: decorate(result.orders),
            pagination: {
              page: result.page,
              per_page: result.perPage,
              total: result.total,
              total_pages: result.totalPages,
            },
            summary: result.summary,
            couriers: result.couriers,
            channelBreakdown: result.channelBreakdown,
            tabCounts: computeTabCounts(filters),
            isOffline,
            syncing: false,
          },
          { status: 200 },
        )
      }

      const total = getCachedOrdersCount(filters)
      const tabCounts = computeTabCounts(filters)

      if (returnAll) {
        // Analytics mode: return ALL matching orders, no pagination
        const allOrders = decorate(getCachedOrdersFiltered(filters))
        return NextResponse.json(
          {
            orders: allOrders,
            pagination: { page: 1, per_page: total, total, total_pages: 1 },
            tabCounts,
            isOffline,
            syncing: false,
          },
          { status: 200 },
        )
      }

      const totalPages = Math.ceil(total / perPage) || 1
      const paginatedSlice = decorate(getCachedOrdersPaginated(page, perPage, filters))

      return NextResponse.json(
        {
          orders: paginatedSlice,
          pagination: { page, per_page: perPage, total, total_pages: totalPages },
          tabCounts,
          isOffline,
          syncing: false,
        },
        { status: 200 },
      )
    }

    // Helper: kick off background sync (fire-and-forget, never blocks response)
    function triggerBackgroundSync() {
      if (getActiveFetchPromise()) return // Already syncing

      const syncPromise = (async () => {
        try {
          const shopifyPromise = fetchAllShopifyOrders()
          const shiprocketPromise = getAllShiprocketOrders()
          const testPromise = (async () => {
            try {
              const { getAllTestOrderIds } = require('@/src/services/firestore.service')
              return await getAllTestOrderIds()
            } catch {
              return new Set<string>()
            }
          })()

          // Seed cache as soon as Shopify returns so the UI is never stuck waiting on Shiprocket
          const shopifyOrders = await shopifyPromise
          const existing = getCachedOrders()
          if ((!existing || existing.length === 0) && shopifyOrders.length > 0) {
            setCachedOrders(
              shopifyOrders.map((o: any) => ({ ...o, is_test_order: o.is_test_order === true })),
              Date.now() + 60 * 1000,
            )
            console.log(`⚡ Early cache seeded with ${shopifyOrders.length} Shopify orders (Shiprocket still loading)`)
          }

          const [shiprocketOrders, testOrderIds] = await Promise.all([shiprocketPromise, testPromise])

        if (!shiprocketOrders || shiprocketOrders.length === 0) {
          console.warn(
            '⚠️ Shiprocket returned 0 orders — Shopify cache will lack payment_method/status enrichment. Check date filters / Shiprocket API.',
          )
        }

        // Map Shopify orders for rapid deduplication lookup
        const shopifyMap = new Map<string, any>()
        shopifyOrders.forEach((order) => {
          if (order.name) {
            const cleanName = order.name.replace(/^#/, '').trim().toLowerCase()
            shopifyMap.set(cleanName, order)
          }
          if (order.id) {
            shopifyMap.set(String(order.id), order)
          }
        })

        // Match Shiprocket orders to enrich matched Shopify orders and extract custom ones
        const customOrders: any[] = []

        shiprocketOrders.forEach((srOrder) => {
          const cleanSrName = String(srOrder.channel_order_id || '').replace(/^#/, '').trim().toLowerCase()
          const matchedShopify = shopifyMap.get(cleanSrName)

          const latestShipment = srOrder.shipments?.[0]
          const tracking_number = latestShipment?.awb || srOrder.last_mile_awb || null
          const tracking_company = latestShipment?.courier || srOrder.last_mile_courier_name || null
          const tracking_url = srOrder.last_mile_awb_track_url || null

          const srStatus = (srOrder.status || '').toLowerCase()
          let shipment_status: string | null = null
          // Check RTO before "delivered" so "RTO DELIVERED" is not counted as Delivered
          if (srStatus.includes('rto') || srStatus.includes('returned')) {
            // Shiprocket RTO Initiated = open only; Delivered/Acknowledged are closed
            if (srStatus.includes('delivered') || srStatus.includes('acknowledged')) {
              shipment_status = 'rto_delivered'
            } else {
              shipment_status = 'rto'
            }
          } else if (srStatus.includes('lost') || srStatus.includes('untraceable')) {
            shipment_status = 'failure'
          } else if (srStatus.includes('undelivered') || srStatus.includes('attempt')) {
            // NDR stays on Shiprocket In Transit tab until RTO
            shipment_status = 'attempted_delivery'
          } else if (srStatus.includes('fail') || srStatus.includes('error')) {
            shipment_status = 'failure'
          } else if (srStatus === 'delivered' || srStatus.startsWith('delivered')) {
            shipment_status = 'delivered'
          } else if (srStatus.includes('out for delivery')) {
            shipment_status = 'out_for_delivery'
          } else if (
            srStatus.includes('transit') ||
            srStatus.includes('reached') ||
            srStatus === 'shipped' ||
            srStatus.includes('picked up')
          ) {
            shipment_status = 'in_transit'
          } else if (srStatus.includes('pickup') || srStatus.includes('scheduled')) {
            shipment_status = 'pickup_scheduled'
          } else if (srStatus.includes('cancel')) {
            shipment_status = 'cancelled'
          }

          const srPaymentRaw = String(srOrder.payment_method || '').toLowerCase().trim()
          const srIsCod = srPaymentRaw.includes('cod')
          const srPaymentMethod = srIsCod ? 'cod' : (srPaymentRaw ? 'prepaid' : null)

          const srCreatedAt =
            parseShiprocketDate(srOrder.created_at) ||
            parseShiprocketDate(srOrder.channel_created_at) ||
            null
          const srDeliveredAt = parseShiprocketDate(srOrder.delivered_date) || null
          const srUpdatedAt = parseShiprocketDate(srOrder.updated_at) || srCreatedAt

          // Extract shipment status reason (from delay_reason, pickup_exception_reason, or courier_remarks)
          const reasonCandidates = [
            srOrder.delay_reason,
            srOrder.pickup_exception_reason,
            latestShipment?.delay_reason,
            srOrder.awd_etds?.courier_remarks,
            srOrder.edd_remark
          ].filter(Boolean)
          const shipment_status_reason = reasonCandidates.length > 0 ? reasonCandidates[0] : null

          if (matchedShopify) {
            // Always stamp Shiprocket payment method — Shopify marks COD as "paid" after collection
            if (srPaymentMethod) {
              matchedShopify.payment_method = srPaymentMethod
            }

            const isSrCancelled = srStatus.includes('cancel')
            if (isSrCancelled) {
              matchedShopify.cancelled_at =
                matchedShopify.cancelled_at || srUpdatedAt || new Date().toISOString()
              if (!matchedShopify.financial_status || matchedShopify.financial_status === 'paid') {
                matchedShopify.financial_status = 'voided'
              }
            }

            // Enrich logistics from Shiprocket whenever we have status and/or AWB
            if (shipment_status || tracking_number) {
              const enrichmentFulfillment = {
                id: latestShipment?.id || Math.floor(Math.random() * 10000),
                status: 'success',
                tracking_number,
                tracking_company,
                tracking_url,
                shipment_status: isSrCancelled ? 'cancelled' : shipment_status,
                shipment_status_reason,
                // Keep order-date semantics for fulfillment created_at (not updated_at)
                created_at: srCreatedAt || matchedShopify.created_at,
                dispatch_date: parseShiprocketDate(srOrder.pickup_booked_date) || srCreatedAt,
                delivery_date: srDeliveredAt,
              }
              if (shipment_status && shipment_status !== 'cancelled') {
                matchedShopify.fulfillment_status = 'fulfilled'
              }
              matchedShopify.fulfillments = [enrichmentFulfillment]
            }

            matchedShopify.source = matchedShopify.source || 'shopify'
            matchedShopify.shiprocket_order_id = srOrder.id
            matchedShopify.shiprocket_meta = {
              activities: Array.isArray(srOrder.activities) ? srOrder.activities : [],
              status: srOrder.status || null,
              pickup_location: srOrder.pickup_location || null,
              shipping_method: srOrder.shipping_method || srOrder.ship_type || null,
              payment_status: srOrder.payment_status || null,
              picked_up_date: srOrder.picked_up_date || null,
              pickup_booked_date: srOrder.pickup_booked_date || null,
              out_for_delivery_date: srOrder.out_for_delivery_date || srOrder.first_out_for_delivery_date || null,
              delivered_date: srOrder.delivered_date || null,
              etd_date: srOrder.etd_date || srOrder.updated_edd_date || null,
              delay_reason: srOrder.delay_reason || null,
              delivery_delayed: Boolean(srOrder.delivery_delayed || srOrder.is_delayed),
              has_calls: Boolean(srOrder.has_calls),
              rto_reason: srOrder.rto_reason || null,
            }
          } else {
            const isSrCancelled = srStatus.includes('cancel')
            const financial_status = isSrCancelled ? 'voided' : (srIsCod ? 'pending' : 'paid')
            const cancelled_at = isSrCancelled ? (srUpdatedAt || new Date().toISOString()) : null

            const enrichFulfillment = (shipment_status || tracking_number) ? [{
              id: latestShipment?.id || Math.floor(Math.random() * 10000),
              status: 'success',
              tracking_number,
              tracking_company,
              tracking_url,
              shipment_status: isSrCancelled ? 'cancelled' : shipment_status,
              shipment_status_reason: isSrCancelled ? null : shipment_status_reason,
              created_at: srCreatedAt || new Date().toISOString(),
              dispatch_date: parseShiprocketDate(srOrder.pickup_booked_date) || srCreatedAt,
              delivery_date: srDeliveredAt,
            }] : []

            // Shiprocket masks customer_phone as "xxxxxxxxxx" in list API.
            // The real unmasked phone is in customer_phone_unmasked.
            let srPhone = (
              srOrder.customer_phone_unmasked ||
              srOrder.billing_phone ||
              srOrder.phone ||
              srOrder.billing_customer_phone ||
              srOrder.shipping_phone ||
              (typeof srOrder.billing_address === 'object' ? srOrder.billing_address?.phone : '') ||
              ''
            )
            // Treat masked placeholder as empty
            if (srPhone === 'xxxxxxxxxx') srPhone = ''

            if (!srPhone) {
              // Fall back to in-memory cache phone (from addOrderToCache on creation)
              const existingCached = require('@/src/services/ordersCache').cachedOrders
              if (Array.isArray(existingCached)) {
                const match = existingCached.find((o: any) => String(o.id) === String(srOrder.id))
                if (match) {
                  srPhone = match.customer?.phone || match.shipping_address?.phone || ''
                }
              }
            }

            if (!srPhone) {
              // Final fallback: persistent phone store (survives restarts, works for pre-fix cloned orders)
              const channelId = String(srOrder.channel_order_id || '').replace(/^#/, '').trim()
              srPhone = lookupPhone(srOrder.id) || lookupPhoneByChannel(channelId)

              // For cloned orders (channel_order_id ends with -C), recover phone from the parent Shopify order
              if (!srPhone && channelId.toLowerCase().endsWith('-c')) {
                const parentId = channelId.slice(0, -2).toLowerCase() // strip the "-C" suffix
                const parentOrder = shopifyMap.get(parentId)
                if (parentOrder) {
                  srPhone = parentOrder.shipping_address?.phone || parentOrder.customer?.phone || ''
                  if (srPhone) {
                    // Persist it so we don't have to look it up again
                    storePhone(srOrder.id, srPhone)
                    storePhoneByChannel(channelId, srPhone)
                  }
                }
              }
            }

            const formattedCustomOrder = {
              id: srOrder.id,
              name: srOrder.channel_order_id ? (srOrder.channel_order_id.startsWith('#') ? srOrder.channel_order_id : '#' + srOrder.channel_order_id) : `#SR-${srOrder.id}`,
              created_at: srCreatedAt || new Date().toISOString(),
              financial_status,
              payment_method: srPaymentMethod || (srIsCod ? 'cod' : 'prepaid'),
              cancelled_at,
              fulfillment_status: (shipment_status && shipment_status !== 'cancelled') || tracking_number ? 'fulfilled' : null,
              total_price: String(srOrder.total || '0'),
              currency: 'INR',
              customer: {
                first_name: srOrder.customer_name || srOrder.billing_customer_name || 'Manual Customer',
                last_name: srOrder.billing_last_name || '',
                email: srOrder.customer_email || srOrder.billing_email || '',
                phone: srPhone,
              },
              shipping_address: {
                first_name: srOrder.customer_name || srOrder.billing_customer_name || 'Manual Customer',
                last_name: srOrder.billing_last_name || '',
                address1: srOrder.customer_address || srOrder.billing_address || '',
                address2: srOrder.customer_address_2 || srOrder.billing_address_2 || '',
                city: srOrder.customer_city || srOrder.billing_city || '',
                province: srOrder.customer_state || srOrder.billing_state || '',
                country: srOrder.customer_country || srOrder.billing_country || 'India',
                zip: srOrder.customer_pincode || srOrder.billing_pincode || '',
                phone: srPhone,
              },
              line_items: (srOrder.products || []).map((p: any) => ({
                id: p.id || Math.floor(Math.random() * 100000),
                title: p.name || 'Custom Product',
                variant_title: null,
                sku: p.channel_sku || p.sku || '',
                quantity: p.quantity || 1,
                price: String(p.price || '0'),
                total_discount: String(p.discount || '0'),
                fulfillment_status: null,
              })),
              fulfillments: enrichFulfillment,
              source: 'shiprocket',
              shiprocket_order_id: srOrder.id,
              shiprocket_meta: {
                activities: Array.isArray(srOrder.activities) ? srOrder.activities : [],
                status: srOrder.status || null,
                pickup_location: srOrder.pickup_location || null,
                shipping_method: srOrder.shipping_method || srOrder.ship_type || null,
                payment_status: srOrder.payment_status || null,
                picked_up_date: srOrder.picked_up_date || null,
                pickup_booked_date: srOrder.pickup_booked_date || null,
                out_for_delivery_date: srOrder.out_for_delivery_date || srOrder.first_out_for_delivery_date || null,
                delivered_date: srOrder.delivered_date || null,
                etd_date: srOrder.etd_date || srOrder.updated_edd_date || null,
                delay_reason: srOrder.delay_reason || null,
                delivery_delayed: Boolean(srOrder.delivery_delayed || srOrder.is_delayed),
                has_calls: Boolean(srOrder.has_calls),
                rto_reason: srOrder.rto_reason || null,
              },
            }

            customOrders.push(formattedCustomOrder)
          }
        })

        const combinedOrders = shopifyOrders.concat(customOrders)

        // Preserve any orders that were manually injected into cache (e.g. freshly cloned orders)
        // that Shiprocket hasn't propagated yet in its listing API
        const existingCache = require('@/src/services/ordersCache').cachedOrders
        if (Array.isArray(existingCache) && existingCache.length > 0) {
          const combinedIds = new Set(combinedOrders.map((o: any) => String(o.id)))
          const orphaned = existingCache.filter((o: any) => !combinedIds.has(String(o.id)))
          if (orphaned.length > 0) {
            console.log(`ℹ️ Preserving ${orphaned.length} injected order(s) not yet in Shiprocket sync`)
            combinedOrders.push(...orphaned)
          }

          // If Shiprocket returned nothing, keep prior payment_method + fulfillment enrichment
          if (shiprocketOrders.length === 0) {
            const prevById = new Map(existingCache.map((o: any) => [String(o.id), o]))
            const prevByName = new Map(
              existingCache.map((o: any) => [String(o.name || '').replace(/^#/, '').trim().toLowerCase(), o]),
            )
            for (const order of combinedOrders) {
              const prev =
                prevById.get(String(order.id)) ||
                prevByName.get(String(order.name || '').replace(/^#/, '').trim().toLowerCase())
              if (!prev) continue
              if (!order.payment_method && prev.payment_method) order.payment_method = prev.payment_method
              if ((!order.fulfillments || order.fulfillments.length === 0) && prev.fulfillments?.length) {
                order.fulfillments = prev.fulfillments
                order.fulfillment_status = prev.fulfillment_status || order.fulfillment_status
              }
            }
          }
        }

        // Enrich combined orders with test status
        const enrichedOrders = combinedOrders.map((o: any) => {
          const isTest = o.test === true || testOrderIds.has(String(o.id));
          return {
            ...o,
            is_test_order: isTest
          };
        });

        // Short TTL if Shiprocket failed so the next request re-syncs quickly with a working fetch
        const ttl = shiprocketOrders.length === 0 ? 30 * 1000 : CACHE_TTL_MS
        setCachedOrders(enrichedOrders, Date.now() + ttl)

        // Proactively scan for delivered orders to trigger post-delivery WhatsApp journeys
        try {
          const { checkAndTriggerDeliveryJourneys } = require('@/src/services/customerJourney.service')
          checkAndTriggerDeliveryJourneys(enrichedOrders).catch((err: any) =>
            console.error('⚠️ Failed to check/trigger post-delivery journeys:', err)
          )
        } catch (e) {
          console.error('⚠️ Failed to load post-delivery journey trigger:', e)
        }

        // COD care-task generation (confirmation + delivered follow-ups), then RTO alerts.
        // Run sequentially so both jobs don't stampede Firestore at once.
        void (async () => {
          try {
            const { processOrdersForCareTasks } = require('@/src/services/careTasks/generator')
            await processOrdersForCareTasks(enrichedOrders)
          } catch (e: any) {
            console.error('⚠️ Failed to process care tasks:', e?.message || e)
          }

          try {
            const { shootRtoEmailAlert } = require('@/src/services/emailService')
            const { isActiveRtoStatus } = require('@/src/utils/orderTimeline')
            const rtoOrders = enrichedOrders.filter((order: any) => isActiveRtoStatus(order))
            const concurrency = 3
            for (let i = 0; i < rtoOrders.length; i += concurrency) {
              const chunk = rtoOrders.slice(i, i + concurrency)
              await Promise.all(
                chunk.map((order: any) =>
                  shootRtoEmailAlert(order).catch((err: any) =>
                    console.error(
                      `⚠️ Failed to shoot RTO alert email for order ${order.name || order.id}:`,
                      err,
                    ),
                  ),
                ),
              )
            }
          } catch (e) {
            console.error('⚠️ Failed to load RTO email alert engine:', e)
          }
        })()

        console.log(`✅ Background sync complete: ${combinedOrders.length} orders cached`)
        } catch (err: any) {
          console.warn('Background sync failed:', err?.message || err)
        } finally {
          setActiveFetchPromise(null)
        }
      })()

      setActiveFetchPromise(syncPromise)
    }

    // ─── Force refresh: re-sync in background but never blank the UI if we have data ───
    if (forceRefresh) {
      triggerBackgroundSync()
      if (cacheHasData) return serveCachedResponse()
      return NextResponse.json(
        {
          orders: [],
          pagination: { page, per_page: perPage, total: 0, total_pages: 0 },
          tabCounts: { new: 0, ready_to_ship: 0, pickups_manifests: 0, in_transit: 0, delivered: 0, rto: 0, cancelled: 0, all: 0 },
          isOffline: false,
          syncing: true,
        },
        { status: 200 },
      )
    }

    // ─── FAST PATH A: Cache is fresh → serve instantly ───
    if (cacheIsFresh) {
      return serveCachedResponse()
    }

    // ─── FAST PATH B: Cache exists but is stale → serve stale immediately + refresh in background ───
    if (cacheHasData) {
      triggerBackgroundSync() // Fire-and-forget, does NOT block
      return serveCachedResponse() // Serve stale data instantly
    }

    // ─── PATH C: Cache is completely empty (cold start / first boot) ───
    // Kick off background sync and return a "syncing" response so the frontend can retry in 2s
    triggerBackgroundSync()

    return NextResponse.json(
      {
        orders: [],
        pagination: { page, per_page: perPage, total: 0, total_pages: 0 },
        tabCounts: { new: 0, ready_to_ship: 0, pickups_manifests: 0, in_transit: 0, delivered: 0, rto: 0, cancelled: 0, all: 0 },
        isOffline: false,
        syncing: true,
      },
      { status: 200 },
    )
  } catch (error: any) {
    console.error('Error fetching Shopify orders:', error)
    return NextResponse.json(
      {
        error: error.message || 'Failed to fetch Shopify orders',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { ids } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No order IDs supplied' }, { status: 400 })
    }

    // Extract session for audit attribution
    let auditEmail = 'unknown'
    let auditRole = 'unknown'
    let auditUserId = 'unknown'
    try {
      const { optionalAuth } = require('@/src/services/auth')
      const session = await optionalAuth(req)
      if (session) {
        auditEmail = session.email || 'unknown'
        auditRole = session.role || 'unknown'
        auditUserId = session.id || 'unknown'
      }
    } catch { }

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const cachedOrder = getCachedOrderById(id)
        const isShiprocket = cachedOrder?.source === 'shiprocket'

        if (isShiprocket) {
          try {
            await cancelShiprocketOrder(Number(id))
          } catch (err: any) {
            console.warn(`Failed to cancel Shiprocket order ${id}:`, err)
          }
          cancelOrderInCache(id)
          return { id, success: true, source: 'shiprocket' }
        }

        // Shopify order
        if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
          throw new Error('Shopify credentials are not configured.')
        }

        // Cancel order on Shopify
        const cancelRes = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders/${id}/cancel.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ADMIN_TOKEN,
          },
        })

        if (!cancelRes.ok) {
          const text = await cancelRes.text().catch(() => '')
          // 422 means already cancelled
          if (cancelRes.status !== 422) {
            throw new Error(`Shopify cancel failed: ${cancelRes.status} ${text}`)
          }
        }

        cancelOrderInCache(id)
        return { id, success: true, source: 'shopify' }
      })
    )

    const summary = results.map((r, index) => {
      if (r.status === 'fulfilled') return r.value
      return { id: ids[index], success: false, error: r.reason?.message || 'Unknown error' }
    })

    // Fire-and-forget audit log for order cancellation(s)
    try {
      const { logAction } = require('@/src/services/auditLogService')
      const actionType = ids.length > 1 ? 'BULK_ORDER_CANCEL' : 'ORDER_CANCEL'
      const orderNames = ids.map((id: any) => {
        const cached = getCachedOrderById(id)
        return cached?.name || `#${id}`
      })
      logAction({
        userId: auditUserId,
        userEmail: auditEmail,
        userRole: auditRole,
        actionType,
        description: `Cancelled ${ids.length} order(s): ${orderNames.join(', ')}`,
        module: 'orders',
        status: 'success',
        details: { orderIds: ids, results: summary },
        req,
      })
    } catch { }

    return NextResponse.json({ success: true, results: summary }, { status: 200 })
  } catch (error: any) {
    console.error('Error in bulk cancel orders:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to bulk cancel orders' },
      { status: 500 },
    )
  }
}

