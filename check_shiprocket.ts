import { getAllShiprocketOrders } from './src/services/shiprocketClient';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  try {
    console.log('🔍 Fetching all Shiprocket orders...');
    const orders = await getAllShiprocketOrders();
    console.log(`📦 Total Shiprocket orders fetched: ${orders.length}`);

    // Filter orders containing "rto" in status
    const rtoOrders = orders.filter(o => {
      const status = (o.status || '').toLowerCase();
      return status.includes('rto') || status.includes('return');
    });

    console.log(`🚨 Shiprocket RTO/Returned count in API response: ${rtoOrders.length}`);
    
    // Print details of the first 15 RTO orders found
    console.log('\n--- First 15 RTO Orders ---');
    rtoOrders.slice(0, 15).forEach((o, index) => {
      console.log(`${index + 1}. ID: ${o.id} | Channel Order ID: ${o.channel_order_id} | Status: "${o.status}" | Created: ${o.created_at}`);
    });

    // Check how many are present in cached orders
    const { getCachedOrders } = require('./src/services/ordersCache');
    // Let's load the cache (if empty, we sync it)
    let cached = getCachedOrders();
    if (!cached || cached.length === 0) {
      console.log('Cache is empty. Simulating sync...');
      const { syncOrders } = require('./src/reports/service');
      cached = await syncOrders();
    }
    console.log(`\n💾 Total cached orders: ${cached.length}`);

    const cachedRtos = cached.filter((o: any) => {
      if (o.fulfillment_status === 'fulfilled') {
        const latest = o.fulfillments?.[0];
        const status = (latest?.shipment_status || '').toLowerCase();
        return ['failure', 'rto', 'returned'].includes(status);
      }
      return false;
    });
    console.log(`💾 Total RTO orders found in our cache: ${cachedRtos.length}`);

    console.log('\n--- First 15 RTO Orders in Cache ---');
    cachedRtos.slice(0, 15).forEach((o: any, idx: number) => {
      const shipStatus = o.fulfillments?.[0]?.shipment_status;
      console.log(`${idx + 1}. Name: ${o.name} | Source: ${o.source} | Fulfillment Status: ${o.fulfillment_status} | Shipment Status: "${shipStatus}" | Created: ${o.created_at}`);
    });

  } catch (err) {
    console.error('Error running check:', err);
  }
}

main();
