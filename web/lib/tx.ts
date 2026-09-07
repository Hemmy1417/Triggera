"use client";

/**
 * The transaction lifecycle.
 *
 * Four rules, all learned the hard way — two on sibling builds, one from a
 * judge reading this file, one from the platform itself:
 *
 *   CONFIRMATION IS A CONTRACT READ, NOT A RECEIPT. A submitted transaction
 *   is not a changed state. Every write here closes by polling a VIEW
 *   PREDICATE — "is the thing I asked for now true on-chain?" — because a
 *   receipt can arrive before finalization and a hash proves only that we
 *   asked.
 *
 *   THE PREDICATE MUST MATCH WHAT THE CONTRACT ACTUALLY EXPOSES. A sibling
 *   polled for a field its own deferral design deliberately withholds until
 *   finality, so a resolution that had genuinely succeeded was reported to
 *   the user as unconfirmed. Predicates live beside the reads they check
 *   rather than being written inline at each call site.
 *
 *   A CONTRACT READ IS NOT FINALITY EITHER. The predicate turning true
 *   proves the write reached ACCEPTED — a state the Studio can still walk
 *   back. Earlier versions said "Confirmed on-chain" at that moment, which
 *   overstated it for an app that moves money. So acceptance and finality
 *   are now two separate stages: the flow unblocks at ACCEPTED (the state is
 *   live and every follow-up read will see it), and it says FINALIZED only
 *   after the transaction itself reports FINALIZED with its deciding
 *   execution a success. Measured on StudioNet, whose stack Studio Next
 *   runs, that last step follows acceptance by about thirty seconds.
 *
 *   A WRITE IS SIZED BEFORE IT IS SIGNED. Studio Next's consensus contract
 *   reverts every transaction that carries no fee distribution or a zero fee
 *   deposit, and genlayer-js 2.0.0-rc.1 does NOT fill those in on its own: a
 *   writeContract without `fees` encodes the all-zero distribution and sends
 *   it, deposit 0, straight into the revert. So every write here begins by
 *   asking the SDK to SIMULATE the call (estimateTransactionFeesForWrite),
 *   which yields the distribution, the deposit, and — for a write that emits
 *   a transfer, like claim() — the message allocations without which the
 *   Studio refuses it as `fee no_matching_allocation`. That simulation also
 *   runs the method, so a write the contract would refuse fails right there,
 *   with the contract's own sentence, before the wallet ever opens.
 */
import { isTransient, walletErrorMessage } from "./chain";
import { formatGen } from "./config";
import { getTransactionStatus, type TxFinalityView } from "./read";
import type { TransactionFeeEstimate } from "genlayer-js/types";

/**
 * Is this read failure worth retrying?
 *
 * The read layer already knows: ReadError carries a `transient` boolean set
 * where the failure was classified. Re-deriving it from the message here was a
 * real bug, and a bad one. lib/read.ts REWRITES a rate limit into "Studio Next
 * is limiting how fast this page can read", which contains none of the words
 * isTransient looks for, so a rate-limited confirmation read was classified as
 * a hard failure and a transaction that had landed was reported to the user as
 * failed. The Studio allows thirty reads a minute and this polls up to sixty
 * times, so it was not a rare path.
 *
 * The structured flag wins wherever it exists; the prose match stays as a
 * fallback for errors thrown by layers that do not carry one.
 */
function retryable(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "transient" in err) {
    const t = (err as { transient: unknown }).transient;
    if (typeof t === "boolean") return t;
  }
  return isTransient(err);
}

export type TxStage =
  | "idle"
  | "estimating"  // simulating the write to size its fee deposit
  | "wallet"      // waiting for the signature
  | "submitted"   // signed and sent
  | "pending"     // on-chain, awaiting the state change
  | "accepted"    // a contract read proves the state is live; not yet final
  | "confirmed"   // the transaction reports FINALIZED and executed
  | "unresolved"  // submitted, and we stopped waiting without an answer
  | "rejected"    // the user declined
  | "failed";

/**
 * Is this write still in flight?
 *
 * The one every caller needs, and the one that was getting written by hand at
 * each site. "unresolved" is deliberately NOT in flight: the poll gave up, so
 * the control must become usable again. Leaving it counted as working left the
 * button that fired the write disabled for the life of the component, which is
 * the worst outcome available, because the user cannot retry and cannot tell
 * whether their money moved.
 */
export function inFlight(stage: TxStage): boolean {
  return (
    stage === "estimating" || stage === "wallet" || stage === "submitted" || stage === "pending"
  );
}

/**
 * Has the chain's state caught up with what the user asked for?
 *
 * True from ACCEPTED onward. This is the gate for follow-up ACTIONS — moving
 * to the next page, refreshing a list, offering the next step — because
 * every read from here on sees the new state. It is deliberately NOT the
 * gate for the word "finalized": that claim belongs to the confirmed stage
 * alone, which requires the transaction itself to report FINALIZED. Call
 * sites that used to key "done" off confirmed key it off this, so a user is
 * neither blocked for the finality wait nor told a reversible write is
 * irreversible.
 */
export function stateVisible(stage: TxStage): boolean {
  return stage === "accepted" || stage === "confirmed";
}

export type TxProgress = {
  stage: TxStage;
  detail: string;
  hash?: string;
  /**
   * For a terminal report, the track stage it belongs to. A refusal in the
   * fee simulation never reached the wallet, and a finalized refusal got as
   * far as pending; without this the stepper painted every failure on the
   * wallet step. Absent means the wallet, which is where a declined
   * signature and a send that never left both happen.
   */
  at?: TxStage;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── fees ────────────────────────────────────────────────────────────────────

/**
 * The smallest deposit a write is sent with: 0.001 GEN in atto.
 *
 * The Studio's own estimate has been observed to land at zero for a cheap
 * write, and a zero deposit is a guaranteed revert (FeeValueMustBeNonZero).
 * Observed deposits run around 0.1 GEN and are largely refunded — a write
 * nets about 0.0001 GEN — so the floor is a safety net, not a price.
 */
export const FEE_FLOOR_ATTO = 10n ** 15n;

export function floorFee(estimate: bigint): bigint {
  return estimate < FEE_FLOOR_ATTO ? FEE_FLOOR_ATTO : estimate;
}

/**
 * What the estimate yields and what writeContract's `fees` option takes: the
 * same three fields, handed over unchanged except for the floored deposit.
 * `messageAllocations` is undefined for a write that emits nothing and MUST
 * be passed through for one that does — the transfer inside claim() has no
 * allocation without it, and the Studio refuses the write.
 */
export type TxFees = {
  distribution: TransactionFeeEstimate["distribution"];
  feeValue: bigint;
  messageAllocations?: TransactionFeeEstimate["messageAllocations"];
};

async function estimateFees(
  client: Client,
  address: string,
  functionName: string,
  args: unknown[],
  valueAtto: bigint,
): Promise<TxFees> {
  const est: TransactionFeeEstimate = await client.estimateTransactionFeesForWrite({
    address: address as `0x${string}`,
    functionName,
    args,
    value: valueAtto,
  });
  return {
    distribution: est.distribution,
    feeValue: floorFee(BigInt(est.feeValue)),
    messageAllocations: est.messageAllocations,
  };
}

/** Every human-readable string an error and its cause chain carry, joined —
 *  viem keeps the useful sentence in `details` or three levels down. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let node: unknown = err;
  for (let depth = 0; depth < 6 && typeof node === "object" && node !== null; depth++) {
    const e = node as Record<string, unknown>;
    for (const key of ["message", "shortMessage", "details"]) {
      if (typeof e[key] === "string" && e[key]) parts.push(e[key] as string);
    }
    node = e.cause;
  }
  if (parts.length === 0) parts.push(String(err ?? ""));
  return parts.join(" ");
}

/**
 * The contract's error taxonomy (contracts/verda.py): every sentence it
 * raises opens with one of these. [EXPECTED] is a business refusal and
 * [EXTERNAL] a source that answered 4xx — both deterministic, both the
 * write's last word. [TRANSIENT] is network or clock noise and [LLM_ERROR] a
 * model that misbehaved: the same write can go through on the next attempt,
 * and the copy has to say so rather than call it refused.
 */
const TAGS = ["[EXPECTED]", "[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"] as const;

/** Was this sentence a passing failure rather than a refusal? */
export function passingFailure(sentence: string): boolean {
  return sentence.startsWith("[TRANSIENT]") || sentence.startsWith("[LLM_ERROR]");
}

/** One line of text from the earliest taxonomy marker on, or null. */
function fromMarker(text: string): string | null {
  let at = -1;
  for (const tag of TAGS) {
    const i = text.indexOf(tag);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return null;
  return text.slice(at).split(/\r?\n/)[0].trim();
}

/**
 * The contract's own words for stopping a write, or null when the failure
 * was not the contract's.
 *
 * Measured against Studio Next: sim_estimateTransactionFees RUNS the method,
 * and a write the contract stops comes back as JSON-RPC error -32000
 * "execution failed" whose data.receipt.result is the GenVM result as base64
 * — one tag byte, then the sentence the contract raised, e.g. "[EXPECTED]
 * unknown agreement". viem wraps that as InvalidInputRpcError, whose own
 * message tells the user to "double check your parameters", and keeps the
 * raw error on `cause`. So the useful sentence is three levels down and
 * base64-encoded, and this walks the cause chain to find it. The markers are
 * also honoured in plain text, which is how a refusal reads when it arrives
 * through gen_call or a receipt.
 *
 * Returned verbatim from the marker on: that sentence was written for the
 * user. An execution error with no marker is still the contract stopping the
 * write, and is reported as one with whatever text it carried.
 */
export function contractRefusal(err: unknown): string | null {
  let node: unknown = err;
  for (let depth = 0; depth < 6 && typeof node === "object" && node !== null; depth++) {
    const e = node as Record<string, unknown>;
    const data = e.data as { receipt?: Record<string, unknown> } | undefined;
    const receipt = data?.receipt;
    if (receipt && receipt.execution_result === "ERROR") {
      const text = decodeGenVmResult(receipt.result);
      return fromMarker(text) ?? (text ? `The contract refused this write: ${text}` : "The contract refused this write.");
    }
    node = e.cause;
  }
  return fromMarker(errorText(err));
}

/** base64 GenVM result → its text, minus the leading tag byte(s). */
function decodeGenVmResult(b64: unknown): string {
  if (typeof b64 !== "string" || !b64) return "";
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    let i = 0;
    while (i < text.length && text.charCodeAt(i) < 0x20) i++;
    return text.slice(i).trim();
  } catch {
    return "";
  }
}

// ── the write ───────────────────────────────────────────────────────────────

export type WriteArgs = {
  client: Client;
  address: string;
  functionName: string;
  args: unknown[];
  /** GEN in atto. Funding and bonds are payable; everything else is 0n. */
  valueAtto?: bigint;
  /** "Has the chain caught up?" — resolves true when the state is visible. */
  predicate: () => Promise<boolean>;
  onProgress?: (p: TxProgress) => void;
  /** How many times to poll the predicate before giving up (6s apart). */
  predicateTries?: number;
  /** How many times to poll for finality after acceptance (6s apart).
   *  The Studio finalizes about thirty seconds after accepting, so the
   *  default of twenty is generous without being endless. */
  finalityTries?: number;
  /**
   * What to say once finality is proven.
   *
   * The default speaks about the transaction, which is right when only the
   * caller could have produced the state. It is WRONG for the permissionless
   * calls: a keeper step can be satisfied by a stranger's transaction
   * landing first, and telling that user "your transaction succeeded" would
   * be a claim about their transaction that nobody checked. Those call sites
   * pass a sentence about the STATE instead.
   */
  confirmedDetail?: string;
  /**
   * One status poll of a transaction, injectable for the same reason the
   * predicate is: this path decides whether a user is told their write is
   * irreversible. Production passes nothing and gets the real reader.
   */
  txStatus?: (hash: string) => Promise<TxFinalityView>;
};

/**
 * Size a write, submit it, confirm it by reading the chain back, then prove
 * finality.
 *
 * Resolves with the transaction hash once the STATE IS VISIBLE (the accepted
 * stage) — everything a caller does next is a read, and reads see the new
 * state from that moment. The finality watch keeps reporting through
 * `onProgress` after resolution: confirmed when the transaction reports
 * FINALIZED with a successful execution, or a terminal accepted-but-not-yet-
 * final message if the watch runs out. Throws on refusal, rejection or
 * failure — the caller renders `onProgress`, which always ends in a terminal
 * stage, so the user is never left wondering. Nothing is ever sent without a
 * fee estimate: an estimate that fails, for any reason, ends the write.
 */
export async function writeAndConfirm({
  client,
  address,
  functionName,
  args,
  valueAtto = 0n,
  predicate,
  onProgress,
  predicateTries = 30,
  finalityTries = 20,
  confirmedDetail = "Finalized on-chain.",
  txStatus = getTransactionStatus,
}: WriteArgs): Promise<string> {
  const report = (p: TxProgress) => onProgress?.(p);

  if (!client) {
    const detail = "No wallet is connected.";
    report({ stage: "failed", detail, at: "estimating" });
    throw new Error(detail);
  }

  report({ stage: "estimating", detail: "Simulating the write to size its fee deposit…" });

  let fees: TxFees;
  try {
    fees = await estimateFees(client, address, functionName, args, valueAtto);
  } catch (err) {
    // Four honest endings, none of which sends anything. A refusal carries
    // the contract's sentence verbatim; a passing failure inside the
    // simulation carries it too, but is named as something to retry, because
    // it is; a transport failure is named as one for the same reason; and
    // anything else names the error.
    const refusal = contractRefusal(err);
    const detail = refusal
      ? passingFailure(refusal)
        ? `The pre-flight simulation hit a passing failure, so nothing was sent: ${refusal} ` +
          "Retrying usually works."
        : `The contract refused this write, so nothing was sent: ${refusal}`
      : isTransient(errorText(err))
        ? "Studio Next could not be reached to size the fee deposit, so nothing was sent. " +
          "Retrying usually works."
        : `The fee estimate failed, so nothing was sent: ${errorText(err).slice(0, 160)}`;
    report({ stage: "failed", detail, at: "estimating" });
    throw new Error(detail, { cause: err });
  }

  report({
    stage: "wallet",
    detail: `Confirm in your wallet; fee deposit ${formatGen(fees.feeValue)} GEN, mostly refunded.`,
  });

  let hash = "";
  try {
    const res = await client.writeContract({
      address: address as `0x${string}`,
      functionName,
      args,
      value: valueAtto,
      fees,
    });
    hash = typeof res === "string" ? res : (res?.transactionHash ?? res?.hash ?? "");
  } catch (err) {
    const e = err as { code?: number };
    const detail = walletErrorMessage(err);
    report({ stage: e?.code === 4001 ? "rejected" : "failed", detail, at: "wallet" });
    throw err;
  }

  report({ stage: "submitted", detail: "Sent to Studio Next.", hash });

  // Confirmation: poll the view predicate. Transient read noise is retried
  // rather than surfaced — a rate-limited read says nothing about the write.
  report({ stage: "pending", detail: "Waiting for the contract to reflect it…", hash });
  let landed = false;
  for (let i = 0; i < predicateTries && !landed; i++) {
    await sleep(6000);
    try {
      landed = await predicate();
    } catch (err) {
      if (!retryable(err)) {
        report({
          stage: "failed",
          detail: "The chain could not be read back to confirm this.",
          hash,
          at: "pending",
        });
        throw err;
      }
    }

    // Every third miss, look at the TRANSACTION as well as the state. A write
    // the contract refused will never satisfy the predicate, and before this
    // check the user stood at "pending" for the full three minutes and was
    // then told, wrongly, that the write might still land. A refusal that has
    // FINALIZED is the chain's last word and is reported as one.
    if (!landed && i % 3 === 2) {
      let refused = false;
      try {
        const v = await txStatus(hash);
        refused = (v.finalized && v.executed === "ERROR") || v.statusName === "CANCELED";
      } catch {
        // A failed status read says nothing about the write; the predicate
        // polling continues either way.
      }
      if (refused) {
        const detail =
          "Studio Next finalized this write as refused: the contract did not " +
          "accept it, and nothing moved.";
        report({ stage: "failed", detail, hash, at: "pending" });
        throw new Error(detail);
      }
    }
  }

  if (!landed) {
    // Submitted but not yet visible. This is NOT a failure: Studio
    // finalization can lag, and the copy must not imply the money is lost. Nor
    // may it promise something that does not happen. An earlier version said
    // "this page keeps reading and will update when it lands", and nothing
    // polls after this returns, so the user was told to wait for an update that
    // would never arrive on its own.
    report({
      stage: "unresolved",
      detail:
        "Submitted, and Studio Next has not reflected it yet. It is not lost, and it may " +
        "still land. Nothing here is polling any more, so refresh in a moment to see " +
        "where it got to.",
      hash,
    });
    return hash;
  }

  // The state is live: every read from here on sees it, so the caller is
  // unblocked NOW. What is not yet true is irreversibility — ACCEPTED is a
  // state the Studio can walk back — so the word for this stage is accepted,
  // and the finality watch below keeps reporting after this resolves.
  report({
    stage: "accepted",
    detail:
      "The contract reflects it. Studio Next has accepted the write, and " +
      "finality usually follows within a minute.",
    hash,
  });

  void watchFinality(hash, report, confirmedDetail, finalityTries, txStatus);
  return hash;
}

/**
 * The finality watch: poll the transaction until Studio Next reports
 * FINALIZED, and only then say so. Runs after writeAndConfirm has resolved,
 * reporting through the same onProgress the caller is already rendering.
 * Never throws — by the time it runs the caller has been handed the hash and
 * the state is live, so the only honest failure mode is the bounded "not yet
 * final" message at the end.
 */
async function watchFinality(
  hash: string,
  report: (p: TxProgress) => void,
  confirmedDetail: string,
  finalityTries: number,
  txStatus: (hash: string) => Promise<TxFinalityView>,
): Promise<void> {
  for (let i = 0; i < finalityTries; i++) {
    await sleep(6000);
    let v: TxFinalityView | null = null;
    try {
      v = await txStatus(hash);
    } catch {
      // Transient or not, a failed status read is answered by the next poll.
    }
    if (!v) continue;

    if (v.finalized && v.executed === "SUCCESS") {
      report({ stage: "confirmed", detail: confirmedDetail, hash });
      return;
    }

    // The state the user asked for is live — the predicate proved it — but
    // THIS transaction finalized without effect. That happens when a
    // permissionless call raced a stranger's identical transaction and lost,
    // and the honest sentence names it rather than crediting this write.
    if ((v.finalized && v.executed === "ERROR") || v.statusName === "CANCELED") {
      report({
        stage: "confirmed",
        detail:
          confirmedDetail +
          " This transaction itself finalized without effect: the state was " +
          "already produced by another transaction that got there first.",
        hash,
      });
      return;
    }
  }

  report({
    stage: "accepted",
    detail:
      "The contract reflects this write, and Studio Next has not yet reported " +
      "it finalized. That step almost always follows on its own. Nothing here " +
      "is polling any more, so refresh in a minute, and treat the write as " +
      "irreversible only once it shows finalized.",
    hash,
  });
}

/** Human-readable label per stage, for the stepper. */
export const STAGE_LABEL: Record<TxStage, string> = {
  idle: "Ready",
  estimating: "Estimating fee",
  wallet: "Confirm in wallet",
  submitted: "Submitted",
  pending: "Pending",
  accepted: "Accepted",
  confirmed: "Finalized",
  unresolved: "Not yet visible",
  rejected: "Declined",
  failed: "Failed",
};

/** The ordered stepper track — terminal error stages sit outside it. */
export const STAGE_TRACK: TxStage[] = [
  "estimating", "wallet", "submitted", "pending", "accepted", "confirmed",
];

/**
 * The class for one hexagon of the track given where the write is. `at`
 * places a terminal failure on the track stage it belongs to; without it the
 * wallet is assumed, which is right for a declined signature.
 */
export function stageClass(step: TxStage, current: TxStage, at?: TxStage): string {
  if (current === "failed" || current === "rejected") {
    const failAt = STAGE_TRACK.indexOf(at ?? "wallet");
    const me = STAGE_TRACK.indexOf(step);
    if (me < 0 || failAt < 0) return "step";
    if (me < failAt) return "step done";
    return me === failAt ? "step fail" : "step";
  }
  // Unresolved got as far as pending and stopped. Show that progress rather
  // than blanking the track, so the user can see the write was sent.
  if (current === "unresolved") {
    return step === "accepted" || step === "confirmed" ? "step" : "step done";
  }
  const cur = STAGE_TRACK.indexOf(current);
  const me = STAGE_TRACK.indexOf(step);
  if (cur < 0 || me < 0) return "step";
  if (me < cur) return "step done";
  if (me === cur) return "step on";
  return "step";
}
