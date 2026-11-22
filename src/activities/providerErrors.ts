// Translates provider failures into Temporal's retry semantics, in three classes:
//   transient (timeouts, 429, 5xx)  -> rethrow, so the activity retry policy backs off and retries
//   not found (404)                 -> non-retryable `${provider}NotFound`: an answer, not a failure
//   rejected (other 4xx)            -> non-retryable `${provider}Rejected`: our request is wrong, so ops
//                                      needs to look; it isn't an outage and isn't an underwriting question
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
      const kind = err.status === 404 ? 'NotFound' : 'Rejected';
      throw ApplicationFailure.nonRetryable(err.message, `${err.provider}${kind}`, { status: err.status });
    }
    throw err;
  }
}
