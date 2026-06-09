import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/src/firebase/firebase.config';
import admin from 'firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const stage = searchParams.get('stage') || '';
    const status = searchParams.get('status') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const app = getFirebaseAdmin();
    const db = admin.firestore(app);

    // Fetch journeys sorted by deliveredAt desc
    let query: admin.firestore.Query = db.collection('customerJourneys').orderBy('deliveredAt', 'desc');

    const snapshot = await query.get();
    let journeys = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as any[];

    // Apply filters in-memory
    if (search) {
      const q = search.toLowerCase();
      journeys = journeys.filter(
        (j) =>
          j.orderId?.toLowerCase().includes(q) ||
          j.customerPhone?.includes(q) ||
          j.customerName?.toLowerCase().includes(q)
      );
    }

    if (stage && stage !== 'all') {
      journeys = journeys.filter((j) => j.currentStage === stage);
    }

    if (status && status !== 'all') {
      journeys = journeys.filter((j) => {
        if (status === 'completed') return j.currentStage === 'COMPLETED';
        if (status === 'failed') return !!j.lastError;
        if (status === 'active') return j.currentStage !== 'COMPLETED';
        return true;
      });
    }

    if (startDate) {
      const start = new Date(startDate);
      journeys = journeys.filter((j) => j.deliveredAt?.toDate() >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      journeys = journeys.filter((j) => j.deliveredAt?.toDate() <= end);
    }

    const total = journeys.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedJourneys = journeys.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      journeys: paginatedJourneys,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    }, { status: 200 });

  } catch (error: any) {
    console.error('❌ GET /api/crm/customer-journeys error:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch customer journeys',
    }, { status: 500 });
  }
}
