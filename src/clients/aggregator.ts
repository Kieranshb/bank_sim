// Batch feeds from financial aggregators.
// Demo: loop over a JSON file. At scale: a BatchIngestWorkflow so a crash mid-file resumes
// instead of restarting, with the file position tracked durably.
// Usage: npm run aggregator [-- samples/aggregator-batch.json]
import { readFile } from 'fs/promises';
import { getClient, runMain, startApplication } from '../client';
import type { LoanApplication, LoanProduct } from '../shared/types';

export interface AggregatorRecord {
  record_id: string; // used as externalId
  source: string; // aggregator name
  loan_type: LoanProduct; // unchecked here: the workflow's validation rejects unknown products
  requested_amount_cents: number;
  applicant: { first_name: string; last_name: string; email: string };
  documents: { type: string; url: string }[];
}

export function fromAggregator(record: AggregatorRecord): LoanApplication {
  return {
    channel: 'aggregator',
    externalId: `${record.source}-${record.record_id}`,
    product: record.loan_type,
    amountCents: record.requested_amount_cents, // already integer cents; the workflow validates it
    applicant: {
      name: `${record.applicant.first_name} ${record.applicant.last_name}`,
      email: record.applicant.email,
    },
    documents: record.documents.map((d) => ({ type: d.type, uri: d.url })),
  };
}

// Only run when executed directly, so tests can import the mapping functions
if (require.main === module) runMain(async () => {
  const path = process.argv[2] ?? 'samples/aggregator-batch.json';
  const records: AggregatorRecord[] = JSON.parse(await readFile(path, 'utf8'));

  const client = await getClient();
  let started = 0;
  let duplicates = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const result = await startApplication(client, fromAggregator(record));
      if (result.duplicate) duplicates++;
      else started++;
      console.log(`${result.duplicate ? 'duplicate' : 'started  '} ${result.workflowId}`);
    } catch (err) {
      // One bad record shouldn't block the rest of the batch
      failed++;
      console.error(`failed    ${record.record_id}: ${(err as Error).message}`);
    }
  }

  console.log(`\n${started} started, ${duplicates} duplicates, ${failed} failed (of ${records.length})`);
});
