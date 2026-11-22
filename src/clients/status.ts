// Operator view: one application's state, or a list filtered by search attributes.
// Usage: npm run status -- <workflowId>
//        npm run status -- --query 'ApplicationStatus="IN_REVIEW"'
import { getClient, runMain } from '../client';
import { getStatusQuery } from '../shared/signals';

runMain(async () => {
  const args = process.argv.slice(2);
  const client = await getClient();

  if (args[0] === '--query') {
    const query = args[1] ?? '';
    for await (const wf of client.workflow.list({ query })) {
      const status = wf.searchAttributes?.ApplicationStatus?.[0] ?? '-';
      console.log(`${wf.workflowId.padEnd(40)} ${String(status).padEnd(20)} ${wf.status.name}`);
    }
    return;
  }

  const [workflowId] = args;
  if (!workflowId) {
    console.error('Usage: npm run status -- <workflowId> | --query "<visibility query>"');
    process.exit(1);
  }
  console.log(await client.workflow.getHandle(workflowId).query(getStatusQuery));
});
