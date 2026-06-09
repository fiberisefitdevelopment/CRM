import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/src/firebase/firebase.config';
import admin from 'firebase-admin';
import { retryJourneyStage, triggerJourneyMessageManually } from '@/src/services/customerJourney.service';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id); // Decode order name containing #

    const app = getFirebaseAdmin();
    const db = admin.firestore(app);

    // 1. Fetch the journey document
    const doc = await db.collection('customerJourneys').doc(decodedId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
    }

    const journeyData = { id: doc.id, ...doc.data() };

    // 2. Fetch all logs for this journey
    const logsSnapshot = await db
      .collection('customerJourneyLogs')
      .where('journeyId', '==', decodedId)
      .get();

    const logs = logsSnapshot.docs.map((logDoc) => ({
      id: logDoc.id,
      ...logDoc.data(),
    })) as any[];

    // Sort in memory by sentAt desc
    logs.sort((a, b) => {
      const aTime = a.sentAt?.seconds || 0;
      const bTime = b.sentAt?.seconds || 0;
      return bTime - aTime;
    });

    return NextResponse.json({
      journey: journeyData,
      logs,
    }, { status: 200 });

  } catch (error: any) {
    console.error('❌ GET /api/crm/customer-journeys/[id] error:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch journey details',
    }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);

    const body = await req.json().catch(() => null);
    if (!body || !body.action) {
      return NextResponse.json({ error: 'Missing action field in request body' }, { status: 400 });
    }

    const { action, stage } = body;

    let result;
    if (action === 'retry') {
      result = await retryJourneyStage(decodedId);
    } else if (action === 'trigger') {
      if (!stage) {
        return NextResponse.json({ error: 'Missing stage field for manual trigger' }, { status: 400 });
      }
      result = await triggerJourneyMessageManually(decodedId, stage);
    } else {
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      result,
    }, { status: 200 });

  } catch (error: any) {
    console.error(`❌ POST /api/crm/customer-journeys/[id] (${error.message}) error:`, error);
    return NextResponse.json({
      error: error.message || 'Action execution failed',
    }, { status: 500 });
  }
}
