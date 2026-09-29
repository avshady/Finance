/**
 * Adapter registry: routes a RawEvent to the adapter that can parse it, and
 * exposes the truthful channel descriptor list for the Connectors UI.
 */

import type { ChannelAdapter, ChannelDescriptor, ChannelId, ParsedTransaction, RawEvent } from '../domain/types';
import { accountAggregatorAdapter } from './accountAggregator';
import { csvImporter } from './csvImporter';
import { emailParser } from './emailParser';
import { manualEntryAdapter } from './manualEntry';
import { plaidAdapter } from './plaidAdapter';
import { smsParser } from './smsParser';

export const ADAPTERS: ChannelAdapter[] = [
  manualEntryAdapter,
  csvImporter,
  smsParser,
  emailParser,
  accountAggregatorAdapter,
  plaidAdapter,
];

export function getAdapter(channel: ChannelId): ChannelAdapter | undefined {
  return ADAPTERS.find((a) => a.descriptor.id === channel);
}

/**
 * Text-capable adapters, in the order a share of unknown origin should be tried.
 * SMS first: a shared bank alert is an SMS far more often than an email body, and the
 * SMS templates are the stricter match, so trying them first avoids a loose email-shaped
 * parse claiming a message the SMS parser would have read precisely.
 */
const TEXT_ADAPTERS = [smsParser, emailParser] as const;

/**
 * Route a RawEvent to the adapter that should handle it.
 *
 * `share_target` needs its own path. It is not a channel with a format of its own - it is
 * a carrier, and what arrives is whatever the user long-pressed and shared: usually a
 * bank SMS, sometimes an email excerpt. Adapters gate on `channel`, so a shared SMS
 * matched no adapter at all and silently parsed to nothing, which broke the one
 * genuinely real-time path this app has. Text of unknown origin is therefore offered to
 * each text parser in turn, and the first that actually recognises something wins.
 */
export function parseEvent(event: RawEvent): ParsedTransaction[] {
  if (event.channel === 'share_target') {
    for (const adapter of TEXT_ADAPTERS) {
      const parsed = adapter.parse({ ...event, channel: adapter.descriptor.id });
      if (parsed.length > 0) return parsed;
    }
    return [];
  }

  for (const adapter of ADAPTERS) {
    if (adapter.canParse(event)) return adapter.parse(event);
  }
  return [];
}

const shareTarget: ChannelDescriptor = {
  id: 'share_target',
  label: 'Share to app (Web Share Target)',
  status: 'live',
  latency: 'real-time',
  requirement: 'Share a bank SMS/notification to the installed PWA from your phone\'s share sheet.',
};

const webhook: ChannelDescriptor = {
  id: 'webhook',
  label: 'Webhook receiver',
  status: 'needs-credentials',
  latency: 'real-time',
  requirement: 'Requires configuring an upstream sender (e.g. Plaid) to POST to this app\'s webhook endpoint.',
};

/** Every channel the Connectors screen shows, including ones with no ChannelAdapter of their own. */
export const CHANNELS: ChannelDescriptor[] = [
  ...ADAPTERS.map((a) => a.descriptor),
  shareTarget,
  webhook,
];

export default ADAPTERS;
