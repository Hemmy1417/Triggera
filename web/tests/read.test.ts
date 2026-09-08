/**
 * The finality normalizer, pinned against the transaction shapes StudioNet
 * has actually produced — and Studio Next was measured to reproduce under
 * genlayer-js 2.0.0-rc.1 — because this function decides whether a user is
 * told a write is irreversible, so every measured shape is a fixture. The
 * last block drives the real status read through the real SDK against a
 * stubbed proxy, pinning that the SDK's Studio path issues the one method
 * the proxy forwards for it and nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abi } from "genlayer-js";
import {
  getDecision,
  getPackage,
  getPolicy,
  getTransactionStatus,
  invalidateReads,
  normalizeTxView,
} from "@/lib/read";

const { calldata } = abi;

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

/**
 * "Nothing here" is an empty string on the wire. Every one of these accessors
 * declares a nullable document, so the empty string must never reach a caller
 * wearing that type: a page that trusted the declaration would render the
 * fields of a string as undefined and call it an investigation. `??` does not
 * catch "", so this is pinned rather than assumed.
 */
describe("an absent document reads as null, not as an empty string", () => {
  const ABSENT = "0x04"; // calldata for "", which is what the contract returns
  const seen: string[] = [];

  function stubAbsent() {
    seen.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, opts: { body?: string } | undefined) => {
        const body = JSON.parse(opts?.body ?? "{}") as { id?: number; method: string };
        seen.push(body.method);
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, result: ABSENT }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  }

  beforeEach(() => {
    invalidateReads();
    stubAbsent();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a policy that was never written", async () => {
    await expect(getPolicy("trg-999999")).resolves.toBeNull();
    expect(seen).toEqual(["gen_call"]);
  });

  it("a version no panel has judged", async () => {
    await expect(getDecision("trg-000001", 1)).resolves.toBeNull();
  });

  it("a version with no claim package", async () => {
    await expect(getPackage("trg-000001", 1)).resolves.toBeNull();
  });

  it("an absent decision is not held by the indefinite cache", async () => {
    // Only a decision that exists is kept forever. An absent one must be
    // re-read, or a version judged after it was first looked at would stay
    // invisible for the life of the tab.
    await expect(getDecision("trg-000002", 1)).resolves.toBeNull();
    invalidateReads();
    vi.unstubAllGlobals();
    const decided = { policy_id: "trg-000002", version: 1, outcome: "SATISFIED" };
    const hex =
      "0x" +
      Buffer.from(calldata.encode(JSON.stringify(decided)) as Uint8Array).toString("hex");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, o: { body?: string } | undefined) =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(o?.body ?? "{}").id ?? 1, result: hex }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(getDecision("trg-000002", 1)).resolves.toMatchObject({ outcome: "SATISFIED" });
  });
});
