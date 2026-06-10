/**
 * Customer Journey Service — WhatsApp Post-Delivery Automation
 *
 * Coordinates Firestore customerJourneys and customerJourneyLogs, and integrates
 * with the AiSensy template dispatchers.
 */

import { getFirebaseAdmin } from '@/src/firebase/firebase.config';
import admin from 'firebase-admin';
import {
  sendWelcomeTemplate,
  sendDay1Template,
  sendDay3Template,
  sendDay4Template,
  sendDay5Template,
} from './aisensy';
import { normalizePhoneNumber } from './whatsapp.service';

// ─── DB Helper ────────────────────────────────────────────────────────────────

function getDb() {
  const app = getFirebaseAdmin();
  return admin.firestore(app);
}

// ─── Journey Initializer / Sync Trigger ───────────────────────────────────────

/**
 * Scans a list of synced orders, identifies delivered ones, and starts their post-delivery journey.
 * Excludes test orders to avoid triggering live messages for simulated data.
 */
export async function checkAndTriggerDeliveryJourneys(orders: any[]): Promise<void> {
  const db = getDb();

  const deliveredOrders = orders.filter((o) => {
    // Skip if it is a test order
    if (o.is_test_order) return false;

    // Check shipment status inside fulfillments or on order root
    const shipmentStatus = (
      o.fulfillments?.[0]?.shipment_status ||
      o.shipment_status ||
      ''
    ).toLowerCase();

    return shipmentStatus === 'delivered';
  });

  if (deliveredOrders.length === 0) return;

  console.log(`🚚 Customer Journey: Found ${deliveredOrders.length} delivered orders in sync. Initiating journeys...`);

  for (const order of deliveredOrders) {
    const orderId = order.name || `#${order.id}`;
    
    try {
      const docRef = db.collection('customerJourneys').doc(orderId);
      const docSnapshot = await docRef.get();

      // If a journey document already exists, skip to prevent duplicates
      if (docSnapshot.exists) {
        continue;
      }

      // Extract customer details
      const customerName = [
        order.customer?.first_name || order.shipping_address?.first_name || '',
        order.customer?.last_name || order.shipping_address?.last_name || '',
      ]
        .join(' ')
        .trim() || 'Customer';

      const customerPhone =
        order.customer?.phone ||
        order.shipping_address?.phone ||
        order.phone ||
        '';

      if (!customerPhone) {
        console.warn(`⚠️ Customer Journey: No phone number for order ${orderId} — skipping`);
        continue;
      }

      const orderAmount = parseFloat(order.total_price || '0');
      const products = (order.line_items || []).map((item: any) => item.title || 'Product');

      // Create new customer journey document
      const now = admin.firestore.Timestamp.now();
      
      const newJourney = {
        orderId,
        customerName,
        customerPhone: normalizePhoneNumber(customerPhone),
        deliveredAt: now,
        welcomeSent: false,
        day1Sent: false,
        day3Sent: false,
        day4Sent: false,
        day5Sent: false,
        welcomeSentAt: null,
        day1SentAt: null,
        day3SentAt: null,
        day4SentAt: null,
        day5SentAt: null,
        currentStage: 'DELIVERED',
        lastApiResponse: '',
        lastError: '',
        products,
        orderAmount,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(newJourney);
      console.log(`🚀 Customer Journey: Created document for order ${orderId}`);

      // Immediately send Day 0 Welcome template
      try {
        const response = await sendWelcomeTemplate(
          newJourney.customerPhone,
          newJourney.customerName,
          orderId,
          products,
          orderAmount
        );

        await docRef.update({
          welcomeSent: true,
          welcomeSentAt: admin.firestore.Timestamp.now(),
          lastApiResponse: JSON.stringify(response),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        await addCustomerJourneyLog({
          journeyId: orderId,
          orderId,
          stage: 'DELIVERED',
          templateName: 'FYBER Delivery Welcome',
          status: 'sent',
          apiResponse: JSON.stringify(response),
          error: '',
          triggeredBy: 'system',
          sentAt: admin.firestore.Timestamp.now(),
        });

        console.log(`✅ Customer Journey: Sent Welcome message for order ${orderId}`);
      } catch (sendErr: any) {
        const errMsg = sendErr.message || 'Failed to send welcome template';
        const errResp = sendErr.response?.data ? JSON.stringify(sendErr.response.data) : errMsg;

        await docRef.update({
          lastError: errMsg,
          lastApiResponse: errResp,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        await addCustomerJourneyLog({
          journeyId: orderId,
          orderId,
          stage: 'DELIVERED',
          templateName: 'FYBER Delivery Welcome',
          status: 'failed',
          apiResponse: errResp,
          error: errMsg,
          triggeredBy: 'system',
          sentAt: admin.firestore.Timestamp.now(),
        });

        console.error(`❌ Customer Journey: Welcome template failed for ${orderId}:`, errMsg);
      }

    } catch (err: any) {
      console.error(`❌ Customer Journey: Error processing order ${orderId}:`, err);
    }
  }
}

// ─── Cron execution logic ────────────────────────────────────────────────────

/**
 * Iterates over active journeys and dispatches Day 1, Day 3, or Day 4 follow-ups.
 * Runs at 4:00 PM IST (unless forced).
 */
export async function processPendingJourneys(force: boolean = false): Promise<any> {
  const now = new Date();
  
  // 1. Timezone Check (Must run at 4:00 PM IST / 16:00 to 16:15 IST window)
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  const istHour = istDate.getHours();
  const istMinute = istDate.getMinutes();

  const is4PmIST = istHour === 16 && istMinute >= 0 && istMinute < 15;

  if (!is4PmIST && !force) {
    console.log(`⏳ Customer Journey Scheduler: Skipped (current time: ${istHour}:${istMinute} IST, runs at 16:00 IST). Pass force=true to override.`);
    return { status: 'skipped', reason: 'outside_4pm_ist_window', timeIST: `${istHour}:${istMinute}` };
  }

  console.log(`⏰ Customer Journey Scheduler: Processing pending journeys (time: ${istHour}:${istMinute} IST)...`);

  const db = getDb();
  // Fetch journeys that are not completed yet
  const snapshot = await db
    .collection('customerJourneys')
    .where('currentStage', '!=', 'COMPLETED')
    .get();

  const stats = { total: snapshot.size, sent: 0, failed: 0, skipped: 0 };

  for (const doc of snapshot.docs) {
    const journey = doc.data();
    const journeyId = doc.id;

    try {
      // Calculate calendar days since delivery in IST
      const deliveredDate = journey.deliveredAt.toDate();
      const deliveredIST = new Date(deliveredDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const currentIST = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

      deliveredIST.setHours(0, 0, 0, 0);
      currentIST.setHours(0, 0, 0, 0);

      const diffTime = currentIST.getTime() - deliveredIST.getTime();
      const daysElapsed = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      console.log(`  📌 Journey ${journeyId}: Days elapsed: ${daysElapsed}, stage: ${journey.currentStage}`);

      // Route campaigns non-sequentially based on the exact calendar days elapsed since delivery
      if (daysElapsed >= 5) {
        if (journey.day5Sent) {
          if (journey.currentStage !== 'COMPLETED') {
            await doc.ref.update({ currentStage: 'COMPLETED', updatedAt: admin.firestore.Timestamp.now() });
          }
          stats.skipped++;
          continue;
        }

        try {
          const response = await sendDay5Template(journey.customerPhone, journey.customerName);
          
          await doc.ref.update({
            day5Sent: true,
            day5SentAt: admin.firestore.Timestamp.now(),
            currentStage: 'COMPLETED',
            lastApiResponse: JSON.stringify(response),
            lastError: '',
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY5',
            templateName: 'FYBER Day 5',
            status: 'sent',
            apiResponse: JSON.stringify(response),
            error: '',
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });

          stats.sent++;
        } catch (err: any) {
          stats.failed++;
          const errMsg = err.message || 'Failed to send Day 5';
          const errResp = err.response?.data ? JSON.stringify(err.response.data) : errMsg;

          await doc.ref.update({
            lastError: errMsg,
            lastApiResponse: errResp,
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY5',
            templateName: 'FYBER Day 5',
            status: 'failed',
            apiResponse: errResp,
            error: errMsg,
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });
        }

      } else if (daysElapsed === 4) {
        if (journey.day4Sent) {
          if (journey.currentStage !== 'DAY4' && journey.currentStage !== 'COMPLETED') {
            await doc.ref.update({ currentStage: 'DAY4', updatedAt: admin.firestore.Timestamp.now() });
          }
          stats.skipped++;
          continue;
        }

        try {
          const response = await sendDay4Template(journey.customerPhone, journey.customerName);
          
          await doc.ref.update({
            day4Sent: true,
            day4SentAt: admin.firestore.Timestamp.now(),
            currentStage: 'DAY4',
            lastApiResponse: JSON.stringify(response),
            lastError: '',
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY4',
            templateName: 'FYBER Benefits',
            status: 'sent',
            apiResponse: JSON.stringify(response),
            error: '',
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });

          stats.sent++;
        } catch (err: any) {
          stats.failed++;
          const errMsg = err.message || 'Failed to send Day 4';
          const errResp = err.response?.data ? JSON.stringify(err.response.data) : errMsg;

          await doc.ref.update({
            lastError: errMsg,
            lastApiResponse: errResp,
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY4',
            templateName: 'FYBER Benefits',
            status: 'failed',
            apiResponse: errResp,
            error: errMsg,
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });
        }

      } else if (daysElapsed === 3) {
        if (journey.day3Sent) {
          if (journey.currentStage !== 'DAY3' && journey.currentStage !== 'DAY4' && journey.currentStage !== 'COMPLETED') {
            await doc.ref.update({ currentStage: 'DAY3', updatedAt: admin.firestore.Timestamp.now() });
          }
          stats.skipped++;
          continue;
        }

        try {
          const response = await sendDay3Template(journey.customerPhone, journey.customerName, journey.orderId, journey.products || []);
          
          await doc.ref.update({
            day3Sent: true,
            day3SentAt: admin.firestore.Timestamp.now(),
            currentStage: 'DAY3',
            lastApiResponse: JSON.stringify(response),
            lastError: '',
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY3',
            templateName: 'FYBER Usage Tips',
            status: 'sent',
            apiResponse: JSON.stringify(response),
            error: '',
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });

          stats.sent++;
        } catch (err: any) {
          stats.failed++;
          const errMsg = err.message || 'Failed to send Day 3';
          const errResp = err.response?.data ? JSON.stringify(err.response.data) : errMsg;

          await doc.ref.update({
            lastError: errMsg,
            lastApiResponse: errResp,
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY3',
            templateName: 'FYBER Usage Tips',
            status: 'failed',
            apiResponse: errResp,
            error: errMsg,
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });
        }

      } else if (daysElapsed === 1 || daysElapsed === 2) {
        if (journey.day1Sent) {
          if (journey.currentStage !== 'DAY1' && journey.currentStage !== 'DAY3' && journey.currentStage !== 'DAY4' && journey.currentStage !== 'COMPLETED') {
            await doc.ref.update({ currentStage: 'DAY1', updatedAt: admin.firestore.Timestamp.now() });
          }
          stats.skipped++;
          continue;
        }

        try {
          const response = await sendDay1Template(journey.customerPhone, journey.customerName, journey.orderId);
          
          await doc.ref.update({
            day1Sent: true,
            day1SentAt: admin.firestore.Timestamp.now(),
            currentStage: 'DAY1',
            lastApiResponse: JSON.stringify(response),
            lastError: '',
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY1',
            templateName: 'FYBER Reminder',
            status: 'sent',
            apiResponse: JSON.stringify(response),
            error: '',
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });

          stats.sent++;
        } catch (err: any) {
          stats.failed++;
          const errMsg = err.message || 'Failed to send Day 1';
          const errResp = err.response?.data ? JSON.stringify(err.response.data) : errMsg;

          await doc.ref.update({
            lastError: errMsg,
            lastApiResponse: errResp,
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await addCustomerJourneyLog({
            journeyId,
            orderId: journey.orderId,
            stage: 'DAY1',
            templateName: 'FYBER Reminder',
            status: 'failed',
            apiResponse: errResp,
            error: errMsg,
            triggeredBy: 'system',
            sentAt: admin.firestore.Timestamp.now(),
          });
        }
      } else {
        stats.skipped++;
      }

    } catch (err) {
      stats.failed++;
      console.error(`💥 Customer Journey: Error running cron for journey ${journeyId}:`, err);
    }
  }

  console.log(`🏁 Customer Journey Cron finished. Sent: ${stats.sent}, Failed: ${stats.failed}, Skipped: ${stats.skipped}`);
  return stats;
}

// ─── Manual Controls / Admin Actions ─────────────────────────────────────────

/**
 * Retries the message corresponding to the current stage (the one that has failed).
 */
export async function retryJourneyStage(journeyId: string): Promise<any> {
  const db = getDb();
  const docRef = db.collection('customerJourneys').doc(journeyId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new Error('Journey not found');
  }

  const journey = doc.data() as any;
  const stage = journey.currentStage;

  let response;

  try {
    if (stage === 'DELIVERED') {
      response = await sendWelcomeTemplate(
        journey.customerPhone,
        journey.customerName,
        journey.orderId,
        journey.products || [],
        journey.orderAmount || 0
      );
    } else if (stage === 'DAY1') {
      response = await sendDay1Template(journey.customerPhone, journey.customerName, journey.orderId);
    } else if (stage === 'DAY3') {
      response = await sendDay3Template(journey.customerPhone, journey.customerName, journey.orderId, journey.products || []);
    } else if (stage === 'DAY4') {
      response = await sendDay4Template(journey.customerPhone, journey.customerName);
    } else if (stage === 'DAY5') {
      response = await sendDay5Template(journey.customerPhone, journey.customerName);
    } else {
      throw new Error(`Cannot retry: journey is already completed`);
    }

    const updates: any = {
      lastApiResponse: JSON.stringify(response),
      lastError: '',
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (stage === 'DELIVERED') {
      updates.welcomeSent = true;
      updates.welcomeSentAt = admin.firestore.Timestamp.now();
    } else if (stage === 'DAY1') {
      updates.day1Sent = true;
      updates.day1SentAt = admin.firestore.Timestamp.now();
    } else if (stage === 'DAY3') {
      updates.day3Sent = true;
      updates.day3SentAt = admin.firestore.Timestamp.now();
    } else if (stage === 'DAY4') {
      updates.day4Sent = true;
      updates.day4SentAt = admin.firestore.Timestamp.now();
      updates.currentStage = 'DAY4';
    } else if (stage === 'DAY5') {
      updates.day5Sent = true;
      updates.day5SentAt = admin.firestore.Timestamp.now();
      updates.currentStage = 'COMPLETED';
    }

    await docRef.update(updates);

    await addCustomerJourneyLog({
      journeyId,
      orderId: journey.orderId,
      stage,
      templateName: getTemplateNameForStage(stage),
      status: 'sent',
      apiResponse: JSON.stringify(response),
      error: '',
      triggeredBy: 'manual_retry',
      sentAt: admin.firestore.Timestamp.now(),
    });

    return response;
  } catch (err: any) {
    const errMsg = err.message || 'Retry failed';
    const errResp = err.response?.data ? JSON.stringify(err.response.data) : errMsg;

    await docRef.update({
      lastError: errMsg,
      lastApiResponse: errResp,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    await addCustomerJourneyLog({
      journeyId,
      orderId: journey.orderId,
      stage,
      templateName: getTemplateNameForStage(stage),
      status: 'failed',
      apiResponse: errResp,
      error: errMsg,
      triggeredBy: 'manual_retry',
      sentAt: admin.firestore.Timestamp.now(),
    });

    throw err;
  }
}

/**
 * Manually sends the template for the specified stage and advances currentStage.
 */
export async function triggerJourneyMessageManually(journeyId: string, stage: string): Promise<any> {
  const db = getDb();
  const docRef = db.collection('customerJourneys').doc(journeyId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new Error('Journey not found');
  }

  const journey = doc.data() as any;
  let response;

  try {
    if (stage === 'DELIVERED') {
      response = await sendWelcomeTemplate(
        journey.customerPhone,
        journey.customerName,
        journey.orderId,
        journey.products || [],
        journey.orderAmount || 0
      );
    } else if (stage === 'DAY1') {
      response = await sendDay1Template(journey.customerPhone, journey.customerName, journey.orderId);
    } else if (stage === 'DAY3') {
      response = await sendDay3Template(journey.customerPhone, journey.customerName, journey.orderId, journey.products || []);
    } else if (stage === 'DAY4') {
      response = await sendDay4Template(journey.customerPhone, journey.customerName);
    } else if (stage === 'DAY5') {
      response = await sendDay5Template(journey.customerPhone, journey.customerName);
    } else {
      throw new Error(`Invalid manual trigger stage: ${stage}`);
    }

    const updates: any = {
      lastApiResponse: JSON.stringify(response),
      lastError: '',
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (stage === 'DELIVERED') {
      updates.welcomeSent = true;
      updates.welcomeSentAt = admin.firestore.Timestamp.now();
    } else if (stage === 'DAY1') {
      updates.day1Sent = true;
      updates.day1SentAt = admin.firestore.Timestamp.now();
      if (journey.currentStage === 'DELIVERED') {
        updates.currentStage = 'DAY1';
      }
    } else if (stage === 'DAY3') {
      updates.day3Sent = true;
      updates.day3SentAt = admin.firestore.Timestamp.now();
      if (journey.currentStage === 'DELIVERED' || journey.currentStage === 'DAY1') {
        updates.currentStage = 'DAY3';
      }
    } else if (stage === 'DAY4') {
      updates.day4Sent = true;
      updates.day4SentAt = admin.firestore.Timestamp.now();
      if (journey.currentStage === 'DELIVERED' || journey.currentStage === 'DAY1' || journey.currentStage === 'DAY3') {
        updates.currentStage = 'DAY4';
      }
    } else if (stage === 'DAY5') {
      updates.day5Sent = true;
      updates.day5SentAt = admin.firestore.Timestamp.now();
      updates.currentStage = 'COMPLETED';
    }

    await docRef.update(updates);

    await addCustomerJourneyLog({
      journeyId,
      orderId: journey.orderId,
      stage,
      templateName: getTemplateNameForStage(stage),
      status: 'sent',
      apiResponse: JSON.stringify(response),
      error: '',
      triggeredBy: 'manual_trigger',
      sentAt: admin.firestore.Timestamp.now(),
    });

    return response;
  } catch (err: any) {
    const errMsg = err.message || 'Manual trigger failed';
    const errResp = err.response?.data ? JSON.stringify(err.response.data) : errMsg;

    await docRef.update({
      lastError: errMsg,
      lastApiResponse: errResp,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    await addCustomerJourneyLog({
      journeyId,
      orderId: journey.orderId,
      stage,
      templateName: getTemplateNameForStage(stage),
      status: 'failed',
      apiResponse: errResp,
      error: errMsg,
      triggeredBy: 'manual_trigger',
      sentAt: admin.firestore.Timestamp.now(),
    });

    throw err;
  }
}

// ─── Analytics ───────────────────────────────────────────────────────────────

/**
 * Computes dashboard aggregates for post-delivery customer journeys.
 */
export async function getCustomerJourneyAnalytics(): Promise<any> {
  const db = getDb();
  const snapshot = await db.collection('customerJourneys').get();

  let totalActive = 0;
  let completed = 0;
  let welcomeSent = 0;
  let day1Sent = 0;
  let day3Sent = 0;
  let day4Sent = 0;
  let day5Sent = 0;
  let failedMessages = 0;
  let pendingMessages = 0;

  snapshot.forEach((doc) => {
    const j = doc.data();
    const stage = j.currentStage;

    if (stage === 'COMPLETED') {
      completed++;
    } else {
      totalActive++;
    }

    if (j.welcomeSent) welcomeSent++;
    if (j.day1Sent) day1Sent++;
    if (j.day3Sent) day3Sent++;
    if (j.day4Sent) day4Sent++;
    if (j.day5Sent) day5Sent++;

    if (j.lastError) {
      failedMessages++;
    } else if (stage !== 'COMPLETED') {
      pendingMessages++;
    }
  });

  return {
    totalActive,
    completed,
    welcomeSent,
    day1Sent,
    day3Sent,
    day4Sent,
    day5Sent,
    failedMessages,
    pendingMessages,
  };
}

// ─── Logs & Helpers ──────────────────────────────────────────────────────────

export async function addCustomerJourneyLog(log: {
  journeyId: string;
  orderId: string;
  stage: string;
  templateName: string;
  status: 'sent' | 'failed';
  apiResponse: string;
  error: string;
  triggeredBy: 'system' | 'manual_retry' | 'manual_trigger';
  sentAt: admin.firestore.Timestamp;
}): Promise<void> {
  try {
    const db = getDb();
    await db.collection('customerJourneyLogs').add(log);
  } catch (err) {
    console.error('⚠️ Failed to save customer journey audit log:', err);
  }
}

function getTemplateNameForStage(stage: string): string {
  switch (stage) {
    case 'DELIVERED':
      return 'FYBER Delivery Welcome';
    case 'DAY1':
      return 'FYBER Reminder';
    case 'DAY3':
      return 'FYBER Usage Tips';
    case 'DAY4':
      return 'FYBER Benefits';
    case 'DAY5':
      return 'FYBER Day 5';
    default:
      return 'Unknown';
  }
}
