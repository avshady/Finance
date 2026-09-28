import type { AdvisorRule } from '../domain/types';

import { FOUNDATION_RULES } from './rules/foundation';
import { GROWTH_RULES } from './rules/growth';
import { LEAK_RULES } from './rules/leaks';

export * from './engine';
export * from './rules/foundation';
export * from './rules/growth';
export * from './rules/leaks';

/**
 * The full rule set, in doctrine order.
 *
 * Stage order is what the engine enforces, so registering a rule is enough to place it
 * correctly — adding financial doctrine to this app means adding a file, not rewiring
 * anything.
 */
export const ALL_RULES: AdvisorRule[] = [...FOUNDATION_RULES, ...LEAK_RULES, ...GROWTH_RULES];
