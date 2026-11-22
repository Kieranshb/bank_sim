// Outbound notifications to applicants and reviewers.
import type { LoanApplication } from '../shared/types';

export interface Notifier {
  send(to: string, message: string): Promise<void>;
}

export function createNotificationActivities(notifier: Notifier) {
  return {
    async requestDocuments(app: LoanApplication, missing: string[]): Promise<void> {
      await notifier.send(app.applicant.email, `Please upload: ${missing.join(', ')}`);
    },

    async createReviewTask(workflowId: string, reasons: string[]): Promise<void> {
      await notifier.send(
        'review-queue',
        `${workflowId} needs review (${reasons.join('; ')}). ` +
          `Decide with: npm run review -- ${workflowId} <approve|decline> <reviewer> "<reason>"`,
      );
    },

    async notifyApplicant(app: LoanApplication, message: string): Promise<void> {
      await notifier.send(app.applicant.email, message);
    },
  };
}
