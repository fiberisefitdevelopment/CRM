const dotenv = require('dotenv');
dotenv.config();

const { getAllShiprocketOrders } = require('./src/services/shiprocketClient');
const { getCachedOrders } = require('./src/services/ordersCache');
const { syncOrders, getReportData } = require('./src/reports/service');

async function main() {
  try {
    console.log('🔍 Fetching all Shiprocket orders (live)...');
    const orders = await getAllShiprocketOrders();
    console.log(`📦 Total Shiprocket orders fetched: ${orders.length}`);

    // Filter orders containing "rto" or "return" in status
    const rtoOrders = orders.filter((o: any) => {
      const status = (o.status || '').toLowerCase();
      return status.includes('rto') || status.includes('return');
    });

    console.log(`🚨 Shiprocket RTO/Returned count in API response: ${rtoOrders.length}`);
    
    // Print details of RTO orders found
    console.log('\n--- First 20 RTO Orders in Shiprocket API ---');
    rtoOrders.slice(0, 20).forEach((o: any, index: number) => {
      console.log(`${index + 1}. ID: ${o.id} | Channel Order ID: ${o.channel_order_id} | Status: "${o.status}" | Updated: ${o.updated_at} | Created: ${o.created_at}`);
    });

    // Run cache sync
    console.log('\nSyncing cache...');
    const cached = await syncOrders();
    console.log(`💾 Total cached orders: ${cached.length}`);

    const cachedRtos = cached.filter((o: any) => {
      if (o.fulfillment_status === 'fulfilled') {
        const latest = o.fulfillments?.[0];
        const status = (latest?.shipment_status || '').toLowerCase();
        return ['failure', 'rto', 'returned'].includes(status);
      }
      return false;
    });
    console.log(`💾 Total RTO orders found in our cache: ${cachedRtos.length}`);

    console.log('\n--- First 20 RTO Orders in Cache ---');
    cachedRtos.slice(0, 20).forEach((o: any, idx: number) => {
      const shipStatus = o.fulfillments?.[0]?.shipment_status;
      const trackingCompany = o.fulfillments?.[0]?.tracking_company;
      console.log(`${idx + 1}. Name: ${o.name} | Source: ${o.source} | Fulfillment: ${o.fulfillment_status} | Shipment Status: "${shipStatus}" | Courier: "${trackingCompany}" | Created: ${o.created_at}`);
    });

    console.log('\n📊 Computing Report Data for Last 7 Days...');
    const report = await getReportData();
    console.log(`📈 Weekly Snapshot KPI - RTO Orders: ${report.weeklySnapshot.totalRTO}`);
    console.log(`📈 Weekly Snapshot KPI - Delivered Orders: ${report.weeklySnapshot.totalDelivered}`);
    console.log(`📈 Weekly Snapshot KPI - Orders Received: ${report.weeklySnapshot.totalOrdersReceived}`);
    console.log('\n📅 7-Day Daily Performance Table:');
    console.table(report.performanceTable);

  } catch (err) {
    console.error('Error running check:', err);
  }
}

main();
