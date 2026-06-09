import { NextRequest, NextResponse } from 'next/server';
import { processPendingJourneys } from '@/src/services/customerJourney.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';

    const stats = await processPendingJourneys(force);

    return NextResponse.json({
      success: true,
      stats,
    }, { status: 200 });

  } catch (error: any) {
    console.error('❌ Customer Journey Cron Route Error:', error);
    
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error occurred during journey cron run',
    }, { status: 500 });
  }
}
