export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probeRunning = false;

  constructor(
    private readonly failureThreshold = 5,
    private readonly resetAfterMs = 30_000,
  ) {}

  state(now = Date.now()): CircuitState {
    if (this.openedAt === 0) return 'closed';
    return now - this.openedAt >= this.resetAfterMs ? 'half_open' : 'open';
  }

  async execute<T>(operation: () => Promise<T>, now = Date.now()): Promise<T> {
    const state = this.state(now);
    if (state === 'open' || (state === 'half_open' && this.probeRunning)) {
      throw new OperationalFailure('CIRCUIT_OPEN', 'transient', true);
    }
    if (state === 'half_open') this.probeRunning = true;
    try {
      const result = await operation();
      this.failures = 0;
      this.openedAt = 0;
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.failureThreshold) this.openedAt = now;
      throw error;
    } finally {
      this.probeRunning = false;
    }
  }
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let rejectTimeout: (reason: OperationalFailure) => void = () => undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    rejectTimeout(new OperationalFailure('OPERATION_TIMEOUT', 'transient', true));
  }, timeoutMs);
  timer.unref();
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class BoundedConcurrency {
  private active = 0;

  constructor(private readonly maximum: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      throw new OperationalFailure('BACKPRESSURE_REJECTED', 'transient', true);
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
}

export class OperationalFailure extends Error {
  constructor(
    readonly code: 'CIRCUIT_OPEN' | 'OPERATION_TIMEOUT' | 'BACKPRESSURE_REJECTED',
    readonly category: 'transient',
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
