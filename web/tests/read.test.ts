/**
 * The finality normalizer, pinned against the transaction shapes StudioNet
 * has actually produced — and Studio Next was measured to reproduce under
 * genlayer-js 2.0.0-rc.1 — because this function decides whether a user is
 * told a write is irreversible, so every measured shape is a fixture. The
 * last block drives the real status read through the real SDK against a
 * stubbed proxy, pinning that the SDK's Studio path issues the one method
 * the proxy forwards for it and nothing else.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTransactionStatus, normalizeTxView } from "@/lib/read";

describe("normalizeTxView — what one status poll may claim", () => {
  it("a write that took effect: FINALIZED with a deciding SUCCESS receipt", () => {
    const v = normalizeTxView({
      statusName: "FINALIZED",
      status: 7,
      result_name: "MAJORITY_AGREE",
      consensus_data: {
        // measured live: the trailing ERROR is a rotated round — entry 0 decides
        leader_receipt: [{ execution_result: "SUCCESS" }, { execution_result: "ERROR" }],
      },
    });
    expect(v.finalized).toBe(true);
    expect(v.executed).toBe("SUCCESS");
  });

  it("a refused write still finalizes MAJORITY_AGREE — the receipt says ERROR", () => {
    const v = normalizeTxView({
      statusName: "FINALIZED",
      result_name: "MAJORITY_AGREE",   // agreement that it errored
      consensus_data: {
        leader_receipt: [{ execution_result: "ERROR" }, { execution_result: "ERROR" }],
      },
    });
    expect(v.finalized).toBe(true);
    expect(v.executed).toBe("ERROR");
  });

  it("ACCEPTED is not finality", () => {
    const v = normalizeTxView({
      statusName: "ACCEPTED",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    });
    expect(v.finalized).toBe(false);
    expect(v.executed).toBe("SUCCESS");
  });

  it("a numeric status maps through the pinned table", () => {
    expect(normalizeTxView({ status: 7 }).finalized).toBe(true);
    expect(normalizeTxView({ status: 5 }).statusName).toBe("ACCEPTED");
  });

  it("the SDK's enum spelling is accepted alongside the wire spelling", () => {
    const v = normalizeTxView({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }] },
    });
    expect(v.executed).toBe("SUCCESS");
  });

  it("an empty or alien answer claims nothing", () => {
    for (const raw of [null, undefined, {}, "nonsense", 42]) {
      const v = normalizeTxView(raw);
      expect(v.finalized).toBe(false);
      expect(v.executed).toBe("UNKNOWN");
    }
  });

  it("the consensus result alone is never treated as execution success", () => {
    // No receipts at all: MAJORITY_AGREE must not read as success.
    const v = normalizeTxView({
      statusName: "FINALIZED",
      result_name: "MAJORITY_AGREE",
    });
    expect(v.executed).toBe("UNKNOWN");
  });
});

describe("getTransactionStatus — one status poll through the real SDK and the proxy", () => {
  const HASH = "0x" + "cd".repeat(32);
  const seen: Array<{ url: string; method: string; params: unknown }> = [];

  /** The proxy, as the SDK sees it: same-origin JSON-RPC, one answer per method. */
  function stubProxy(answer: (method: string) => { result: unknown } | { error: unknown }) {
    seen.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, opts: { body?: string } | undefined) => {
        const body = JSON.parse(opts?.body ?? "{}") as { id?: number; method: string; params: unknown };
        seen.push({ url: String(url), method: body.method, params: body.params });
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, ...answer(body.method) }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("issues exactly eth_getTransactionByHash to the proxy and normalizes a finalized answer", async () => {
    // The shape a FINALIZED Studio Next transaction returned live, trimmed
    // to what the SDK's Studio path and normalizeTxView touch.
    stubProxy(() => ({
      result: {
        hash: HASH,
        status: "FINALIZED",
        result_name: "MAJORITY_AGREE",
        from_address: "0x" + "12".repeat(20),
        to_address: "0x" + "ab".repeat(20),
        data: null,
        consensus_data: {
          leader_receipt: [{ execution_result: "SUCCESS" }, { execution_result: "ERROR" }],
        },
      },
    }));
    const v = await getTransactionStatus(HASH);
    expect(v).toEqual({ statusName: "FINALIZED", finalized: true, executed: "SUCCESS" });
    expect(seen.map((s) => s.method)).toEqual(["eth_getTransactionByHash"]);
    expect(seen[0].url).toBe("/api/rpc");
    expect(seen[0].params).toEqual([HASH]);
  });

  it("treats the chain's not-found error as 'not seen yet', not as a failed read", async () => {
    // Studio Next answers an unknown hash with a JSON-RPC error, which viem
    // raises as ResourceNotFoundRpcError; 1.1.8 returned null instead. Either
    // way the poll must continue rather than report the write failed.
    stubProxy(() => ({ error: { code: -32001, message: "Requested resource not found." } }));
    const v = await getTransactionStatus(HASH);
    expect(v).toEqual({ statusName: "UNKNOWN", finalized: false, executed: "UNKNOWN" });
  });

  it("still raises a real read failure", async () => {
    stubProxy(() => ({
      error: { code: -32029, message: "[transient] This page is reading the chain faster than Studio Next allows." },
    }));
    await expect(getTransactionStatus(HASH)).rejects.toMatchObject({ name: "ReadError", transient: true });
  });
});
