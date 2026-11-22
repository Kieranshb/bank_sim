// Mock external systems for the demo. Each implements the interface its activity depends on.
//
// Deterministic by design: provider results come from mocks/scenarios.ts, keyed by applicant
// email, so every demo run takes the same path. Failures are switched on via config (env vars),
// injected through the constructors by worker.ts. The mocks never read process.env themselves.
import { appendFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import type { CreditBureau, FraudProvider, IdentityProvider } from '../activities/enrichment';
import type { CoreBanking, DisbursementResult } from '../activities/disbursement';
import type { AuditSink } from '../activities/audit';
import type { Notifier } from '../activities/notifications';
import { ProviderError } from '../activities/providerErrors';
import { formatCents } from '../shared/money';
import type { AuditEvent, CreditReport, FraudResult, IdentityResult, LoanApplication } from '../shared/types';
import { scenarioFor } from './scenarios';

// Small delay so parallel enrichment calls are visible in the Web UI timeline
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockCreditBureau implements CreditBureau {
  constructor(private readonly opts: { latencyMs?: number } = {}) {}

  async pull(app: LoanApplication): Promise<CreditReport> {
    await sleep(this.opts.latencyMs ?? 0);
    return { score: scenarioFor(app.applicant.email).creditScore };
  }
}

export class MockIdentityProvider implements IdentityProvider {
  constructor(private readonly opts: { latencyMs?: number; notFoundEmail?: string } = {}) {}

  async verify(app: LoanApplication): Promise<IdentityResult> {
    await sleep(this.opts.latencyMs ?? 0);
    if (this.opts.notFoundEmail === app.applicant.email) {
      throw new ProviderError(`No identity record for ${app.applicant.email}`, 'Identity', 404);
    }
    return { verified: true };
  }
}

export class MockFraudProvider implements FraudProvider {
  constructor(private readonly opts: { latencyMs?: number; outage?: boolean } = {}) {}

  async check(app: LoanApplication): Promise<FraudResult> {
    await sleep(this.opts.latencyMs ?? 0);
    if (this.opts.outage) {
      throw new ProviderError('Fraud service unavailable', 'Fraud', 503);
    }
    return { riskLevel: scenarioFor(app.applicant.email).fraudRisk ?? 'low' };
  }
}

export class MockCoreBanking implements CoreBanking {
  // Idempotency: a retried disbursement returns the original reference instead of paying twice.
  // In-memory, so it resets on worker restart; a real core banking system persists this.
  private readonly disbursed = new Map<string, DisbursementResult>();

  constructor(private readonly opts: { latencyMs?: number } = {}) {}

  // Number of real payouts made (repeat requests don't count). Lets tests prove idempotency.
  get payoutCount(): number {
    return this.disbursed.size;
  }

  async disburse(req: { idempotencyKey: string; amountCents: number; applicantEmail: string }): Promise<DisbursementResult> {
    await sleep(this.opts.latencyMs ?? 0);
    const existing = this.disbursed.get(req.idempotencyKey);
    if (existing) {
      console.log(`[core-banking] repeat request for ${req.idempotencyKey}, returning ${existing.reference}`);
      return existing;
    }
    const result = { reference: `DISB-${randomUUID().slice(0, 8).toUpperCase()}` };
    this.disbursed.set(req.idempotencyKey, result);
    console.log(`[core-banking] disbursed ${formatCents(req.amountCents)} to ${req.applicantEmail} (${result.reference})`);
    return result;
  }
}

export class MockAuditSink implements AuditSink {
  // Idempotency: a retried write with the same eventId is ignored. In-memory for the demo;
  // a real audit store enforces this with a unique constraint on eventId.
  private readonly written = new Set<string>();

  constructor(private readonly path: string) {}

  // Append-only JSON lines: one decision per line, never rewritten
  async append(event: AuditEvent & { recordedAt: string }): Promise<void> {
    if (this.written.has(event.eventId)) return;
    await appendFile(this.path, JSON.stringify(event) + '\n');
    this.written.add(event.eventId);
  }
}

export class ConsoleNotifier implements Notifier {
  async send(to: string, message: string): Promise<void> {
    console.log(`[notify ${to}] ${message}`);
  }
}
