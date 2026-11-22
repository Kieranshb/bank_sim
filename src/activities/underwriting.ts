// Underwriting. Runs on the 'underwriting' task queue.
// Policies are injected, so this file knows nothing about specific products.
import { ApplicationFailure } from '@temporalio/activity';
import type { EnrichmentResult, LoanApplication, LoanProduct, UnderwritingOutcome } from '../shared/types';
import type { PolicyRegistry, ProductPolicy } from '../products/policy';

export function createUnderwritingActivities(policies: PolicyRegistry) {
  function policyFor(product: LoanProduct): ProductPolicy {
    const policy = policies[product];
    if (!policy) {
      // Bad input, not a transient failure: retrying won't fix it
      throw ApplicationFailure.nonRetryable(`No policy for product "${product}"`, 'UnknownProduct');
    }
    return policy;
  }

  return {
    async missingDocuments(product: LoanProduct, documentTypes: string[]): Promise<string[]> {
      const uploaded = new Set(documentTypes);
      return policyFor(product).requiredDocuments.filter((type) => !uploaded.has(type));
    },

    async underwrite(app: LoanApplication, enrichment: EnrichmentResult): Promise<UnderwritingOutcome> {
      const policy = policyFor(app.product);
      // The version is stamped here, in one place, so every decision maps to an exact rule set
      return { ...policy.evaluate(app, enrichment), policyVersion: policy.version };
    },
  };
}
