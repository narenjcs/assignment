// Cross-cloud / cross-service call helpers (DEVELOPMENT.md §1 G8, §9 "Retry + timeout wrapper").

export interface RetryOptions {
  attempts: number;
  backoffMs: number;
  jitter: boolean;
  retryOn?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(backoffMs: number, attempt: number, jitter: boolean): number {
  const exponentialBase = 2;
  const base = backoffMs * exponentialBase ** (attempt - 1);
  return jitter ? base * (0.5 + Math.random() * 0.5) : base;
}

/** Retries `fn` up to `options.attempts` times with jittered exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, backoffMs, jitter, retryOn } = options;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const shouldRetry = retryOn ? retryOn(error) : true;
      if (!shouldRetry || attempt === attempts) {
        throw error;
      }
      await sleep(computeDelay(backoffMs, attempt, jitter));
    }
  }
  throw lastError;
}

/** Rejects with a timeout error if `promise` does not settle within `ms` milliseconds. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
