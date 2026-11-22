// Translates provider failures into Temporal's retry semantics.
// Transient (timeouts, 429, 5xx): rethrow, so the activity retry policy kicks in.
// Permanent (4xx such as "not found"): non-retryable, so the workflow can act on it immediately.
import { ApplicationFailure } from '@temporalio/activity';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export async function callProvider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ProviderError && !err.retryable) {
      throw ApplicationFailure.nonRetryable(err.message, `${err.provider}Rejected`, { status: err.status });
    }
    throw err;
  }
}
