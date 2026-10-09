import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { loadConfig } from "../src/config.js";
import {
  LiveTradingDisabledError,
  assertLiveTradingAllowed,
  keypairFromSecret,
  openLivePosition,
} from "../src/executor/live.js";

describe("live trading gate", () => {
  it("defaults to paper and refuses to sign without every live flag", async () => {
    const paper = loadConfig({});
    expect(paper.mode).toBe("paper");
    expect(paper.walletPrivateKey).toBeUndefined();
    expect(() => assertLiveTradingAllowed(paper, false)).toThrow(LiveTradingDisabledError);
    expect(() => assertLiveTradingAllowed(paper, true)).toThrow(/Paper mode/);

    const liveNoKey = loadConfig({ MODE: "live" });
    expect(() => assertLiveTradingAllowed(liveNoKey, true)).toThrow(/WALLET_PRIVATE_KEY/);

    await expect(
      openLivePosition({
        config: paper,
        confirmLive: false,
        connection: {} as never,
        poolAddress: "So11111111111111111111111111111111111111112",
        strategy: {
          id: "spot-spread",
          binsBelow: 1,
          binsAbove: 1,
          shape: "Spot",
          sidedness: "two-sided",
        } as never,
        amountX: 1,
        amountY: 1,
        decimalsX: 9,
        decimalsY: 6,
      }),
    ).rejects.toBeInstanceOf(LiveTradingDisabledError);
  });

  it("round-trips a generated key without printing it", () => {
    const keypair = Keypair.generate();
    const restored = keypairFromSecret(bs58.encode(keypair.secretKey));
    expect(restored.publicKey.equals(keypair.publicKey)).toBe(true);
    const fromJson = keypairFromSecret(JSON.stringify(Array.from(keypair.secretKey)));
    expect(fromJson.publicKey.equals(keypair.publicKey)).toBe(true);
  });
});
