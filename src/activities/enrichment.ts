// Third-party enrichment. Runs on the 'enrichment' task queue.
// Provider clients are injected: mocks for the demo, real HTTP clients in production.
import type { CreditReport, FraudResult, IdentityResult, LoanApplication } from '../shared/types';
import { callProvider } from './providerErrors';

export interface CreditBureau {
  pull(app: LoanApplication): Promise<CreditReport>;
}

export interface IdentityProvider {
  verify(app: LoanApplication): Promise<IdentityResult>;
}

export interface FraudProvider {
  check(app: LoanApplication): Promise<FraudResult>;
}

export interface EnrichmentDeps {
  credit: CreditBureau;
  identity: IdentityProvider;
  fraud: FraudProvider;
}

export function createEnrichmentActivities(deps: EnrichmentDeps) {
  return {
    async pullCredit(app: LoanApplication): Promise<CreditReport> {
      return callProvider(() => deps.credit.pull(app));
    },

    async verifyIdentity(app: LoanApplication): Promise<IdentityResult> {
      return callProvider(() => deps.identity.verify(app));
    },

    async checkFraud(app: LoanApplication): Promise<FraudResult> {
      return callProvider(() => deps.fraud.check(app));
    },
  };
}
