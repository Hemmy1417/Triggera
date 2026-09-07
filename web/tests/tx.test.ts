import { describe, expect, it, vi } from "vitest";
import {
  STAGE_LABEL, STAGE_TRACK, stageClass, writeAndConfirm, type TxProgress,
  type WriteArgs, inFlight, stateVisible, contractRefusal, passingFailure, floorFee, FEE_FLOOR_ATTO,
} from "@/lib/tx";
import type { TxFinalityView } from "@/lib/read";

/** What the SDK's estimate hands back for a plain write: a distribution, a
 *  deposit, no message allocations. Shapes follow genlayer-js 2.0.0-rc.1. */
const ESTIMATE = {
  distribution: {
    leaderTimeunitsAllocation: 100n,
    validatorTimeunitsAllocation: 200n,
    appealRounds: 0n,
    executionBudgetPerRound: 76548000000000n,
    executionConsumed: 0n,
    totalMessageFees: 0n,
    rotations: [3n],
    maxPriceGenPerTimeUnit: 2n,
    storageFeeMaxGasPrice: 300000000n,
    receiptFeeMaxGasPrice: 300000000n,
  },
  feeValue: 10n ** 17n,
  messageAllocations: undefined,
};

const okClient = (hash = "0xabc", estimate: unknown = ESTIMATE) => ({
  estimateTransactionFeesForWrite: vi.fn().mockResolvedValue(estimate),
  writeContract: vi.fn().mockResolvedValue(hash),
});

/**
 * The refusal exactly as it reaches lib/tx.ts on Studio Next: viem's
 * InvalidInputRpcError wrapping the raw JSON-RPC error, whose receipt result
 * is base64 of "\x01[EXPECTED] unknown agreement" (measured bytes).
 */
const rpcRefusal = () =>
  Object.assign(
    new Error(
      "Missing or invalid parameters.\nDouble check you have provided the correct parameters.\n\n" +
        "Details: execution failed\nVersion: viem@2.56.3",
    ),
    {
      name: "InvalidInputRpcError",
      code: -32000,
      details: "execution failed",
      shortMessage: "Missing or invalid parameters.\nDouble check you have provided the correct parameters.",
      cause: {
        code: -32000,
        message: "execution failed",
        data: {
          receipt: {
            execution_result: "ERROR",
            result: "AVtFWFBFQ1RFRF0gdW5rbm93biBhZ3JlZW1lbnQ=",
            mode: "leader",
          },
        },
      },
    },
  );

/** A status reader with a fixed answer — the finality watch's collaborator. */
const status =
  (statusName: string, executed: TxFinalityView["executed"] = "UNKNOWN") =>
  async (): Promise<TxFinalityView> => ({
    statusName,
    finalized: statusName === "FINALIZED",
    executed,
  });

const FINAL_OK = status("FINALIZED", "SUCCESS");

describe("the transaction stepper", () => {
  it("lights the current stage and marks earlier ones done", () => {
    expect(stageClass("estimating", "estimating")).toBe("step on");
    expect(stageClass("estimating", "wallet")).toBe("step done");
    expect(stageClass("wallet", "wallet")).toBe("step on");
    expect(stageClass("wallet", "pending")).toBe("step done");
    expect(stageClass("confirmed", "pending")).toBe("step");
    expect(stageClass("confirmed", "confirmed")).toBe("step on");
    expect(stageClass("accepted", "accepted")).toBe("step on");
    expect(stageClass("accepted", "confirmed")).toBe("step done");
    expect(stageClass("confirmed", "accepted")).toBe("step");
  });

  it("marks the track failed when the user declines", () => {
    expect(stageClass("wallet", "rejected")).toBe("step fail");
    expect(stageClass("wallet", "failed")).toBe("step fail");
    // the estimate completed before the wallet declined
    expect(stageClass("estimating", "rejected")).toBe("step done");
  });

  it("paints a failure on the stage the report names, not always on the wallet", () => {
    // a refusal in the fee simulation never reached the wallet
    expect(stageClass("estimating", "failed", "estimating")).toBe("step fail");
    expect(stageClass("wallet", "failed", "estimating")).toBe("step");
    // a finalized refusal got as far as pending
    expect(stageClass("pending", "failed", "pending")).toBe("step fail");
    expect(stageClass("wallet", "failed", "pending")).toBe("step done");
    expect(stageClass("accepted", "failed", "pending")).toBe("step");
  });

  it("labels every stage", () => {
    for (const s of STAGE_TRACK) expect(STAGE_LABEL[s]).toBeTruthy();
    expect(STAGE_LABEL.rejected).toMatch(/declined/i);
  });

  it("estimating is the first stage of the track, ahead of the wallet", () => {
    expect(STAGE_TRACK[0]).toBe("estimating");
    expect(STAGE_TRACK.indexOf("wallet")).toBe(1);
    expect(STAGE_LABEL.estimating).toMatch(/fee/i);
  });
});

describe("writeAndConfirm — a write is sized before it is signed", () => {
  it("estimates first, shows the deposit at the wallet step, and hands the fees to writeContract", async () => {
    vi.useFakeTimers();
    const client = okClient();
    const seen: TxProgress[] = [];
    const p = writeAndConfirm({
      client,
      address: "0x" + "8".repeat(40),
      functionName: "fund",
      args: ["agr-000001"],
      valueAtto: 10n ** 18n,
      predicate: async () => true,
      txStatus: FINAL_OK,
      onProgress: (x) => seen.push({ ...x }),
    });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    await vi.advanceTimersByTimeAsync(6000); // let the finality watch close

    expect(client.estimateTransactionFeesForWrite).toHaveBeenCalledWith({
      address: "0x" + "8".repeat(40),
      functionName: "fund",
      args: ["agr-000001"],
      value: 10n ** 18n,
    });
    expect(client.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "fund",
        value: 10n ** 18n,
        fees: {
          distribution: ESTIMATE.distribution,
          feeValue: 10n ** 17n,
          messageAllocations: undefined,
        },
      }),
    );
    // the estimate ran before the wallet was asked, and the user saw the deposit
    expect(seen.map((s) => s.stage).slice(0, 3)).toEqual(["estimating", "wallet", "submitted"]);
    expect(seen[1].detail).toMatch(/fee deposit 0\.100 GEN/);
    expect(seen[1].detail).toMatch(/refunded/);
    // the estimate happened-before the write
    expect(client.estimateTransactionFeesForWrite.mock.invocationCallOrder[0]).toBeLessThan(
      client.writeContract.mock.invocationCallOrder[0],
    );
    vi.useRealTimers();
  });

  it("passes the message allocations through — claim() emits a transfer the Studio refuses without them", async () => {
    vi.useFakeTimers();
    const allocations = [
      {
        messageType: 0,
        onAcceptance: false,
        parentIndex: 0n,
        recipient: "0x" + "9".repeat(40),
        callKey: "0x" + "00".repeat(32),
        budget: 5n * 10n ** 14n,
        feeParams: "0x",
      },
    ];
    const client = okClient("0xabc", { ...ESTIMATE, messageAllocations: allocations });
    const p = writeAndConfirm({
      client,
      address: "0x" + "9".repeat(40),
      functionName: "claim",
      args: [],
      predicate: async () => true,
      txStatus: FINAL_OK,
    });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ fees: expect.objectContaining({ messageAllocations: allocations }) }),
    );
    vi.useRealTimers();
  });

  it("floors the deposit at 0.001 GEN when the Studio estimates less", async () => {
    vi.useFakeTimers();
    const client = okClient("0xabc", { ...ESTIMATE, feeValue: 5n });
    const seen: TxProgress[] = [];
    const p = writeAndConfirm({
      client,
      address: "0x" + "a".repeat(40),
      functionName: "promote",
      args: ["agr-000001"],
      predicate: async () => true,
      txStatus: FINAL_OK,
      onProgress: (x) => seen.push({ ...x }),
    });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ fees: expect.objectContaining({ feeValue: FEE_FLOOR_ATTO }) }),
    );
    expect(seen[1].detail).toMatch(/fee deposit 0\.001 GEN/);
    expect(floorFee(0n)).toBe(FEE_FLOOR_ATTO);
    expect(floorFee(FEE_FLOOR_ATTO)).toBe(FEE_FLOOR_ATTO);
    expect(floorFee(10n ** 17n)).toBe(10n ** 17n);
    vi.useRealTimers();
  });

  it("surfaces a refusal from the simulation verbatim and sends nothing", async () => {
    const seen: TxProgress[] = [];
    const client = {
      estimateTransactionFeesForWrite: vi.fn().mockRejectedValue(rpcRefusal()),
      writeContract: vi.fn(),
    };
    await expect(
      writeAndConfirm({
        client,
        address: "0x" + "b".repeat(40),
        functionName: "fund",
        args: ["agr-does-not-exist"],
        predicate: async () => true,
        onProgress: (x) => seen.push({ ...x }),
      }),
    ).rejects.toThrow(/\[EXPECTED\] unknown agreement/);
    expect(client.writeContract).not.toHaveBeenCalled();
    const last = seen.at(-1)!;
    expect(last.stage).toBe("failed");
    expect(last.at).toBe("estimating");
    expect(last.detail).toContain("[EXPECTED] unknown agreement");
    expect(last.detail).toMatch(/nothing was sent/);
    expect(last.detail).not.toMatch(/double check/i);
    expect(inFlight(last.stage)).toBe(false);
  });

  it("honours the [EXPECTED] marker when a refusal arrives as plain text", async () => {
    const seen: TxProgress[] = [];
    const client = {
      estimateTransactionFeesForWrite: vi
        .fn()
        .mockRejectedValue(new Error("gen_call failed: [EXPECTED] the agreement is not open for funding")),
      writeContract: vi.fn(),
    };
    await expect(
      writeAndConfirm({
        client,
        address: "0x" + "b".repeat(40),
        functionName: "fund",
        args: ["agr-000002"],
        predicate: async () => true,
        onProgress: (x) => seen.push({ ...x }),
      }),
    ).rejects.toThrow(/\[EXPECTED\] the agreement is not open for funding/);
    expect(seen.at(-1)?.detail).toContain("[EXPECTED] the agreement is not open for funding");
    expect(client.writeContract).not.toHaveBeenCalled();
  });

  it("calls a [TRANSIENT] simulation result a passing failure to retry, not a refusal", async () => {
    // Every timed write refuses with [TRANSIENT] while the clock witnesses
    // are down (contracts/verda.py _require_clock). The same write goes
    // through on the next attempt, so "refused" would be the wrong word.
    const seen: TxProgress[] = [];
    const client = {
      estimateTransactionFeesForWrite: vi.fn().mockRejectedValue(
        Object.assign(new Error("Missing or invalid parameters."), {
          cause: {
            code: -32000,
            message: "execution failed",
            data: {
              receipt: {
                execution_result: "ERROR",
                result: btoa("\x01[TRANSIENT] the clock could not be read from two witnesses"),
              },
            },
          },
        }),
      ),
      writeContract: vi.fn(),
    };
    await expect(
      writeAndConfirm({
        client,
        address: "0x" + "b".repeat(40),
        functionName: "fund",
        args: ["agr-000003"],
        predicate: async () => true,
        onProgress: (x) => seen.push({ ...x }),
      }),
    ).rejects.toThrow(/\[TRANSIENT\] the clock could not be read/);
    const last = seen.at(-1)!;
    expect(last.stage).toBe("failed");
    expect(last.detail).toContain("[TRANSIENT] the clock could not be read from two witnesses");
    expect(last.detail).toMatch(/nothing was sent/);
    expect(last.detail).toMatch(/retrying usually works/i);
    expect(last.detail).not.toMatch(/refused/i);
    expect(client.writeContract).not.toHaveBeenCalled();
  });

  it("names a transport failure at the estimate and sends nothing", async () => {
    const seen: TxProgress[] = [];
    // how viem reports an unreachable RPC: a generic wrapper with the real
    // reason in `details`
    const err = Object.assign(new Error("An unknown RPC error occurred."), {
      name: "UnknownRpcError",
      details: "fetch failed",
    });
    const client = {
      estimateTransactionFeesForWrite: vi.fn().mockRejectedValue(err),
      writeContract: vi.fn(),
    };
    await expect(
      writeAndConfirm({
        client,
        address: "0x" + "c".repeat(40),
        functionName: "fund",
        args: [],
        predicate: async () => true,
        onProgress: (x) => seen.push({ ...x }),
      }),
    ).rejects.toThrow(/could not be reached/);
    expect(client.writeContract).not.toHaveBeenCalled();
    const last = seen.at(-1)!;
    expect(last.stage).toBe("failed");
    expect(last.at).toBe("estimating");
    expect(last.detail).toMatch(/Studio Next could not be reached/);
    expect(last.detail).toMatch(/nothing was sent/);
  });

  it("names any other estimate failure and sends nothing", async () => {
    const seen: TxProgress[] = [];
    const client = {
      estimateTransactionFeesForWrite: vi
        .fn()
        .mockRejectedValue(new Error("sim_getFeeConfig did not expose a policy object.")),
      writeContract: vi.fn(),
    };
    await expect(
      writeAndConfirm({
        client,
        address: "0x" + "c".repeat(40),
        functionName: "fund",
        args: [],
        predicate: async () => true,
        onProgress: (x) => seen.push({ ...x }),
      }),
    ).rejects.toThrow(/did not expose a policy object/);
    expect(client.writeContract).not.toHaveBeenCalled();
    expect(seen.at(-1)?.detail).toMatch(/fee estimate failed, so nothing was sent/);
  });
});

describe("contractRefusal — the contract's sentence out of viem's wrapper", () => {
  it("decodes the base64 receipt result three levels down", () => {
    expect(contractRefusal(rpcRefusal())).toBe("[EXPECTED] unknown agreement");
  });

  it("reads the marker out of plain text", () => {
    expect(contractRefusal(new Error("gen_call failed: [EXPECTED] nothing to claim")))
      .toBe("[EXPECTED] nothing to claim");
    expect(contractRefusal({ message: "[EXPECTED] bond must equal the floor\nsecond line" }))
      .toBe("[EXPECTED] bond must equal the floor");
  });

  it("honours every tag of the contract's taxonomy, and knows which ones pass", () => {
    expect(contractRefusal(new Error("[EXTERNAL] the source answered 404")))
      .toBe("[EXTERNAL] the source answered 404");
    expect(contractRefusal(new Error("x [LLM_ERROR] the model returned no reading")))
      .toBe("[LLM_ERROR] the model returned no reading");
    expect(passingFailure("[TRANSIENT] clock down")).toBe(true);
    expect(passingFailure("[LLM_ERROR] garbage")).toBe(true);
    expect(passingFailure("[EXPECTED] unknown agreement")).toBe(false);
    expect(passingFailure("[EXTERNAL] 404")).toBe(false);
  });

  it("treats an execution error without the marker as a refusal, with its text", () => {
    const text = "some other rollback";
    const err = { cause: { data: { receipt: { execution_result: "ERROR", result: btoa("\x01" + text) } } } };
    expect(contractRefusal(err)).toBe(`The contract refused this write: ${text}`);
  });

  it("is null for everything that is not a refusal", () => {
    expect(contractRefusal(new Error("fetch failed"))).toBeNull();
    expect(contractRefusal({ code: 4001, message: "User rejected the request." })).toBeNull();
    expect(contractRefusal(null)).toBeNull();
    expect(contractRefusal("execution failed")).toBeNull();
    // a SUCCESSFUL receipt on the cause chain is not a refusal
    expect(contractRefusal({ cause: { data: { receipt: { execution_result: "SUCCESS", result: "AA==" } } } })).toBeNull();
  });
});

describe("writeAndConfirm — confirmation is a contract read, not a receipt", () => {
  it("does not accept until the view predicate says the chain caught up", async () => {
    vi.useFakeTimers();
    const seen: TxProgress[] = [];
    let landed = false;
    const p = writeAndConfirm({
      client: okClient(),
      address: "0x" + "1".repeat(40),
      functionName: "fund",
      args: ["agr-000001"],
      valueAtto: 10n ** 18n,
      predicate: async () => landed,
      txStatus: FINAL_OK,
      onProgress: (x) => seen.push({ ...x }),
    });

    await vi.advanceTimersByTimeAsync(6000);
    // the write was submitted, but the state has NOT been observed yet
    expect(seen.map((s) => s.stage)).toContain("submitted");
    expect(seen.some((s) => s.stage === "accepted")).toBe(false);
    expect(seen.some((s) => s.stage === "confirmed")).toBe(false);

    landed = true;
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    // resolution happens at accepted — the state is readable from here —
    // and the finality watch reports confirmed on its own clock
    expect(seen.at(-1)?.stage).toBe("accepted");
    await vi.advanceTimersByTimeAsync(6000);
    expect(seen.at(-1)?.stage).toBe("confirmed");
    vi.useRealTimers();
  });

  it("passes the payable value through to the contract call", async () => {
    vi.useFakeTimers();
    const client = okClient();
    const p = writeAndConfirm({
      client,
      address: "0x" + "2".repeat(40),
      functionName: "fund",
      args: ["agr-000002"],
      valueAtto: 2n * 10n ** 18n,
      predicate: async () => true,
      txStatus: FINAL_OK,
    });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    await vi.advanceTimersByTimeAsync(6000); // let the finality watch close
    expect(client.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "fund", value: 2n * 10n ** 18n }),
    );
    vi.useRealTimers();
  });

  it("reports a declined signature as REJECTED, not as a failure", async () => {
    const seen: TxProgress[] = [];
    const client = {
      estimateTransactionFeesForWrite: vi.fn().mockResolvedValue(ESTIMATE),
      writeContract: vi.fn().mockRejectedValue({ code: 4001 }),
    };
    await expect(
      writeAndConfirm({
        client,
        address: "0x" + "3".repeat(40),
        functionName: "fund",
        args: [],
        predicate: async () => true,
        onProgress: (x) => seen.push({ ...x }),
      }),
    ).rejects.toBeDefined();
    expect(seen.at(-1)?.stage).toBe("rejected");
    expect(seen.at(-1)?.at).toBe("wallet");
    expect(seen.at(-1)?.detail).toMatch(/declined/i);
  });

  it("refuses to pretend when no wallet is connected", async () => {
    const seen: TxProgress[] = [];
    await expect(
      writeAndConfirm({
        client: null,
        address: "0x" + "4".repeat(40),
        functionName: "fund",
        args: [],
        predicate: async () => true,
        onProgress: (x) => seen.push({ ...x }),
      }),
    ).rejects.toThrow(/no wallet/i);
    expect(seen.at(-1)?.stage).toBe("failed");
  });

  it("keeps polling through transient read noise", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = writeAndConfirm({
      client: okClient(),
      address: "0x" + "5".repeat(40),
      functionName: "fund",
      args: [],
      predicate: async () => {
        calls++;
        if (calls < 3) throw new Error("429 rate limit");  // throttled, not failed
        return true;
      },
      txStatus: FINAL_OK,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBe("0xabc");
    expect(calls).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(6000); // let the finality watch close
    vi.useRealTimers();
  });

  it("says a slow write is not lost, rather than calling it failed", async () => {
    vi.useFakeTimers();
    const seen: TxProgress[] = [];
    const p = writeAndConfirm({
      client: okClient(),
      address: "0x" + "6".repeat(40),
      functionName: "fund",
      args: [],
      predicate: async () => false,          // never observed
      onProgress: (x) => seen.push({ ...x }),
      predicateTries: 2,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await p;
    const last = seen.at(-1)!;
    // NOT "failed": the write may well have landed and we simply stopped
    // looking. NOT "pending" either, which every `working` check counts as in
    // flight and which left the button that fired the write disabled forever.
    expect(last.stage).toBe("unresolved");
    expect(last.detail).toMatch(/not lost/i);
    expect(inFlight(last.stage)).toBe(false);
    vi.useRealTimers();
  });
});

describe("a control must never be stranded by an unresolved confirmation", () => {
  it("does not count unresolved as in flight", () => {
    // The poll gave up without an answer. The state is genuinely unknown, so
    // it must not read as failed, but it must stop disabling the control:
    // leaving it "pending" kept the button that fired the write disabled for
    // the life of the component, so the user could neither retry nor find out
    // whether their money had moved.
    expect(inFlight("unresolved")).toBe(false);
  });

  it("counts every genuinely in-flight stage", () => {
    expect(inFlight("estimating")).toBe(true);
    expect(inFlight("wallet")).toBe(true);
    expect(inFlight("submitted")).toBe(true);
    expect(inFlight("pending")).toBe(true);
  });

  it("counts every settled stage as not in flight", () => {
    // accepted is settled for CONTROL purposes: the state is live, every
    // read sees it, and holding the button disabled for the finality watch
    // would block a user whose write has already taken effect.
    for (const s of ["idle", "accepted", "confirmed", "failed", "rejected"] as const) {
      expect(inFlight(s), s).toBe(false);
    }
  });

  it("gives unresolved a label that claims neither success nor failure", () => {
    expect(STAGE_LABEL.unresolved).toBe("Not yet visible");
    expect(STAGE_LABEL.unresolved).not.toMatch(/fail|error|success|confirmed/i);
  });

  it("shows the progress an unresolved write actually made", () => {
    // It reached pending. Blanking the track would hide that the write was
    // sent at all.
    expect(stageClass("estimating", "unresolved")).toContain("done");
    expect(stageClass("submitted", "unresolved")).toContain("done");
    expect(stageClass("accepted", "unresolved")).not.toContain("done");
    expect(stageClass("confirmed", "unresolved")).not.toContain("done");
  });
});

describe("finality is tracked, not presumed — a contract read is ACCEPTED, not FINALIZED", () => {
  const base = (
    overrides: Partial<WriteArgs> & Pick<WriteArgs, "predicate">,
  ): WriteArgs => ({
    client: okClient(),
    address: "0x" + "7".repeat(40),
    functionName: "fund",
    args: [],
    ...overrides,
  });

  it("separates the claims: accepted for the state read, finalized only from the transaction", () => {
    // The word "Finalized" must be earned by the transaction reporting
    // FINALIZED — never by a view read, which proves acceptance at most.
    expect(STAGE_LABEL.accepted).toBe("Accepted");
    expect(STAGE_LABEL.confirmed).toBe("Finalized");
    expect(STAGE_TRACK.indexOf("accepted")).toBeGreaterThan(STAGE_TRACK.indexOf("pending"));
    expect(STAGE_TRACK.indexOf("confirmed")).toBeGreaterThan(STAGE_TRACK.indexOf("accepted"));
  });

  it("says finalized only after the transaction reports FINALIZED with a successful execution", async () => {
    vi.useFakeTimers();
    const seen: TxProgress[] = [];
    let finalized = false;
    const p = writeAndConfirm(base({
      predicate: async () => true,
      txStatus: async (): Promise<TxFinalityView> =>
        finalized
          ? { statusName: "FINALIZED", finalized: true, executed: "SUCCESS" }
          : { statusName: "ACCEPTED", finalized: false, executed: "SUCCESS" },
      onProgress: (x: TxProgress) => seen.push({ ...x }),
    }));
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(seen.at(-1)?.stage).toBe("accepted");
    expect(seen.at(-1)?.detail).toMatch(/accepted the write/i);

    // still ACCEPTED on-chain: the watch must not upgrade the claim
    await vi.advanceTimersByTimeAsync(12_000);
    expect(seen.at(-1)?.stage).toBe("accepted");

    finalized = true;
    await vi.advanceTimersByTimeAsync(6000);
    expect(seen.at(-1)?.stage).toBe("confirmed");
    expect(seen.at(-1)?.detail).toMatch(/finalized/i);
    vi.useRealTimers();
  });

  it("stops claiming anything final when the watch runs out, and says so", async () => {
    vi.useFakeTimers();
    const seen: TxProgress[] = [];
    const p = writeAndConfirm(base({
      predicate: async () => true,
      txStatus: status("ACCEPTED"),   // never finalizes while we watch
      finalityTries: 3,
      onProgress: (x: TxProgress) => seen.push({ ...x }),
    }));
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    await vi.advanceTimersByTimeAsync(3 * 6000);
    const last = seen.at(-1)!;
    expect(last.stage).toBe("accepted");
    expect(last.detail).toMatch(/not yet reported it finalized/i);
    expect(last.detail).toMatch(/irreversible only once/i);
    expect(seen.some((s) => s.stage === "confirmed")).toBe(false);
    vi.useRealTimers();
  });

  it("reports a finalized refusal as failed instead of letting the user wait out the poll", async () => {
    vi.useFakeTimers();
    const seen: TxProgress[] = [];
    const p = writeAndConfirm(base({
      predicate: async () => false,                 // the state never appears…
      txStatus: status("FINALIZED", "ERROR"),       // …because the write was refused
      onProgress: (x: TxProgress) => seen.push({ ...x }),
    }));
    const outcome = expect(p).rejects.toThrow(/refused/i);
    await vi.advanceTimersByTimeAsync(3 * 6000);    // the third miss checks the tx
    await outcome;
    expect(seen.at(-1)?.stage).toBe("failed");
    expect(seen.at(-1)?.at).toBe("pending");
    expect(seen.at(-1)?.detail).toMatch(/nothing moved/i);
    vi.useRealTimers();
  });

  it("credits the state, not this transaction, when a permissionless call was beaten to it", async () => {
    vi.useFakeTimers();
    const seen: TxProgress[] = [];
    const p = writeAndConfirm(base({
      predicate: async () => true,                  // the agreement state IS there…
      txStatus: status("FINALIZED", "ERROR"),       // …but this tx finalized as a no-op
      confirmedDetail: "This agreement now carries a verdict.",
      onProgress: (x: TxProgress) => seen.push({ ...x }),
    }));
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    await vi.advanceTimersByTimeAsync(6000);
    const last = seen.at(-1)!;
    expect(last.stage).toBe("confirmed");
    expect(last.detail).toMatch(/carries a verdict/);
    expect(last.detail).toMatch(/another transaction/i);
    vi.useRealTimers();
  });

  it("stateVisible answers exactly the follow-up-action question", () => {
    for (const s of ["accepted", "confirmed"] as const) {
      expect(stateVisible(s), s).toBe(true);
    }
    for (const s of ["idle", "estimating", "wallet", "submitted", "pending", "unresolved", "rejected", "failed"] as const) {
      expect(stateVisible(s), s).toBe(false);
    }
  });
});
