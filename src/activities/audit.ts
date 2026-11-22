// Append-only audit log for every automated and human decision.
// Separate from Temporal history, which has a retention period.
import type { AuditEvent } from '../shared/types';

export interface AuditSink {
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
