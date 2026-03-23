export interface CmuxTransport {
  request(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

export type CmuxTransportFactory = () => Promise<CmuxTransport>;

export interface CmuxStatus {
  available: boolean;
  capabilities: Record<string, boolean>;
}

interface CmuxAdapterOptions {
  timeoutMs: number;
}

export class CmuxAdapter {
  private status: CmuxStatus = { available: false, capabilities: {} };
  protected transport: CmuxTransport | null = null;

  constructor(
    private factory: CmuxTransportFactory,
    private options: CmuxAdapterOptions
  ) {}

  async connect(): Promise<void> {
    // Clean up previous transport if any
    if (this.transport) {
      try {
        this.transport.close();
      } catch {
        // Ignore close errors
      }
      this.transport = null;
    }

    // Track transient transport so we can clean it up if connect fails
    // after the factory succeeds (e.g. capabilities hang or throw).
    // Using an object wrapper because TS control flow doesn't track
    // mutations inside async closures for simple let bindings.
    const holder: { transport: CmuxTransport | null } = { transport: null };

    try {
      const { transport, capabilities } = await withTimeout(
        (async () => {
          holder.transport = await this.factory();

          const result = (await holder.transport.request("capabilities")) as {
            capabilities?: string[];
          };

          const caps: Record<string, boolean> = {};
          if (result.capabilities) {
            for (const cap of result.capabilities) {
              caps[cap] = true;
            }
          }

          return { transport: holder.transport, capabilities: caps };
        })(),
        this.options.timeoutMs
      );

      this.transport = transport;
      this.status = { available: true, capabilities };
    } catch {
      // Clean up transient transport if factory succeeded but we're failing
      if (holder.transport) {
        try {
          holder.transport.close();
        } catch {
          // Ignore close errors
        }
      }
      this.transport = null;
      this.status = { available: false, capabilities: {} };
    }
  }

  getStatus(): CmuxStatus {
    return this.status;
  }

  isAvailable(): boolean {
    return this.status.available;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Connection timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
