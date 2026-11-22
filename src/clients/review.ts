// Reviewer console stand-in. Sends the human decision as a signal, then reads status back.
// Usage: npm run review -- <workflowId> <approve|decline> <reviewer> "<reason>"
import { getClient, runMain } from '../client';
import { getStatusQuery, submitDecisionSignal } from '../shared/signals';
import type { ReviewDecision } from '../shared/types';

runMain(async () => {
  const [workflowId, decision, reviewer, reason] = process.argv.slice(2);
  if (!workflowId || (decision !== 'approve' && decision !== 'decline') || !reviewer || !reason) {
    console.error('Usage: npm run review -- <workflowId> <approve|decline> <reviewer> "<reason>"');
    process.exit(1);
  }

  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);

  const payload: ReviewDecision = { decision, reviewer, reason, decidedAt: new Date().toISOString() };
  await handle.signal(submitDecisionSignal, payload);
  console.log(`Sent ${decision} for ${workflowId}`);

  console.log('Current state:', await handle.query(getStatusQuery));
});
