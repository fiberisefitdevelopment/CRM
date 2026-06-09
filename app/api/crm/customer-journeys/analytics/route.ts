import { NextRequest, NextResponse } from 'next/server';
import { getCustomerJourneyAnalytics } from '@/src/services/customerJourney.service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const analytics = await getCustomerJourneyAnalytics();
    return NextResponse.json(analytics, { status: 200 });
  } catch (error: any) {
    console.error('❌ GET /api/crm/customer-journeys/analytics error:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch customer journey analytics',
    }, { status: 500 });
  }
}
