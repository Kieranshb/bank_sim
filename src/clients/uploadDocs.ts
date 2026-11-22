// Applicant (or broker) uploads a missing document. Sends it to the waiting workflow as a signal.
// Usage: npm run upload-docs -- <workflowId> <documentType> [uri]
// e.g.   npm run upload-docs -- broker:ref-88412@northpoint-brokers.example vehicle_bill_of_sale
import { getClient, runMain } from '../client';
import { documentsUploadedSignal, getStatusQuery } from '../shared/signals';

runMain(async () => {
  const [workflowId, type, uri] = process.argv.slice(2);
  if (!workflowId || !type) {
    console.error('Usage: npm run upload-docs -- <workflowId> <documentType> [uri]');
    process.exit(1);
  }

  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);

  await handle.signal(documentsUploadedSignal, [{ type, uri: uri ?? `upload://${workflowId}/${type}` }]);
  console.log(`Uploaded ${type} to ${workflowId}`);

  console.log('Current state:', await handle.query(getStatusQuery));
});
