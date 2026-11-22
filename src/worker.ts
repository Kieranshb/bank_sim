// Runs all four workers in one process for the demo.
// In production each would be its own deployment, scaled and secured separately.
//
// This is the only file that decides which implementations are real and which are mocked.
import { NativeConnection } from '@temporalio/worker';
import { config } from './config';
import { createWorkers } from './workers';
import { POLICIES } from './products';
import {
  ConsoleNotifier,
  MockAuditSink,
  MockCoreBanking,
  MockCreditBureau,
  MockFraudProvider,
  MockIdentityProvider,
} from './mocks/providers';

async function run() {
  const connection = await NativeConnection.connect({ address: config.temporalAddress });
  const { latencyMs } = config.mocks;

  try {
    const workers = await createWorkers(
      connection,
      {
        auditSink: new MockAuditSink(config.auditLogPath),
        notifier: new ConsoleNotifier(),
        providers: {
          credit: new MockCreditBureau({ latencyMs }),
          identity: new MockIdentityProvider({ latencyMs, notFoundEmail: config.mocks.identityNotFound }),
          fraud: new MockFraudProvider({ latencyMs, outage: config.mocks.fraudOutage }),
        },
        policies: POLICIES,
        coreBanking: new MockCoreBanking({ latencyMs }),
      },
      { namespace: config.namespace, enrichmentRatePerSecond: config.enrichmentRatePerSecond },
    );

    await Promise.all(workers.map((w) => w.run()));
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
