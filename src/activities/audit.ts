// Append-only audit log for every automated and human decision.
// Separate from Temporal history, which has a retention period.
import type { AuditEvent } from '../shared/types';

export interface AuditSink {
  // Must be idempotent on event.eventId: activities are at-least-once, so a write can be retried
  // after it actually succeeded (e.g. the worker crashed before reporting completion)
  append(event: AuditEvent & { recordedAt: string }): Promise<void>;
}

export function createAuditActivities(sink: AuditSink) {
  return {
    async recordAuditEvent(event: AuditEvent): Promise<void> {
      // Timestamp taken here, not in the workflow: activities may use the real clock
      await sink.append({ ...event, recordedAt: new Date().toISOString() });
    },
  };
}
