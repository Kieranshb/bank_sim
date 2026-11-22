// Loads every sample input through the real channel mappers, keyed by applicant email,
// so tests check the same LoanApplications the demo produces.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fromPortal, type PortalForm } from '../clients/portal';
import { fromBrokerEmail, parseRawEmail } from '../clients/broker';
import { fromAggregator, type AggregatorRecord } from '../clients/aggregator';
import type { LoanApplication } from '../shared/types';

const read = (file: string) => readFileSync(resolve(__dirname, '../../samples', file), 'utf8');

export function loadSampleApplications(): Record<string, LoanApplication> {
  const apps: LoanApplication[] = [
    fromPortal(JSON.parse(read('portal-form.json')) as PortalForm),
    fromBrokerEmail(parseRawEmail(read('broker-email.txt'))),
    ...(JSON.parse(read('aggregator-batch.json')) as AggregatorRecord[]).map(fromAggregator),
  ];
  return Object.fromEntries(apps.map((a) => [a.applicant.email, a]));
}
