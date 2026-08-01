export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireRole, authErrorResponse } from '@/src/services/auth';
import { getActionLogsPaginated } from '@/src/services/auditLogService';

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, 'admin', 'super_admin');

    // 2. Parse query parameters
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') || '25', 10)));
    const actionType = searchParams.get('action_type') || undefined;
    const module = searchParams.get('module') || undefined;
    const userEmail = searchParams.get('user') || undefined;
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;
    const ipAddress = searchParams.get('ip') || undefined;

    // 3. Fetch paginated + filtered logs
    const { logs, total } = await getActionLogsPaginated({
      page,
      perPage,
      actionType,
      module,
      userEmail,
      status,
      search,
      startDate,
      endDate,
      ipAddress,
    });

    const totalPages = Math.ceil(total / perPage) || 1;

    return NextResponse.json({
      success: true,
      logs,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: totalPages,
      },
    }, { status: 200 });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return authErrorResponse(error);
    }
    console.error('❌ Error fetching audit logs:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}
