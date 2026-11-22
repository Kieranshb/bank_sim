// Activity unit tests. MockActivityEnvironment runs an activity outside a worker.
import { describe, it } from 'mocha';

describe('activities', () => {
  it.skip('disburseLoan returns the same reference for the same idempotency key');
  it.skip('underwrite uses the policy for the application product');
  it.skip('missingDocuments lists required documents not yet uploaded');
});
