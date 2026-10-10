import { Connection } from "@solana/web3.js";
import { sleep } from "../http.js";
import { creditsFromRpcBody, DEFAULT_RPC_RPS, hourStartMs, wsCredits } from "./budget.js";
import { redact } from "./redact.js";
import { dayCredits, type CreditHour, type RecorderStore } from "./store.js";

export class RateLimiter {
  private next = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly gapMs: number) {}

  take(): Promise<void> {
    const run = this.tail.then(async () => {
      const wait = Math.max(0, this.next - Date.now());
      this.next = Math.max(this.next, Date.now()) + this.gapMs;
      if (wait > 0) await sleep(wait);
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

export class CreditMeter {
  private current: CreditHour;
  private lastLoggedHour: number;

  constructor(
    private readonly store: RecorderStore,
    private readonly dailyCap: number,
    private readonly log: (line: string) => void,
    nowMs = Date.now(),
  ) {
    const hour = hourStartMs(nowMs);
    const saved = store.getHour(hour);
    this.current = saved ?? { hourStart: hour, rpcCalls: 0, rpcCredits: 0, wsMessages: 0, wsBytes: 0 };
    this.lastLoggedHour = hour;
  }

  addRpc(credits: number): void {
    this.roll(Date.now());
    this.current.rpcCalls += 1;
    this.current.rpcCredits += credits;
  }

  addWs(bytes: number): void {
    this.roll(Date.now());
    this.current.wsMessages += 1;
    this.current.wsBytes += bytes;
  }

  usedToday(nowMs = Date.now()): number {
    return dayCredits(this.store, nowMs, this.current);
  }

  allow(nowMs = Date.now()): boolean {
    return this.usedToday(nowMs) < this.dailyCap;
  }

  flush(): void {
    this.store.saveHour(this.current);
  }

  /** Log when the UTC hour changes. Returns the closed hour when one was logged. */
  roll(nowMs: number): CreditHour | null {
    const hour = hourStartMs(nowMs);
    if (hour === this.current.hourStart) return null;
    const closed = { ...this.current };
    this.store.saveHour(closed);
    this.log(formatHour(closed, this.store.creditsSince(monthStart(nowMs)), this.dailyCap));
    const saved = this.store.getHour(hour);
    this.current = saved ?? { hourStart: hour, rpcCalls: 0, rpcCredits: 0, wsMessages: 0, wsBytes: 0 };
    this.lastLoggedHour = hour;
    return closed;
  }

  snapshotLine(nowMs = Date.now()): string {
    this.flush();
    const month = this.store.creditsSince(monthStart(nowMs));
    return `credits today=${this.usedToday(nowMs).toFixed(1)} month=${month.toFixed(1)} cap=${this.dailyCap} hour_ws_bytes=${this.current.wsBytes} hour_rpc=${this.current.rpcCredits}`;
  }
}

export function formatHour(hour: CreditHour, monthCredits: number, dailyCap: number): string {
  const ws = wsCredits(hour.wsBytes);
  const total = hour.rpcCredits + ws;
  return `credits hour=${new Date(hour.hourStart).toISOString()} rpc_calls=${hour.rpcCalls} rpc_credits=${hour.rpcCredits} ws_messages=${hour.wsMessages} ws_bytes=${hour.wsBytes} ws_credits=${ws.toFixed(2)} hour_total=${total.toFixed(2)} month_to_date=${monthCredits.toFixed(1)} daily_cap=${dailyCap}`;
}

function monthStart(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function meteredConnection(httpUrl: string, limiter: RateLimiter, meter: CreditMeter, secret: string | undefined): Connection {
  const fetchImpl: typeof fetch = async (input, init) => {
    if (!meter.allow()) {
      throw new Error("daily credit cap reached; refusing another RPC call");
    }
    await limiter.take();
    const body = typeof init?.body === "string" ? init.body : "";
    const credits = body ? creditsFromRpcBody(body) : 1;
    meter.addRpc(credits);
    try {
      return await fetch(input, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redact(message, secret));
    }
  };
  return new Connection(httpUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: fetchImpl,
  });
}

export function limiterForRps(rps: number): RateLimiter {
  const safe = rps > 0 && rps < HELIUS_SAFE_RPS ? rps : DEFAULT_RPC_RPS;
  return new RateLimiter(1000 / safe);
}

const HELIUS_SAFE_RPS = 10;
