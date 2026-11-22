// Product isolation: every product implements this interface.
// Adding a product = adding one file. No product can affect another's rules.
import type { EnrichmentResult, LoanApplication, LoanProduct, UnderwritingOutcome } from '../shared/types';

export interface ProductPolicy {
  version: string; // recorded on every decision for audit
  requiredDocuments: string[];
  // TODO: risk thresholds (min credit score, max DTI, max amount, ...)
  evaluate(app: LoanApplication, enrichment: EnrichmentResult): UnderwritingOutcome;
}

// One policy per product, injected into the underwriting activities by worker.ts
export type PolicyRegistry = Record<LoanProduct, ProductPolicy>;
