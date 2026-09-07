/**
 * Repository-level proof that Verda contract writes are SIGNED by the
 * connected wallet and FUNDED before they leave.
 *
 * Signed: the wallet context builds its client with the chosen EIP-1193
 * provider (createClient({chain, account, provider})), and the write path
 * (lib/tx.ts writeAndConfirm → client.writeContract) rides that client —
 * never genlayer-js's implicit window.ethereum fallback.
 *
 * Funded: Studio Next's consensus contract reverts a transaction with no fee
 * distribution or a zero deposit, and genlayer-js 2.0.0-rc.1 will happily
 * send exactly that when writeContract is called without `fees`. So the
 * suite drives the REAL SDK against a method-aware RPC stub whose answers
 * are the shapes Studio Next was measured to return, and reads the
 * transaction the provider was asked to sign: its calldata must decode to an
 * addTransaction carrying a non-empty distribution, its value must be the
 * user's value plus the deposit, and the fee RPCs must have travelled over
 * fetch to the chain's RPC URL — never through the wallet, never through the
 * read proxy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "genlayer-js";
import { decodeFunctionData } from "viem";
import { STUDIO_NEXT } from "@/lib/chain";
import { GENLAYER_RPC_URL } from "@/lib/config";
import { FEE_FLOOR_ATTO, writeAndConfirm, type TxProgress } from "@/lib/tx";

const ACCOUNT = ("0x" + "12".repeat(20)) as `0x${string}`;
const CONTRACT = ("0x" + "ab".repeat(20)) as `0x${string}`;
const TX_HASH = ("0x" + "cd".repeat(32)) as `0x${string}`;
const CONSENSUS = (STUDIO_NEXT as { consensusMainContract: { address: string } })
  .consensusMainContract.address;

// ── what Studio Next answers, measured on 2026-09-05 against the live RPC ──

/** sim_getFeeConfig, trimmed to the fields the SDK reads. */
const FEE_CONFIG = {
  enabled: true,
  policy: {
    genPerTimeUnit: "1",
    storageUnitPrice: "250000000",
    receiptGasPrice: "250000000",
    intrinsicGas: "21000",
    bootloaderOverhead: "60000",
    gasPerChangedSlot: "1000",
    calldataGasPerByte: "16",
    fixedProposeReceiptGas: "210000",
    fixedMessageRevealGas: "100000",
    messageFeeParamsBudgetFloor: "76548000000000",
    timeUnitOverlayBps: "1500",
  },
};

const DEPOSIT = 10n ** 17n; // 0.1 GEN — the deposit observed on live writes

/** sim_estimateTransactionFees for a write the contract accepts: the SDK
 *  takes `recommendedPreset` as authoritative and passes it through. */
const FEE_ESTIMATE = {
  recommendedPreset: {
    distribution: {
      leaderTimeunitsAllocation: "100",
      validatorTimeunitsAllocation: "200",
      appealRounds: "0",
      executionBudgetPerRound: "76548000000000",
      executionConsumed: "0",
      totalMessageFees: "0",
      rotations: ["3"],
      maxPriceGenPerTimeUnit: "2",
      storageFeeMaxGasPrice: "300000000",
      receiptFeeMaxGasPrice: "300000000",
    },
    feeValue: DEPOSIT.toString(),
  },
};

/** sim_estimateTransactionFees for a write the contract REFUSES: a JSON-RPC
 *  error whose receipt result is base64 of one tag byte followed by the
 *  contract's sentence — these exact bytes came back for fund("agr-does-not-exist"). */
const REFUSAL = {
  code: -32000,
  message: "execution failed",
  data: {
    receipt: {
      vote: null,
      execution_result: "ERROR",
      result: "AVtFWFBFQ1RFRF0gdW5rbm93biBhZ3JlZW1lbnQ=", // \x01[EXPECTED] unknown agreement
      gas_used: 0,
      mode: "leader",
    },
    params: {},
  },
};

/** The envelope receipt the SDK waits for after eth_sendTransaction. */
const RECEIPT = {
  transactionHash: TX_HASH,
  transactionIndex: "0x0",
  blockHash: "0x" + "ef".repeat(32),
  blockNumber: "0x1",
  from: ACCOUNT,
  to: CONSENSUS,
  cumulativeGasUsed: "0x5208",
  gasUsed: "0x5208",
  effectiveGasPrice: "0x1",
  contractAddress: null,
  logs: [],
  logsBloom: "0x" + "00".repeat(256),
  status: "0x1",
  type: "0x0",
};

type RpcAnswer = { result: unknown } | { error: { code: number; message: string; data?: unknown } };

// The SDK reads nonce, gas and the fee machinery over a fetch-based JSON-RPC
// transport (not the wallet provider), so the stub answers each method with
// its own typed shape — an object for everything would throw in a BigInt()
// conversion before the write ever reached eth_sendTransaction.
const DEFAULT_ANSWERS: Record<string, RpcAnswer> = {
  eth_chainId:                 { result: `0x${STUDIO_NEXT.id.toString(16)}` },
  eth_getTransactionCount:     { result: "0x0" },
  eth_estimateGas:             { result: "0x30d40" },
  eth_gasPrice:                { result: "0x1" },
  eth_maxPriorityFeePerGas:    { result: "0x1" },
  eth_blockNumber:             { result: "0x1" },
  eth_getBalance:              { result: "0x0" },
  eth_call:                    { result: "0x" },
  eth_getTransactionReceipt:   { result: RECEIPT },
  sim_getFeeConfig:            { result: FEE_CONFIG },
  sim_estimateTransactionFees: { result: FEE_ESTIMATE },
};

/** Every JSON-RPC call that went over fetch: which method, to which URL. */
const rpcCalls: Array<{ url: string; method: string }> = [];

function installRpc(overrides: Record<string, RpcAnswer> = {}) {
  rpcCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, opts: { body?: string } | undefined) => {
      let body: unknown = {};
      try { body = JSON.parse(opts?.body ?? "{}"); } catch { /* non-JSON */ }
      const one = (b: { id?: number; method?: string }) => {
        const method = b?.method ?? "";
        rpcCalls.push({ url: String(url), method });
        const answer = overrides[method] ?? DEFAULT_ANSWERS[method] ?? { result: "0x1" };
        return { jsonrpc: "2.0", id: b?.id ?? 1, ...answer };
      };
      const payload = Array.isArray(body)
        ? body.map(one)
        : one(body as { id?: number; method?: string });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

beforeEach(() => {
  installRpc();
  // The SDK logs every RPC error and every provider hand-off; the refusal
  // test provokes both on purpose.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function recordingProvider() {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const provider = {
    isMetaMask: true,
    request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
      calls.push({ method, params });
      switch (method) {
        case "eth_chainId":             return `0x${STUDIO_NEXT.id.toString(16)}`;
        case "eth_accounts":
        case "eth_requestAccounts":     return [ACCOUNT];
        case "eth_sendTransaction":     return TX_HASH;
        default:                         return "0x1";
      }
    },
    on: () => {},
    removeListener: () => {},
  };
  return { provider, calls };
}

function providerClient() {
  const { provider, calls } = recordingProvider();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const client: any = createClient({ chain: STUDIO_NEXT, account: ACCOUNT, provider });
  return { client, calls };
}

// The consensus contract's fee-aware entry point, as the SDK encodes it. Kept
// here rather than imported: the SDK does not export the ABI, and the test
// must decode what was SENT, not what the SDK says it sends.
const ADD_TRANSACTION_WITH_FEES = [
  {
    type: "function",
    name: "addTransaction",
    stateMutability: "payable",
    inputs: [
      {
        name: "_params",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "recipient", type: "address" },
          { name: "numOfInitialValidators", type: "uint256" },
          { name: "maxRotations", type: "uint256" },
          { name: "validUntil", type: "uint256" },
          { name: "saltNonce", type: "uint256" },
          { name: "userValue", type: "uint256" },
          {
            name: "feesDistribution",
            type: "tuple",
            components: [
              { name: "leaderTimeunitsAllocation", type: "uint256" },
              { name: "validatorTimeunitsAllocation", type: "uint256" },
              { name: "appealRounds", type: "uint256" },
              { name: "executionBudgetPerRound", type: "uint256" },
              { name: "executionConsumed", type: "uint256" },
              { name: "totalMessageFees", type: "uint256" },
              { name: "rotations", type: "uint256[]" },
              { name: "maxPriceGenPerTimeUnit", type: "uint256" },
              { name: "storageFeeMaxGasPrice", type: "uint256" },
              { name: "receiptFeeMaxGasPrice", type: "uint256" },
            ],
          },
          { name: "txCalldata", type: "bytes" },
          {
            name: "messageAllocations",
            type: "tuple[]",
            components: [
              { name: "messageType", type: "uint8" },
              { name: "onAcceptance", type: "bool" },
              { name: "parentIndex", type: "uint256" },
              { name: "recipient", type: "address" },
              { name: "callKey", type: "bytes32" },
              { name: "budget", type: "uint256" },
              { name: "feeParams", type: "bytes" },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
] as const;

type SentTx = { from: string; to: string; data: `0x${string}`; value: string };
type AddTxParams = {
  recipient: string;
  userValue: bigint;
  feesDistribution: {
    leaderTimeunitsAllocation: bigint;
    validatorTimeunitsAllocation: bigint;
    executionBudgetPerRound: bigint;
    rotations: readonly bigint[];
  };
};

function decodeSent(sent: SentTx): AddTxParams {
  const { functionName, args } = decodeFunctionData({
    abi: ADD_TRANSACTION_WITH_FEES,
    data: sent.data,
  });
  expect(functionName).toBe("addTransaction");
  return (args as readonly [AddTxParams])[0];
}

const sentTx = (calls: Array<{ method: string; params: unknown[] }>) =>
  calls.find((c) => c.method === "eth_sendTransaction")?.params[0] as SentTx | undefined;

const BOND = 5n * 10n ** 16n;

describe("Verda writes are signed by the connected wallet provider and funded before they leave", () => {
  it("writeAndConfirm sizes the write, then signs a funded addTransaction through the provider", async () => {
    const { client, calls } = providerClient();
    const seen: TxProgress[] = [];
    await writeAndConfirm({
      client,
      address: CONTRACT,
      functionName: "challenge",
      args: ["agr-000001", "the record is contradicted for the stated reasons", "[]"],
      valueAtto: BOND,
      predicate: async () => true,
      // No confirmation polling: this test is about what left the wallet.
      predicateTries: 0,
      txStatus: async () => ({ statusName: "FINALIZED", finalized: true, executed: "SUCCESS" }),
      onProgress: (p) => seen.push({ ...p }),
    });

    // SIGNED by the provider, as the connected account, to the consensus contract.
    const sent = sentTx(calls);
    expect(sent, "eth_sendTransaction must be signed by the wallet provider").toBeDefined();
    expect(sent!.from.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(sent!.to.toLowerCase()).toBe(CONSENSUS.toLowerCase());

    // FUNDED: the calldata carries the estimate's distribution, not the
    // all-zero default, and the value is the bond plus the deposit.
    const params = decodeSent(sent!);
    expect(params.recipient.toLowerCase()).toBe(CONTRACT.toLowerCase());
    expect(params.userValue).toBe(BOND);
    expect(params.feesDistribution.leaderTimeunitsAllocation).toBe(100n);
    expect(params.feesDistribution.validatorTimeunitsAllocation).toBe(200n);
    expect(params.feesDistribution.executionBudgetPerRound).toBe(76548000000000n);
    expect([...params.feesDistribution.rotations]).toEqual([3n]);
    expect(BigInt(sent!.value)).toBe(BOND + DEPOSIT);

    // The fee RPCs went over fetch to the chain's RPC URL — not to the wallet,
    // and not to the read proxy, whose allowlist would refuse them.
    const feeCalls = rpcCalls.filter((c) => c.method.startsWith("sim_"));
    expect(feeCalls.map((c) => c.method)).toEqual(
      expect.arrayContaining(["sim_getFeeConfig", "sim_estimateTransactionFees"]),
    );
    for (const c of feeCalls) expect(c.url).toBe(GENLAYER_RPC_URL);
    expect(STUDIO_NEXT.rpcUrls.default.http[0]).toBe(GENLAYER_RPC_URL);
    expect(calls.some((c) => c.method.startsWith("sim_"))).toBe(false);
    expect(rpcCalls.some((c) => c.method === "eth_sendTransaction")).toBe(false);

    // The user saw the deposit before signing, and the stages ran in order.
    const stages = seen.map((s) => s.stage);
    expect(stages.indexOf("estimating")).toBe(0);
    expect(stages.indexOf("wallet")).toBe(1);
    expect(seen[1].detail).toMatch(/fee deposit 0\.100 GEN/);
  });

  it("the SDK alone does not fund a write — which is why writeAndConfirm estimates first", async () => {
    // Pins the assumption the whole write path rests on: called without
    // `fees`, 2.0.0-rc.1 issues no fee RPC and encodes the all-zero
    // distribution with a zero deposit — the exact transaction Studio Next
    // reverts. If a future SDK starts funding on its own, this is where it shows.
    const { client, calls } = providerClient();
    const txHash = await client.writeContract({
      address: CONTRACT,
      functionName: "draft_agreement",
      args: ["IMPACT AGREEMENT " + "x".repeat(100), "hectares restored", 500, 1_800_000_000,
        8000, "50000000000000000", "[]", 1],
      value: 0n,
    });
    expect(txHash).toBe(TX_HASH);
    const params = decodeSent(sentTx(calls)!);
    expect(params.feesDistribution.leaderTimeunitsAllocation).toBe(0n);
    expect(params.feesDistribution.executionBudgetPerRound).toBe(0n);
    expect(BigInt(sentTx(calls)!.value)).toBe(0n);
    expect(rpcCalls.some((c) => c.method.startsWith("sim_"))).toBe(false);
  });

  it("a write the contract refuses dies in the fee simulation with the contract's own sentence, and nothing is sent", async () => {
    installRpc({ sim_estimateTransactionFees: { error: REFUSAL } });
    const { client, calls } = providerClient();
    const seen: TxProgress[] = [];
    await expect(
      writeAndConfirm({
        client,
        address: CONTRACT,
        functionName: "fund",
        args: ["agr-does-not-exist"],
        valueAtto: BOND,
        predicate: async () => true,
        onProgress: (p) => seen.push({ ...p }),
      }),
    ).rejects.toThrow(/\[EXPECTED\] unknown agreement/);

    const last = seen.at(-1)!;
    expect(last.stage).toBe("failed");
    expect(last.at).toBe("estimating");
    expect(last.detail).toMatch(/nothing was sent/);
    expect(last.detail).toContain("[EXPECTED] unknown agreement");
    // viem's own wording for the wrapped error must not reach the user
    expect(last.detail).not.toMatch(/double check/i);

    expect(calls.some((c) => c.method === "eth_sendTransaction")).toBe(false);
    expect(rpcCalls.some((c) => c.method === "eth_sendTransaction")).toBe(false);
    expect(rpcCalls.some((c) => c.method === "eth_getTransactionCount")).toBe(false);
  });

  it("floors a deposit the Studio estimates below 0.001 GEN", async () => {
    installRpc({
      sim_estimateTransactionFees: {
        result: { recommendedPreset: { ...FEE_ESTIMATE.recommendedPreset, feeValue: "0" } },
      },
    });
    const { client, calls } = providerClient();
    await writeAndConfirm({
      client,
      address: CONTRACT,
      functionName: "promote",
      args: ["agr-000001"],
      predicate: async () => true,
      predicateTries: 0,
    });
    expect(BigInt(sentTx(calls)!.value)).toBe(FEE_FLOOR_ATTO);
  });
});
