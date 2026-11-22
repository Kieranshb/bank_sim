// Product isolation: every product implements this interface.
// Adding a product = adding one file. No product can affect another's rules.
import type { EnrichmentResult, LoanApplication, LoanProduct, PolicyDecision } from '../shared/types';

export interface ProductPolicy {
  version: string; // stamped on every decision by the underwriting activity, for audit
  requiredDocuments: string[];
  // Thresholds (credit bands, amount cap) are constants inside each policy file, versioned with it
  evaluate(app: LoanApplication, enrichment: EnrichmentResult): PolicyDecision;
}

// One policy per product, injected into the underwriting activities by worker.ts
export type PolicyRegistry = Record<LoanProduct, ProductPolicy>;
