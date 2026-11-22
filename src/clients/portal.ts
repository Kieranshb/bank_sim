// Self-serve online portal. In production this is an API route; here it's a demo script.
// Usage: npm run portal [-- samples/portal-form.json]
import { readFile } from 'fs/promises';
import { getClient, runMain, startApplication } from '../client';
import type { LoanApplication, LoanProduct } from '../shared/types';

export interface PortalForm {
  id: string;
  fullName: string;
  email: string;
  product: LoanProduct;
  amount: number;
  uploads: { type: string; url: string }[];
}

export function fromPortal(form: PortalForm): LoanApplication {
  return {
    channel: 'portal',
    externalId: form.id,
    product: form.product,
    amount: form.amount,
    applicant: { name: form.fullName, email: form.email },
    documents: form.uploads.map((u) => ({ type: u.type, uri: u.url })),
  };
}

// Only run when executed directly, so tests can import the mapping functions
if (require.main === module) runMain(async () => {
  const path = process.argv[2] ?? 'samples/portal-form.json';
  const form: PortalForm = JSON.parse(await readFile(path, 'utf8'));

  const client = await getClient();
  const result = await startApplication(client, fromPortal(form));
  console.log(result.duplicate ? `Duplicate ignored: ${result.workflowId}` : `Started ${result.workflowId}`);
});
