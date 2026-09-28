/**
 * POST /api/ingest — webhook / companion-app receiver.
 *
 * Reads docs/ARCHITECTURE.md §3 as a hard constraint: the server is not allowed to
 * become a store of financial data. This route therefore only validates and
 * *parses* what it is sent (via the same `ChannelAdapter`s the client uses) and
 * returns normalized `ParsedTransaction[]` in the response body. It writes to no
 * database of its own — there isn't one — and the caller (the PWA, running
 * `ingestRawEvent` client-side against its local Dexie DB) is responsible for
 * persisting anything.
 *
 * Auth: a shared secret, checked against `INGEST_SHARED_SECRET`. If that variable
 * is unset, the route refuses to serve in production rather than silently
 * becoming an open endpoint; in development it is left open so local companion-app
 * testing doesn't require provisioning a secret.
 *
 * Rate limiting is a simple in-memory per-IP token count. It resets whenever the
 * server process restarts and is not shared across instances — acceptable for a
 * single-instance webhook receiver, not a substitute for a real edge rate limiter
 * if this is ever deployed behind multiple nodes.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { parseEvent } from '@/lib/core/ingest';
import type { ChannelId, ParsedTransaction, RawEvent } from '@/lib/core/domain/types';

export const runtime = 'nodejs';
// This route computes nothing ahead of time and must always run per-request.
export const dynamic = 'force-dynamic';

const SHARED_SECRET_HEADER = 'x-ingest-secret';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Channels a server-side webhook can plausibly deliver. `manual`/`csv`/`share_target` are client-only. */
const REMOTE_CHANNEL_IDS = ['sms', 'email', 'account_aggregator', 'plaid', 'webhook'] as const satisfies readonly ChannelId[];

const IncomingEventSchema = z.object({
  channel: z.enum(REMOTE_CHANNEL_IDS),
  payload: z.string().trim().min(1, 'payload must not be empty').max(20_000),
  sender: z.string().max(200).optional(),
  receivedAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'receivedAt must be a parseable ISO instant')
    .optional(),
  meta: z.record(z.unknown()).optional(),
});

const BodySchema = z.union([
  z.object({ events: z.array(IncomingEventSchema).min(1).max(100) }),
  IncomingEventSchema,
]);

function genEventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

// ---------------------------------------------------------------------------
// In-memory per-IP rate limit
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const configuredSecret = process.env.INGEST_SHARED_SECRET;

  if (!configuredSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        {
          error:
            'Ingest endpoint is disabled: INGEST_SHARED_SECRET is not configured in production. Set it (see .env.example) rather than run this open.',
        },
        { status: 503 },
      );
    }
    // Development/test only: no secret configured, endpoint left open for local
    // companion-app work. Never true in production — checked above.
  } else {
    const provided = req.headers.get(SHARED_SECRET_HEADER);
    if (!provided || provided !== configuredSecret) {
      return NextResponse.json({ error: `Missing or invalid ${SHARED_SECRET_HEADER} header.` }, { status: 401 });
    }
  }

  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsedBody = BodySchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body.',
        issues: parsedBody.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }

  const incomingEvents = 'events' in parsedBody.data ? parsedBody.data.events : [parsedBody.data];

  const results = incomingEvents.map((incoming) => {
    const rawEvent: RawEvent = {
      id: genEventId(),
      channel: incoming.channel,
      receivedAt: incoming.receivedAt ?? new Date().toISOString(),
      payload: incoming.payload,
      sender: incoming.sender,
      meta: incoming.meta,
    };

    let transactions: ParsedTransaction[] = [];
    let error: string | undefined;
    try {
      transactions = parseEvent(rawEvent);
    } catch (err) {
      error = (err as Error).message;
    }

    return { rawEvent, transactions, error };
  });

  return NextResponse.json(
    {
      // Nothing above this line ever touched a database — the client persists.
      results,
      totals: {
        events: results.length,
        transactions: results.reduce((n, r) => n + r.transactions.length, 0),
        errors: results.filter((r) => r.error).length,
      },
    },
    { status: 200 },
  );
}
