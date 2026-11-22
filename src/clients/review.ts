// Reviewer console stand-in. Checks what the application accepts right now, sends the decision as
// a signal, then reads the state back.
// Usage: npm run review -- <workflowId> <approve|decline|retry> <reviewer> "<reason>"
//
// Signals can't be rejected by the workflow, so this client checks reviewOptions first and tells
// the reviewer if a decision isn't valid (e.g. 'approve' while a provider's result is missing).
// The workflow enforces the same rule and ignores invalid decisions.
import { getClient, runMain } from '../client';
import { getStatusQuery, submitDecisionSignal } from '../shared/signals';
import type { DecisionChoice, ReviewDecision } from '../shared/types';

const CHOICES: DecisionChoice[] = ['approve', 'decline', 'retry'];
const USAGE = 'Usage: npm run review -- <workflowId> <approve|decline|retry> <reviewer> "<reason>"';

runMain(async () => {
  const [workflowId, decision, reviewer, reason] = process.argv.slice(2);
  if (!workflowId || !CHOICES.includes(decision as DecisionChoice) || !reviewer || !reason) {
    console.error(USAGE);
    process.exit(1);
  }

  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);

  const before = await handle.query(getStatusQuery);
  if (!before.reviewOptions?.includes(decision as DecisionChoice)) {
    console.error(
      before.reviewOptions
        ? `${workflowId} accepts ${before.reviewOptions.join(' or ')} right now, not ${decision}.`
        : `${workflowId} isn't waiting for a decision (status: ${before.status}).`,
    );
    process.exit(1);
  }

  const payload: ReviewDecision = {
    decision: decision as DecisionChoice,
    reviewer,
    reason,
    decidedAt: new Date().toISOString(),
  };
  await handle.signal(submitDecisionSignal, payload);
  console.log(`Sent ${decision} for ${workflowId}`);

  await new Promise((resolve) => setTimeout(resolve, 500)); // let the workflow process it
  console.log('Current state:', await handle.query(getStatusQuery));
});
