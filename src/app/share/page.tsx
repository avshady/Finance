/**
 * Web Share Target landing page (docs/ARCHITECTURE.md §2/§8): the genuinely
 * real-time ingest path on Android — long-press a bank SMS, share it to the
 * installed PWA, and it lands as a transaction in seconds.
 *
 * `public/manifest.webmanifest` declares `share_target` posting multipart form
 * data to `/share`; `public/sw.js` intercepts that POST and redirects here as a
 * GET with `?text=...` (a Next.js page can only ever respond to GET). This page
 * also accepts `?text=` directly, so it works the same way whether the text
 * arrived via the share sheet or was pasted/typed by hand.
 */

import ShareClient from './ShareClient';

interface SharePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const initialText = firstString(params.text);

  return <ShareClient initialText={initialText} />;
}
