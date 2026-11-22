// Underwriting. Runs on the 'underwriting' task queue.
// Policies are injected, so this file knows nothing about specific products.
import { ApplicationFailure } from '@temporalio/activity';
import type { EnrichmentResult, LoanApplication, UnderwritingOutcome } from '../shared/types';
import type { PolicyRegistry, ProductPolicy } from '../products/policy';

export function createUnderwritingActivities(policies: PolicyRegistry) {
  function policyFor(app: LoanApplication): ProductPolicy {
    const policy = policies[app.product];
    if (!policy) {
      // Bad input, not a transient failure: retrying won't fix it
      throw ApplicationFailure.nonRetryable(`No policy for product "${app.product}"`, 'UnknownProduct');
    }
    return policy;
  }

  return {
    async missingDocuments(app: LoanApplication): Promise<string[]> {
      const uploaded = new Set(app.documents.map((d) => d.type));
      return policyFor(app).requiredDocuments.filter((type) => !uploaded.has(type));
    },

    async underwrite(app: LoanApplication, enrichment: EnrichmentResult): Promise<UnderwritingOutcome> {
      const policy = policyFor(app);
      // Stamp the version here so every decision is auditable, even if a policy forgets to set it
      return { ...policy.evaluate(app, enrichment), policyVersion: policy.version };
    },
  };
}
