const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

async function main() {
  // Load .env
  if (fs.existsSync('.env')) {
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }
    console.log('✅ Loaded .env config successfully.');
  } else {
    throw new Error('.env file not found.');
  }

  // Firebase initialization for test orders lookup
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  let testOrderIds = new Set();
  if (projectId && clientEmail && privateKey) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      const db = admin.firestore();
      const testOrderSnapshot = await db.collection('test_orders').get();
      testOrderSnapshot.forEach(doc => {
        testOrderIds.add(String(doc.id));
      });
      console.log(`✅ Loaded ${testOrderIds.size} test order IDs from Firestore.`);
    } catch (firebaseErr) {
      console.warn('⚠️ Firebase initialization failed, proceeding without test orders filter:', firebaseErr.message);
    }
  }

  const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN;
  const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01';
  const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  // 1. Fetch Shopify Orders
  async function fetchAllShopifyOrders() {
    console.log('🔄 Fetching Shopify orders...');
    let shopifyOrders = [];
    let nextUrl = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=250&status=any`;
    
    while (nextUrl) {
      const res = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_TOKEN,
        },
      });

      if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.orders)) {
        shopifyOrders = shopifyOrders.concat(data.orders);
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
    return shopifyOrders;
  }

  // 2. Fetch Shiprocket Orders
  async function getAllShiprocketOrders() {
    console.log('🔄 Fetching Shiprocket orders...');
    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;
    const baseUrl = 'https://apiv2.shiprocket.in/v1/external';

    const authRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!authRes.ok) {
      console.warn('⚠️ Shiprocket login failed.');
      return [];
    }
    const authData = await authRes.json();
    const token = authData.token;

    const ordersRes = await fetch(`${baseUrl}/orders?per_page=100&page=1`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    if (!ordersRes.ok) return [];
    const data = await ordersRes.json();
    let allOrders = data?.data ?? data?.orders ?? [];
    if (!Array.isArray(allOrders)) allOrders = [];

    const totalPages = data?.meta?.pagination?.total_pages;
    if (typeof totalPages === 'number' && totalPages > 1) {
      const remainingPromises = [];
      for (let p = 2; p <= totalPages; p++) {
        remainingPromises.push(
          fetch(`${baseUrl}/orders?per_page=100&page=${p}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          }).then(res => res.json())
        );
      }

      const results = await Promise.all(remainingPromises);
      results.forEach(res => {
        const list = res?.data ?? res?.orders ?? [];
        if (Array.isArray(list)) {
          allOrders = allOrders.concat(list);
        }
      });
    }
    return allOrders;
  }

  const [shopify, shiprocket] = await Promise.all([
    fetchAllShopifyOrders(),
    getAllShiprocketOrders(),
  ]);

  console.log(`📊 Retrieved ${shopify.length} Shopify and ${shiprocket.length} Shiprocket orders.`);

  // Combine and deduplicate
  const shopifyMap = new Map();
  shopify.forEach((order) => {
    if (order.name) {
      const cleanName = order.name.replace(/^#/, '').trim().toLowerCase();
      shopifyMap.set(cleanName, order);
    }
    if (order.id) {
      shopifyMap.set(String(order.id), order);
    }
  });

  const customOrders = [];
  shiprocket.forEach((srOrder) => {
    const cleanSrName = String(srOrder.channel_order_id || '').replace(/^#/, '').trim().toLowerCase();
    const matchedShopify = shopifyMap.get(cleanSrName);
    const latestShipment = srOrder.shipments?.[0];
    const tracking_number = latestShipment?.awb || srOrder.last_mile_awb || null;
    const tracking_company = latestShipment?.courier || srOrder.last_mile_courier_name || null;
    const tracking_url = srOrder.last_mile_awb_track_url || null;

    const srStatus = (srOrder.status || '').toLowerCase();
    let shipment_status = null;
    if (srStatus.includes('rto') || srStatus.includes('returned')) {
      shipment_status = 'rto';
    } else if (srStatus.includes('undelivered') || srStatus.includes('fail') || srStatus.includes('error')) {
      shipment_status = 'failure';
    } else if (srStatus.includes('delivered')) {
      shipment_status = 'delivered';
    } else if (srStatus.includes('transit') || srStatus.includes('out for delivery')) {
      shipment_status = 'in_transit';
    }

    if (matchedShopify) {
      if (tracking_number) {
        matchedShopify.fulfillment_status = 'fulfilled';
        matchedShopify.fulfillments = [{
          tracking_number,
          tracking_company,
          tracking_url,
          shipment_status,
        }];
      }
    } else {
      const isCod = (srOrder.payment_method || '').toLowerCase() === 'cod';
      customOrders.push({
        id: srOrder.id,
        name: srOrder.channel_order_id ? (srOrder.channel_order_id.startsWith('#') ? srOrder.channel_order_id : '#' + srOrder.channel_order_id) : `#SR-${srOrder.id}`,
        created_at: srOrder.created_at,
        financial_status: isCod ? 'pending' : 'paid',
        fulfillment_status: tracking_number ? 'fulfilled' : null,
        total_price: String(srOrder.total || '0'),
        customer: {
          first_name: srOrder.customer_name || 'Manual Customer',
          last_name: '',
          email: srOrder.customer_email || '',
          phone: srOrder.customer_phone || '',
        },
        fulfillments: tracking_number ? [{
          tracking_number,
          tracking_company,
          tracking_url,
          shipment_status,
        }] : [],
        source: 'shiprocket',
      });
    }
  });

  const combined = shopify.concat(customOrders);

  // Filter for RTO orders in the past 7 days (June 1st, 2026 to June 8th, 2026)
  const cutOffDate = new Date();
  cutOffDate.setDate(cutOffDate.getDate() - 7);
  cutOffDate.setHours(0, 0, 0, 0);

  console.log(`📅 Filtering RTO orders created since: ${cutOffDate.toLocaleDateString()}`);

  const rtoOrders = combined.filter(o => {
    // Exclude test orders
    const isTest = o.test === true || testOrderIds.has(String(o.id)) || o.is_test_order === true;
    if (isTest) return false;

    // Filter by date range
    const createdDate = new Date(o.created_at);
    if (createdDate < cutOffDate) return false;

    // Check if RTO status
    const isCancelled = !!o.cancelled_at ||
      ['voided', 'cancelled', 'refunded'].includes((o.financial_status || '').toLowerCase());
    if (isCancelled) return false;

    if (o.fulfillment_status === 'fulfilled') {
      const latest = o.fulfillments?.[0];
      const status = (latest?.shipment_status || '').toLowerCase();
      return ['failure', 'rto', 'returned'].includes(status);
    }

    return false;
  });

  console.log(`📉 Found ${rtoOrders.length} RTO orders from the past 7 days.`);

  // Write to CSV
  const csvHeaders = [
    'Order ID',
    'Order Name',
    'Date Created',
    'Customer Name',
    'Customer Phone',
    'Customer Email',
    'Total Price',
    'Financial Status',
    'Courier Partner',
    'AWB/Tracking Number',
    'Shipment Status',
    'Source'
  ];

  const csvRows = rtoOrders.map(o => {
    const custName = o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : 'N/A';
    const latestFulfillment = o.fulfillments?.[0] || {};
    return [
      `"${o.id}"`,
      `"${o.name || ''}"`,
      `"${o.created_at}"`,
      `"${custName.replace(/"/g, '""')}"`,
      `"${o.customer?.phone || o.shipping_address?.phone || ''}"`,
      `"${o.customer?.email || ''}"`,
      `"${o.total_price || '0'}"`,
      `"${o.financial_status || ''}"`,
      `"${latestFulfillment.tracking_company || ''}"`,
      `"${latestFulfillment.tracking_number || ''}"`,
      `"${latestFulfillment.shipment_status || ''}"`,
      `"${o.source || 'shopify'}"`
    ].join(',');
  });

  const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
  const csvOutputPath = path.join(process.cwd(), 'rto_orders_past_7_days.csv');

  fs.writeFileSync(csvOutputPath, csvContent, 'utf-8');
  console.log(`✅ CSV exported successfully to: ${csvOutputPath}`);

  // Also print a markdown preview of the first 15 orders
  console.log('\n--- PREVIEW ---');
  console.log('| Order | Date | Customer | Phone | Total | Courier | Status |');
  console.log('|---|---|---|---|---|---|---|');
  rtoOrders.forEach(o => {
    const custName = o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : 'N/A';
    const latestFulfillment = o.fulfillments?.[0] || {};
    console.log(`| ${o.name || o.id} | ${new Date(o.created_at).toLocaleDateString()} | ${custName} | ${o.customer?.phone || ''} | ₹${o.total_price} | ${latestFulfillment.tracking_company || 'N/A'} | ${latestFulfillment.shipment_status || 'N/A'} |`);
  });
}

main().catch(console.error);
