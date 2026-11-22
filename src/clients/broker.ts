// Broker referrals via email. Demo: parse a known template with regexes.
// Production: LLM extraction with schema validation; low-confidence parses go to review.
// Usage: npm run broker [-- samples/broker-email.txt]
import { readFile } from 'fs/promises';
import { getClient, runMain, startApplication } from '../client';
import { dollarsToCents } from '../shared/money';
import type { LoanApplication, LoanProduct } from '../shared/types';

export interface BrokerEmail {
  messageId: string; // used as externalId, so a re-sent email deduplicates
  from: string;
  body: string;
}

const PRODUCTS: Record<string, LoanProduct> = {
  personal: 'personal',
  auto: 'auto',
  'debt consolidation': 'debt_consolidation',
};

function field(body: string, name: string): string {
  const match = body.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  if (!match) throw new Error(`Broker email missing "${name}"`);
  return match[1].trim();
}

function optionalField(body: string, name: string): string | undefined {
  return body.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1].trim();
}

export function fromBrokerEmail(email: BrokerEmail): LoanApplication {
  const productText = field(email.body, 'Product').toLowerCase();
  const product = PRODUCTS[productText];
  if (!product) throw new Error(`Unknown product "${productText}"`);

  return {
    channel: 'broker',
    externalId: email.messageId,
    broker: email.from,
    product,
    amountCents: dollarsToCents(field(email.body, 'Amount')),
    applicant: { name: field(email.body, 'Applicant'), email: field(email.body, 'Applicant Email') },
    // Attachments line lists document types; uri points back at the email they came with
    documents: (optionalField(email.body, 'Attachments') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((type) => ({ type, uri: `email://${email.messageId}/${type}` })),
  };
}

// Raw email file: headers, blank line, body
export function parseRawEmail(raw: string): BrokerEmail {
  const [headerBlock, ...bodyParts] = raw.split(/\r?\n\r?\n/);
  return {
    messageId: field(headerBlock, 'Message-ID').replace(/[<>]/g, ''),
    from: field(headerBlock, 'From'),
    body: bodyParts.join('\n\n'),
  };
}

// Only run when executed directly, so tests can import the mapping functions
if (require.main === module) runMain(async () => {
  const path = process.argv[2] ?? 'samples/broker-email.txt';
  const email = parseRawEmail(await readFile(path, 'utf8'));

  const client = await getClient();
  const result = await startApplication(client, fromBrokerEmail(email));
  console.log(result.duplicate ? `Duplicate ignored: ${result.workflowId}` : `Started ${result.workflowId}`);
});
