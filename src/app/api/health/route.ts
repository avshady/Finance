/**
 * GET /api/health — trivial liveness probe. No secrets, no environment dump, no
 * database (this app has none server-side — see docs/ARCHITECTURE.md §3).
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
