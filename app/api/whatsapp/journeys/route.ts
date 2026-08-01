/**
 * WhatsApp Journeys API
 *
 * GET  /api/whatsapp/journeys        — List all journeys (with optional status filter)
 * PATCH /api/whatsapp/journeys       — Update journey status (pause/resume/complete)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllJourneys,
  updateJourneyStatus,
  getCustomerById,
} from '@/src/services/firestore.service';
import { optionalAuth } from '@/src/services/auth';
import { logAction } from '@/src/services/auditLogService';

async function getSessionInfo(req: NextRequest) {
  const session = await optionalAuth(req);
  return {
    email: session?.email || 'system@fiberisefit.com',
    userId: session?.id || session?.email || 'system',
    role: session?.role || 'unknown',
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'all';

    const journeys = await getAllJourneys(status);

    // Enrich journeys with customer details
    const enriched = await Promise.all(
      journeys.map(async (journey) => {
        const customer = await getCustomerById(journey.customerId);
        return {
          ...journey,
          customerName: customer?.customerName || 'Unknown',
          customerPhone: customer?.phone || '',
          customerEmail: customer?.email || '',
          // Convert Firestore Timestamps to ISO strings for JSON
          orderDate: journey.orderDate?.toDate?.()?.toISOString() || null,
          nextMessageDate: journey.nextMessageDate?.toDate?.()?.toISOString() || null,
          createdAt: journey.createdAt?.toDate?.()?.toISOString() || null,
        };
      })
    );

    return NextResponse.json({ journeys: enriched }, { status: 200 });
  } catch (error: any) {
    console.error('❌ Error fetching journeys:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch journeys' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { journeyId, status } = body;

    if (!journeyId || !status) {
      return NextResponse.json(
        { error: 'journeyId and status are required' },
        { status: 400 }
      );
    }

    if (!['active', 'paused', 'completed'].includes(status)) {
      return NextResponse.json(
        { error: 'Status must be: active, paused, or completed' },
        { status: 400 }
      );
    }

    await updateJourneyStatus(journeyId, status);

    // Trace action
    const { userId, email } = await getSessionInfo(req);
    logAction({
      userId,
      userEmail: email,
      actionType: 'UPDATE_JOURNEY_STATUS',
      description: `Updated journey ${journeyId} status to "${status}"`,
      module: 'whatsapp',
      status: 'success',
      details: { journeyId, status },
      req,
    });

    return NextResponse.json(
      { success: true, journeyId, status },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('❌ Error updating journey:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update journey' },
      { status: 500 }
    );
  }
}
