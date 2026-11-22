// Outbound notifications to applicants, reviewers, supervisors and ops.
import type { DecisionChoice, LoanApplication } from '../shared/types';

export interface Notifier {
  send(to: string, message: string): Promise<void>;
}

const decideWith = (workflowId: string, allowed: DecisionChoice[]) =>
  `npm run review -- ${workflowId} <${allowed.join('|')}> <reviewer> "<reason>"`;

export function createNotificationActivities(notifier: Notifier) {
  return {
    async requestDocuments(app: LoanApplication, missing: string[]): Promise<void> {
      await notifier.send(app.applicant.email, `Please upload: ${missing.join(', ')}`);
    },

    async createReviewTask(workflowId: string, reasons: string[], allowed: DecisionChoice[]): Promise<void> {
      await notifier.send(
        'review-queue',
        `${workflowId} needs review (${reasons.join('; ')}). Decide with: ${decideWith(workflowId, allowed)}`,
      );
    },

    async escalateToSupervisor(workflowId: string, reasons: string[], allowed: DecisionChoice[]): Promise<void> {
      await notifier.send(
        'supervisor-queue',
        `ESCALATED: ${workflowId} had no review decision in time (${reasons.join('; ')}). ` +
          `Still decidable: ${decideWith(workflowId, allowed)}`,
      );
    },

    async alertOperations(workflowId: string, reason: string): Promise<void> {
      await notifier.send('ops-alerts', `${workflowId} needs manual handling: ${reason}`);
    },

    async notifyApplicant(app: LoanApplication, message: string): Promise<void> {
      await notifier.send(app.applicant.email, message);
    },
  };
}
