import { redact } from "./redact.js";
import type { CreditMeter } from "./meter.js";
import { noisiestAddresses } from "./wsFilter.js";

export type WsMode = "mentions" | "program";

interface SubscribeTarget {
  id: number;
  address: string;
}

/**
 * One standard Solana logsSubscribe connection.
 * `mentions` opens one subscription per tracked pool (free-tier safe).
 * `program` mentions the DLMM program and filters client-side. That stream
 * is the whole program and will spend the free credit budget on logs we drop.
 */
export class LogSubscriber {
  private ws: WebSocket | null = null;
  private backoffMs = 1_000;
  private stopped = false;
  private nextId = 1;
  private opened = false;
  private recycling = false;
  private addresses: string[];
  private readonly requestAddress = new Map<number, string>();
  private readonly subscriptionAddress = new Map<number, string>();
  private readonly bytesByAddress = new Map<string, number>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly params: {
    url: string;
    mode: WsMode;
    addresses: string[];
    programId: string;
    meter: CreditMeter;
    secret: string | undefined;
    log: (line: string) => void;
    shouldStream?: () => boolean;
    onLogs: (logs: string[], signature: string, slot: number) => void;
  }) {
    this.addresses = params.addresses;
  }

  /** Replace the per-pool subscription list. Call `resubscribe` to apply it. */
  setAddresses(addresses: string[]): void {
    this.addresses = addresses;
  }

  currentAddresses(): string[] {
    return [...this.addresses];
  }

  /** Pools that produced the most notification bytes since the last hour reset. */
  noisiest(n: number): Array<{ address: string; bytes: number }> {
    return noisiestAddresses(this.bytesByAddress, n);
  }

  resetHourBytes(): void {
    this.bytesByAddress.clear();
  }

  /**
   * Close the socket without stopping the process so the close handler
   * reconnects and sends logsSubscribe for the current address list.
   * Program mode is a single subscription, so this is a no-op there.
   */
  resubscribe(): void {
    if (this.stopped || this.params.mode === "program") return;
    this.backoffMs = 1_000;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.recycling = true;
      this.ws.close();
      return;
    }
    this.recycling = false;
    this.connect();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.opened;
  }

  private connect(): void {
    if (this.stopped) return;
    if (!this.params.meter.allow() || this.params.shouldStream?.() === false) {
      this.params.log("websocket paused until the next credit window");
      this.schedule(60_000);
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.params.url);
    } catch (error) {
      this.params.log(`websocket open failed: ${redact(error instanceof Error ? error.message : String(error), this.params.secret)}`);
      this.schedule(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.opened = true;
      this.backoffMs = 1_000;
      this.requestAddress.clear();
      this.subscriptionAddress.clear();
      this.params.log(`websocket connected mode=${this.params.mode} subscriptions=${this.targets().length}`);
      void this.subscribeAll();
    });
    ws.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : String(event.data);
      this.params.meter.addWs(Buffer.byteLength(text));
      if (!this.params.meter.allow() || this.params.shouldStream?.() === false) {
        this.params.log("websocket closing: swap budget or daily credit cap reached");
        ws.close();
        return;
      }
      this.handle(text);
    });
    ws.addEventListener("close", () => {
      this.opened = false;
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      if (this.recycling) {
        this.recycling = false;
        this.backoffMs = 1_000;
        this.params.log(`websocket resubscribing subscriptions=${this.targets().length}`);
        this.schedule(0);
        return;
      }
      this.params.log(`websocket closed; reconnecting in ${this.backoffMs}ms`);
      this.schedule(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    });
    ws.addEventListener("error", (event) => {
      const message = "message" in event ? String((event as { message?: unknown }).message ?? "websocket error") : "websocket error";
      this.params.log(redact(message, this.params.secret));
    });
  }

  private schedule(ms: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), ms);
  }

  private targets(): SubscribeTarget[] {
    if (this.params.mode === "program") return [{ id: 1, address: this.params.programId }];
    return this.addresses.map((address, index) => ({ id: index + 1, address }));
  }

  private async subscribeAll(): Promise<void> {
    for (const target of this.targets()) {
      if (this.stopped || !this.opened) return;
      const payload = {
        jsonrpc: "2.0",
        id: target.id,
        method: "logsSubscribe",
        params: [{ mentions: [target.address] }, { commitment: "confirmed" }],
      };
      this.requestAddress.set(target.id, target.address);
      this.ws?.send(JSON.stringify(payload));
      this.nextId = target.id + 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private handle(text: string): void {
    let message: {
      id?: number;
      result?: unknown;
      method?: string;
      params?: {
        subscription?: number;
        result?: { context?: { slot?: number }; value?: { signature?: string; err?: unknown; logs?: string[] } };
      };
      error?: { message?: string };
    };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id === "number" && typeof message.result === "number") {
      const address = this.requestAddress.get(message.id);
      if (address) this.subscriptionAddress.set(message.result, address);
    }
    if (message.error?.message) {
      this.params.log(`websocket rpc error: ${redact(message.error.message, this.params.secret)}`);
      return;
    }
    if (message.method !== "logsNotification") return;
    const subscription = message.params?.subscription;
    if (typeof subscription === "number") {
      const address = this.subscriptionAddress.get(subscription);
      if (address) this.bytesByAddress.set(address, (this.bytesByAddress.get(address) ?? 0) + Buffer.byteLength(text));
    }
    const value = message.params?.result?.value;
    const slot = message.params?.result?.context?.slot ?? 0;
    if (!value?.signature || !value.logs || value.err) return;
    this.params.onLogs(value.logs, value.signature, slot);
  }
}
