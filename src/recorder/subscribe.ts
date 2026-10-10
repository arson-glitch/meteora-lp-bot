import { redact } from "./redact.js";
import type { CreditMeter } from "./meter.js";

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
  }) {}

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
      if (this.stopped) return;
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
    return this.params.addresses.map((address, index) => ({ id: index + 1, address }));
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
      this.ws?.send(JSON.stringify(payload));
      this.nextId = target.id + 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private handle(text: string): void {
    let message: {
      method?: string;
      params?: { result?: { context?: { slot?: number }; value?: { signature?: string; err?: unknown; logs?: string[] } } };
      error?: { message?: string };
    };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (message.error?.message) {
      this.params.log(`websocket rpc error: ${redact(message.error.message, this.params.secret)}`);
      return;
    }
    if (message.method !== "logsNotification") return;
    const value = message.params?.result?.value;
    const slot = message.params?.result?.context?.slot ?? 0;
    if (!value?.signature || !value.logs || value.err) return;
    this.params.onLogs(value.logs, value.signature, slot);
  }
}
