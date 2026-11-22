// Operational settings: the only file that reads process.env.
// Everything that varies by environment lives here and is injected from worker.ts.
//
// Not here on purpose:
//   - underwriting thresholds: versioned code in products/*, so every decision maps to a policy version
//   - demo scenario data: fixtures in mocks/scenarios.ts
//   - anything the workflow needs: workflow code can't read config (determinism), so it is
//     passed in as a workflow argument or kept as a constant in the workflow
//
// Clients connect via @temporalio/envconfig (TEMPORAL_ADDRESS etc.), see client.ts.

export const config = {
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',

  // Shared across all enrichment workers by the Temporal server
  enrichmentRatePerSecond: Number(process.env.ENRICHMENT_RPS ?? 10),

  auditLogPath: process.env.AUDIT_LOG_PATH ?? 'audit.log',

  // Demo failure switches for the mock providers
  mocks: {
    latencyMs: Number(process.env.MOCK_LATENCY_MS ?? 200),
    fraudOutage: process.env.FRAUD_OUTAGE === '1', // fraud returns 503 (retryable)
    identityNotFound: process.env.IDENTITY_NOT_FOUND, // identity returns 404 (non-retryable) for this email
  },
} as const;
