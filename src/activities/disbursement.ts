// Disbursement. Runs on the 'disbursement' task queue.
// The only code that moves money: must be idempotent.
import type { LoanApplication } from '../shared/types';
import { callProvider } from './providerErrors';

export interface DisbursementResult {
  reference: string;
}

export interface CoreBanking {
  // Same idempotencyKey must always return the same reference and never pay twice
  disburse(req: { idempotencyKey: string; amount: number; applicantEmail: string }): Promise<DisbursementResult>;
}

export function createDisbursementActivities(coreBanking: CoreBanking) {
  return {
    async disburseLoan(app: LoanApplication, idempotencyKey: string): Promise<DisbursementResult> {
      return callProvider(() =>
        coreBanking.disburse({ idempotencyKey, amount: app.amount, applicantEmail: app.applicant.email }),
      );
    },
  };
}
