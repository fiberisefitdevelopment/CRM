export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { handleDownloadReport } from '@/src/reports/controller';

/**
 * GET /api/reports/shipment/download
 * Generates and returns a downloadable Enterprise Daily/Weekly Shipment & Fulfillment Report in PDF format.
 *
 * Query Parameters:
 *  - startDate (ISO string or YYYY-MM-DD, optional)
 *  - endDate (ISO string or YYYY-MM-DD, optional)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    // Orchestrate data fetching, HTML rendering, and PDF compilation
    const pdfBuffer = await handleDownloadReport(startDate, endDate);

    // Build standard filename based on duration end date
    const datePart = endDate ? endDate.split('T')[0] : new Date().toISOString().split('T')[0];
    const filename = `daily_shipment_report_${datePart}.pdf`;

    // Return application/pdf download stream response
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    });
  } catch (error: any) {
    console.error('❌ GET /api/reports/shipment/download failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate and compile PDF shipment report' },
      { status: 500 }
    );
  }
}
