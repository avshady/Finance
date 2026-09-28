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

/** Route a RawEvent to the first adapter whose canParse() returns true. */
export function parseEvent(event: RawEvent): ParsedTransaction[] {
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
