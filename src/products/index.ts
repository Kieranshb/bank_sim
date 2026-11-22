// Policy registry, injected into the underwriting activities by worker.ts.
// Adding a product = one policy file + one entry here.
import type { PolicyRegistry } from './policy';
import { personalPolicy } from './personal';
import { autoPolicy } from './auto';
import { debtConsolidationPolicy } from './debtConsolidation';

export type { PolicyRegistry, ProductPolicy } from './policy';

export const POLICIES: PolicyRegistry = {
  personal: personalPolicy,
  auto: autoPolicy,
  debt_consolidation: debtConsolidationPolicy,
};
