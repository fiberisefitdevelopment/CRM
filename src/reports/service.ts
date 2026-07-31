import { getCachedOrders, setCachedOrders, getCachedOrdersFiltered } from '@/src/services/ordersCache';
import { getAllShiprocketOrders } from '@/src/services/shiprocketClient';
import {
  isActiveRtoStatus,
  isShiprocketDeliveredStatus,
  isShiprocketInTransitStatus,
} from '@/src/utils/orderTimeline';

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN;
const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01';
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

// Local fetch Shopify orders helper to align with API route
async function fetchAllShopifyOrders(limit: number | null = null): Promise<any[]> {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
    throw new Error('Shopify credentials are not configured in environment variables.');
  }
  let shopifyOrders: any[] = [];
  const fetchLimit = limit ? Math.min(limit, 250) : 250;
  let nextUrl: string | null = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=${fetchLimit}&status=any`;
  
  while (nextUrl) {
    const res: any = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN!,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}. ${text}`);
    }

    const data = await res.json();
    if (Array.isArray(data.orders)) {
      shopifyOrders = shopifyOrders.concat(data.orders);
    }

    if (limit && shopifyOrders.length >= limit) {
      break;
    }

    const linkHeader = res.headers.get('Link') || res.headers.get('link');
    nextUrl = null;
    if (linkHeader) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        nextUrl = match[1];
      }
    }
  }
  return limit ? shopifyOrders.slice(0, limit) : shopifyOrders;
}

// Sync function to load orders into the in-memory cache if empty/stale
export async function syncOrders(): Promise<any[]> {
  try {
    console.log('🔄 [Report Service] Running Shopify and Shiprocket sync...');
    
    // Resolve firestore test order ids helper safely
    let testOrderIds = new Set<string>();
    try {
      const { getAllTestOrderIds } = require('@/src/services/firestore.service');
      testOrderIds = await getAllTestOrderIds();
    } catch (e) {
      console.warn('⚠️ Could not load test order ids:', e);
    }

    const [shopifyOrders, shiprocketOrders] = await Promise.all([
      fetchAllShopifyOrders(),
      getAllShiprocketOrders()
    ]);

    const shopifyMap = new Map<string, any>();
    shopifyOrders.forEach((order) => {
      if (order.name) {
        const cleanName = order.name.replace(/^#/, '').trim().toLowerCase();
        shopifyMap.set(cleanName, order);
      }
      if (order.id) {
        shopifyMap.set(String(order.id), order);
      }
    });

    const customOrders: any[] = [];
    shiprocketOrders.forEach((srOrder) => {
      const cleanSrName = String(srOrder.channel_order_id || '').replace(/^#/, '').trim().toLowerCase();
      const matchedShopify = shopifyMap.get(cleanSrName);

      const latestShipment = srOrder.shipments?.[0];
      const tracking_number = latestShipment?.awb || srOrder.last_mile_awb || null;
      const tracking_company = latestShipment?.courier || srOrder.last_mile_courier_name || null;
      const tracking_url = srOrder.last_mile_awb_track_url || null;

      const srStatus = (srOrder.status || '').toLowerCase();
      let shipment_status = null;
      // RTO before delivered so "RTO DELIVERED" is not counted as Delivered
      if (srStatus.includes('rto') || srStatus.includes('returned')) {
        if (srStatus.includes('delivered') || srStatus.includes('acknowledged')) {
          shipment_status = 'rto_delivered';
        } else {
          shipment_status = 'rto';
        }
      } else if (srStatus.includes('lost') || srStatus.includes('untraceable')) {
        shipment_status = 'failure';
      } else if (srStatus.includes('undelivered') || srStatus.includes('attempt')) {
        shipment_status = 'attempted_delivery';
      } else if (srStatus.includes('fail') || srStatus.includes('error')) {
        shipment_status = 'failure';
      } else if (srStatus === 'delivered' || srStatus.startsWith('delivered')) {
        shipment_status = 'delivered';
      } else if (srStatus.includes('out for delivery')) {
        shipment_status = 'out_for_delivery';
      } else if (
        srStatus.includes('transit') ||
        srStatus.includes('reached') ||
        srStatus === 'shipped' ||
        srStatus.includes('picked up')
      ) {
        shipment_status = 'in_transit';
      } else if (srStatus.includes('pickup') || srStatus.includes('scheduled')) {
        shipment_status = 'pickup_scheduled';
      }

      const srPaymentRaw = String(srOrder.payment_method || '').toLowerCase().trim();
      const srIsCod = srPaymentRaw.includes('cod');
      const srPaymentMethod = srIsCod ? 'cod' : (srPaymentRaw ? 'prepaid' : null);

      // Extract shipment status reason (from delay_reason, pickup_exception_reason, or courier_remarks)
      const reasonCandidates = [
        srOrder.delay_reason,
        srOrder.pickup_exception_reason,
        latestShipment?.delay_reason,
        srOrder.awd_etds?.courier_remarks,
        srOrder.edd_remark
      ].filter(Boolean);
      const shipment_status_reason = reasonCandidates.length > 0 ? reasonCandidates[0] : null;

      if (matchedShopify) {
        if (srPaymentMethod) matchedShopify.payment_method = srPaymentMethod;
        if (shipment_status || tracking_number) {
          const enrichmentFulfillment = {
            id: latestShipment?.id || Math.floor(Math.random() * 10000),
            status: 'success',
            tracking_number,
            tracking_company,
            tracking_url,
            shipment_status,
            shipment_status_reason,
            created_at: srOrder.created_at || matchedShopify.created_at,
            dispatch_date: latestShipment?.shipped_date || latestShipment?.pickup_date || srOrder.shipped_date || srOrder.created_at || matchedShopify.created_at,
            delivery_date: latestShipment?.delivered_date || srOrder.delivered_date || (shipment_status === 'delivered' ? (srOrder.updated_at || srOrder.created_at) : null),
          };
          matchedShopify.fulfillment_status = 'fulfilled';
          matchedShopify.fulfillments = [enrichmentFulfillment];
        }
      } else {
        const isCod = srIsCod;
        const isSrCancelled = srStatus.includes('cancelled') || srStatus.includes('canceled');
        const financial_status = isSrCancelled ? 'voided' : (isCod ? 'pending' : 'paid');
        const cancelled_at = isSrCancelled ? (srOrder.updated_at || srOrder.created_at || new Date().toISOString()) : null;

        const enrichFulfillment = (shipment_status || tracking_number) ? [{
          id: latestShipment?.id || Math.floor(Math.random() * 10000),
          status: 'success',
          tracking_number,
          tracking_company,
          tracking_url,
          shipment_status: isSrCancelled ? 'cancelled' : shipment_status,
          shipment_status_reason: isSrCancelled ? null : shipment_status_reason,
          created_at: srOrder.created_at || srOrder.updated_at,
          dispatch_date: latestShipment?.shipped_date || latestShipment?.pickup_date || srOrder.shipped_date || srOrder.created_at,
          delivery_date: latestShipment?.delivered_date || srOrder.delivered_date || (shipment_status === 'delivered' ? (srOrder.updated_at || srOrder.created_at) : null),
        }] : [];

        let srPhone = srOrder.customer_phone_unmasked || srOrder.billing_phone || srOrder.phone || '';
        if (srPhone === 'xxxxxxxxxx') srPhone = '';

        const formattedCustomOrder = {
          id: srOrder.id,
          name: srOrder.channel_order_id ? (srOrder.channel_order_id.startsWith('#') ? srOrder.channel_order_id : '#' + srOrder.channel_order_id) : `#SR-${srOrder.id}`,
          created_at: srOrder.created_at || srOrder.channel_created_at || new Date().toISOString(),
          financial_status,
          payment_method: srPaymentMethod || (isCod ? 'cod' : 'prepaid'),
          cancelled_at,
          fulfillment_status: (shipment_status && shipment_status !== 'cancelled') || tracking_number ? 'fulfilled' : null,
          total_price: String(srOrder.total || '0'),
          currency: 'INR',
          customer: {
            first_name: srOrder.customer_name || 'Manual Customer',
            last_name: '',
            email: srOrder.customer_email || '',
            phone: srPhone,
          },
          shipping_address: {
            first_name: srOrder.customer_name || 'Manual Customer',
            last_name: '',
            address1: srOrder.customer_address || '',
            address2: '',
            city: srOrder.customer_city || '',
            province: srOrder.customer_state || '',
            country: srOrder.customer_country || 'India',
            zip: srOrder.customer_pincode || '',
            phone: srPhone,
          },
          line_items: (srOrder.products || []).map((p: any) => ({
            id: p.id || Math.floor(Math.random() * 100000),
            title: p.name || 'Custom Product',
            quantity: p.quantity || 1,
            price: String(p.price || '0'),
          })),
          fulfillments: enrichFulfillment,
          source: 'shiprocket',
        };

        customOrders.push(formattedCustomOrder);
      }
    });

    const combinedOrders = shopifyOrders.concat(customOrders);
    const enrichedOrders = combinedOrders.map((o: any) => {
      const isTest = o.test === true || testOrderIds.has(String(o.id));
      return {
        ...o,
        is_test_order: isTest
      };
    });

    const CACHE_TTL_MS = 5 * 60 * 1000;
    setCachedOrders(enrichedOrders, Date.now() + CACHE_TTL_MS);
    console.log(`✅ [Report Service] Sync complete: ${enrichedOrders.length} orders cached`);
    return enrichedOrders;
  } catch (error: any) {
    console.error('❌ [Report Service] Sync failed:', error);
    return getCachedOrders() || [];
  }
}

// Helper to check if an order is cancelled
function isOrderCancelled(order: any): boolean {
  return (
    !!order.cancelled_at ||
    order.financial_status?.toLowerCase() === 'voided' ||
    order.financial_status?.toLowerCase() === 'cancelled' ||
    order.financial_status?.toLowerCase() === 'refunded' ||
    order.fulfillments?.[0]?.shipment_status === 'cancelled'
  );
}

export interface KPIStats {
  ordersReceived: number;
  shippedOrders: number;
  inTransitOrders: number;
  deliveredOrders: number;
  rtoOrders: number;
  deliveryRate: number; // %
  rtoRate: number; // %
}

export interface ReportData {
  reportDateStr: string;
  generatedTimeStr: string;
  startDateStr: string;
  endDateStr: string;
  kpis: {
    today: KPIStats;
    thisWeek: KPIStats;
  };
  trendData: {
    dates: string[];
    orderCounts: number[];
  };
  distribution: {
    shipped: number;
    inTransit: number;
    delivered: number;
    rto: number;
  };
  performanceTable: Array<{
    date: string;
    ordersReceived: number;
    shipped: number;
    inTransit: number;
    delivered: number;
    rto: number;
  }>;
  weeklySnapshot: {
    totalOrdersReceived: number;
    totalDelivered: number;
    totalRTO: number;
    fulfillmentRate: number;
    rtoPercentage: number;
  };
  operationalInsights: string[];
  performanceAnalysis: {
    highRtoWarning: boolean;
    lowDeliveryRateWarning: boolean;
    peakShipmentDay: string;
    peakShipmentCount: number;
    bestPerformingDay: string;
    bestPerformingCount: number;
    growthTrend: string;
    declineTrend: string;
  };
}

// Main logic to fetch, filter, and calculate the stats
export async function getReportData(startDateStr?: string, endDateStr?: string): Promise<ReportData> {
  let orders = getCachedOrders();
  if (!orders || orders.length === 0) {
    orders = await syncOrders();
  }

  // Parse or default date ranges (default to last 7 days)
  const now = new Date();
  
  let periodEnd = now;
  if (endDateStr) {
    periodEnd = new Date(endDateStr);
    if (isNaN(periodEnd.getTime())) periodEnd = now;
  }
  // Ensure periodEnd is the end of that day (23:59:59.999)
  periodEnd.setHours(23, 59, 59, 999);

  let periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000 + 1);
  if (startDateStr) {
    periodStart = new Date(startDateStr);
    if (isNaN(periodStart.getTime())) periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000 + 1);
  }
  // Ensure periodStart is the start of that day (00:00:00.000)
  periodStart.setHours(0, 0, 0, 0);

  // Today boundaries (relative to periodEnd)
  const todayStart = new Date(periodEnd);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(periodEnd);
  todayEnd.setHours(23, 59, 59, 999);

  // Previous Period boundaries (of equal length, preceding periodStart)
  const durationMs = periodEnd.getTime() - periodStart.getTime();
  const prevPeriodStart = new Date(periodStart.getTime() - durationMs - 1);
  prevPeriodStart.setHours(0, 0, 0, 0);
  const prevPeriodEnd = new Date(periodStart.getTime() - 1);
  prevPeriodEnd.setHours(23, 59, 59, 999);

  // Filter out test orders
  const productionOrders = orders.filter(o => o.is_test_order !== true);

  // Helper to calculate stats for a given period (start to end)
  const calculateKPIsForPeriod = (start: Date, end: Date): KPIStats => {
    const activeOrders = productionOrders.filter(o => !isOrderCancelled(o));
    
    // Orders Received: checked by order placement date (created_at)
    const ordersReceived = activeOrders.filter(o => {
      const d = new Date(o.created_at);
      return d >= start && d <= end;
    }).length;
    
    // Shipped Orders: checked by fulfillment date
    const shippedOrders = activeOrders.filter(o => {
      if (o.fulfillment_status !== 'fulfilled') return false;
      const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
      return fDate >= start && fDate <= end;
    }).length;
    
    // In Transit / Delivered / RTO — Shiprocket tab parity
    const inTransitOrders = activeOrders.filter(o => {
      if (!isShiprocketInTransitStatus(o)) return false;
      const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
      return fDate >= start && fDate <= end;
    }).length;

    const deliveredOrders = activeOrders.filter(o => {
      if (!isShiprocketDeliveredStatus(o)) return false;
      const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
      return fDate >= start && fDate <= end;
    }).length;

    const rtoOrders = activeOrders.filter(o => {
      if (!isActiveRtoStatus(o)) return false;
      const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
      return fDate >= start && fDate <= end;
    }).length;

    const deliveryRate = shippedOrders > 0 ? parseFloat(((deliveredOrders / shippedOrders) * 100).toFixed(1)) : 0;
    const rtoRate = shippedOrders > 0 ? parseFloat(((rtoOrders / shippedOrders) * 100).toFixed(1)) : 0;

    return {
      ordersReceived,
      shippedOrders,
      inTransitOrders,
      deliveredOrders,
      rtoOrders,
      deliveryRate,
      rtoRate
    };
  };

  const kpisToday = calculateKPIsForPeriod(todayStart, todayEnd);
  const kpisThisWeek = calculateKPIsForPeriod(periodStart, periodEnd);
  const kpisPrevWeek = calculateKPIsForPeriod(prevPeriodStart, prevPeriodEnd);

  // Generate 7-day lists
  const datesList: string[] = [];
  const performanceTable: any[] = [];
  const dailyCounts: { [key: string]: { received: number; shipped: number; transit: number; delivered: number; rto: number } } = {};

  // Initialize dates list (always exactly 7 days leading up to periodEnd)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(periodEnd);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    const formattedLabel = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
    datesList.push(formattedLabel);
    dailyCounts[dateKey] = { received: 0, shipped: 0, transit: 0, delivered: 0, rto: 0 };
  }

  // Populate daily counts using category-specific dates
  productionOrders.forEach(o => {
    if (isOrderCancelled(o)) return;

    // 1. Count order received date
    const orderDate = new Date(o.created_at);
    const orderDateKey = orderDate.toISOString().split('T')[0];
    if (dailyCounts[orderDateKey]) {
      dailyCounts[orderDateKey].received++;
    }

    // 2. Count fulfillment dates (shipped, transit, delivered, rto)
    if (o.fulfillment_status === 'fulfilled') {
      const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
      const fDateKey = fDate.toISOString().split('T')[0];

      if (dailyCounts[fDateKey]) {
        dailyCounts[fDateKey].shipped++;
        if (isShiprocketInTransitStatus(o)) {
          dailyCounts[fDateKey].transit++;
        } else if (isShiprocketDeliveredStatus(o)) {
          dailyCounts[fDateKey].delivered++;
        } else if (isActiveRtoStatus(o)) {
          dailyCounts[fDateKey].rto++;
        }
      }
    }
  });

  // Construct performance table and trend lists
  const orderCountsTrend: number[] = [];
  Object.keys(dailyCounts).sort().forEach(dateKey => {
    const stats = dailyCounts[dateKey];
    orderCountsTrend.push(stats.received);

    const d = new Date(dateKey);
    const displayDate = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    performanceTable.push({
      date: displayDate,
      ordersReceived: stats.received,
      shipped: stats.shipped,
      inTransit: stats.transit,
      delivered: stats.delivered,
      rto: stats.rto
    });
  });

  // Today's Distribution (events that happened today)
  const distShipped = productionOrders.filter(o => {
    if (isOrderCancelled(o) || o.fulfillment_status !== 'fulfilled') return false;
    const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
    return fDate >= todayStart && fDate <= todayEnd;
  }).length;

  const distInTransit = productionOrders.filter(o => {
    if (isOrderCancelled(o) || !isShiprocketInTransitStatus(o)) return false;
    const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
    return fDate >= todayStart && fDate <= todayEnd;
  }).length;

  const distDelivered = productionOrders.filter(o => {
    if (isOrderCancelled(o) || !isShiprocketDeliveredStatus(o)) return false;
    const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
    return fDate >= todayStart && fDate <= todayEnd;
  }).length;

  const distRto = productionOrders.filter(o => {
    if (isOrderCancelled(o) || !isActiveRtoStatus(o)) return false;
    const fDate = new Date(o.fulfillments?.[0]?.created_at || o.created_at);
    return fDate >= todayStart && fDate <= todayEnd;
  }).length;

  // Weekly Business Snapshot (using This Week / Period data)
  const totalOrdersReceived = kpisThisWeek.ordersReceived;
  const totalDelivered = kpisThisWeek.deliveredOrders;
  const totalRTO = kpisThisWeek.rtoOrders;
  const fulfillmentRate = totalOrdersReceived > 0 ? parseFloat(((kpisThisWeek.shippedOrders / totalOrdersReceived) * 100).toFixed(1)) : 0;
  const rtoPercentage = totalOrdersReceived > 0 ? parseFloat(((totalRTO / totalOrdersReceived) * 100).toFixed(1)) : 0;

  // Operational Insights: dynamic generation
  const insights: string[] = [];
  
  // 1. Orders change
  const orderDiff = totalOrdersReceived - kpisPrevWeek.ordersReceived;
  const orderPct = kpisPrevWeek.ordersReceived > 0 ? Math.round((orderDiff / kpisPrevWeek.ordersReceived) * 100) : 0;
  if (orderDiff >= 0) {
    insights.push(`✓ Orders increased by ${orderPct}% compared to previous week (+${orderDiff} orders)`);
  } else {
    insights.push(`✓ Orders decreased by ${Math.abs(orderPct)}% compared to previous week (${orderDiff} orders)`);
  }

  // 2. Deliveries change
  const deliveryDiff = totalDelivered - kpisPrevWeek.deliveredOrders;
  const deliveryPct = kpisPrevWeek.deliveredOrders > 0 ? Math.round((deliveryDiff / kpisPrevWeek.deliveredOrders) * 100) : 0;
  if (deliveryDiff >= 0) {
    insights.push(`✓ Deliveries increased by ${deliveryPct}% compared to previous week (+${deliveryDiff} delivered)`);
  } else {
    insights.push(`✓ Deliveries decreased by ${Math.abs(deliveryPct)}% compared to previous week (${deliveryDiff} delivered)`);
  }

  // 3. RTO change
  const rtoDiff = totalRTO - kpisPrevWeek.rtoOrders;
  const rtoPct = kpisPrevWeek.rtoOrders > 0 ? Math.round((rtoDiff / kpisPrevWeek.rtoOrders) * 100) : 0;
  if (rtoDiff <= 0) {
    insights.push(`✓ RTO reduced by ${Math.abs(rtoPct)}% compared to previous week (${rtoDiff} RTOs)`);
  } else {
    insights.push(`✓ RTO increased by ${rtoPct}% compared to previous week (+${rtoDiff} RTOs)`);
  }

  // 4. Fulfillment rate change
  const prevFulfillmentRate = kpisPrevWeek.ordersReceived > 0 ? parseFloat(((kpisPrevWeek.shippedOrders / kpisPrevWeek.ordersReceived) * 100).toFixed(1)) : 0;
  const fulfillmentDiff = fulfillmentRate - prevFulfillmentRate;
  if (fulfillmentDiff >= 0) {
    insights.push(`✓ Fulfillment rate improved by ${fulfillmentDiff.toFixed(1)}% compared to previous week`);
  } else {
    insights.push(`✓ Fulfillment rate declined by ${Math.abs(fulfillmentDiff).toFixed(1)}% compared to previous week`);
  }

  // Performance Analysis
  const highRtoWarning = rtoPercentage > 15;
  const lowDeliveryRateWarning = kpisThisWeek.shippedOrders > 0 && kpisThisWeek.deliveryRate < 60;

  // Find Peak Shipment and Best Performing Days in the 7 days performance table
  let peakShipmentDay = 'N/A';
  let peakShipmentCount = 0;
  let bestPerformingDay = 'N/A';
  let bestPerformingCount = 0;

  performanceTable.forEach(row => {
    if (row.shipped > peakShipmentCount) {
      peakShipmentCount = row.shipped;
      peakShipmentDay = row.date;
    }
    if (row.delivered > bestPerformingCount) {
      bestPerformingCount = row.delivered;
      bestPerformingDay = row.date;
    }
  });

  // Calculate Growth / Decline Trend
  // We can look at the slope of the last 3 days vs the first 3 days of the 7-day trend
  const firstHalfSum = orderCountsTrend.slice(0, 3).reduce((a, b) => a + b, 0);
  const secondHalfSum = orderCountsTrend.slice(4, 7).reduce((a, b) => a + b, 0);
  let growthTrend = 'Stable';
  let declineTrend = 'None';
  
  if (secondHalfSum > firstHalfSum * 1.1) {
    growthTrend = 'Strong upward trend in volume (+ ' + Math.round(((secondHalfSum - firstHalfSum) / (firstHalfSum || 1)) * 100) + '%)';
    declineTrend = 'None';
  } else if (secondHalfSum < firstHalfSum * 0.9) {
    growthTrend = 'Stable';
    declineTrend = 'Downward volume contraction detected (- ' + Math.round(((firstHalfSum - secondHalfSum) / (firstHalfSum || 1)) * 100) + '%)';
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
  };
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  };

  return {
    reportDateStr: formatDate(periodEnd),
    generatedTimeStr: formatTime(now),
    startDateStr: formatDate(periodStart),
    endDateStr: formatDate(periodEnd),
    kpis: {
      today: kpisToday,
      thisWeek: kpisThisWeek
    },
    trendData: {
      dates: datesList,
      orderCounts: orderCountsTrend
    },
    distribution: {
      shipped: distShipped,
      inTransit: distInTransit,
      delivered: distDelivered,
      rto: distRto
    },
    performanceTable,
    weeklySnapshot: {
      totalOrdersReceived,
      totalDelivered,
      totalRTO,
      fulfillmentRate,
      rtoPercentage
    },
    operationalInsights: insights,
    performanceAnalysis: {
      highRtoWarning,
      lowDeliveryRateWarning,
      peakShipmentDay,
      peakShipmentCount,
      bestPerformingDay,
      bestPerformingCount,
      growthTrend,
      declineTrend
    }
  };
}
