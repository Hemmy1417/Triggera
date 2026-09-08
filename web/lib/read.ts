"use client";

import { createClient } from "genlayer-js";
import type { CalldataEncodable } from "genlayer-js/types";
import { CONTRACT_ADDRESS, CONTRACT_CONFIGURED } from "./config";
import { PROXY_CHAIN } from "./chain";

/**
 * Reads go through the same-origin `/api/rpc` proxy, which forwards only read
 * calls for the configured contract. Every view returns "" or a JSON string;
 * an unreachable node throws, and callers render that as its own state — a
 * failed read must never fall through to the value the contract returns for
 * "nothing here".
 */
/**
 * A read that failed, and whether it is worth trying again. lib/tx.ts's
 * confirmation poll asks `transient`: without this class it can only match
 * prose, and a rate-limited read then reads as a failed transaction.
 */
export class ReadError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.name = "ReadError";
    this.transient = transient;
  }
}

/** Studio Next answers a rate limit with -32029 and a [transient] sentence. */
function asReadError(err: unknown): ReadError {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown } } | undefined;
  const text = String(e?.message ?? err ?? "read failed");
  const code = e?.code ?? e?.cause?.code;
  const status = (err as { status?: unknown } | undefined)?.status;
  const transient =
    code === -32029 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /50[234]|bad gateway|gateway timeout|service unavailable/i.test(text) ||
    /\[transient\]|rate limit|too many requests|fetch failed|timeout|network/i.test(text);
  return new ReadError(text, transient);
}

const client = createClient({ chain: PROXY_CHAIN });

type Cached = { at: number; value: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 4000;

export function invalidateReads(): void {
  cache.clear();
}

async function view(fn: string, args: CalldataEncodable[], key: string, force = false, ttl = TTL_MS) {
  if (!CONTRACT_CONFIGURED) throw new Error("no contract configured");
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.value;
  /* Studio Next answers a share of reads with a 502 or a dropped socket. A
     single one of those used to blank the whole view until the reader
     reloaded, which reported the protocol as unreachable when it was merely
     busy. Transient failures are retried with a short backoff; a refusal
     that is not transient still surfaces at once. */
  let raw: unknown;
  let lastErr: ReadError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      raw = await client.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: fn,
        args,
      });
      lastErr = null;
      break;
    } catch (err) {
      const e = asReadError(err);
      if (!e.transient || attempt === 2) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  if (lastErr) throw lastErr;
  /* The contract says "nothing here" with an empty string. Turning that
     into null once, here, is the only place it can be done reliably: a
     caller that trusted the declared type would otherwise render the
     fields of a string. `??` does not catch "", so this is not optional. */
  const value =
    typeof raw === "string" ? (raw === "" ? null : JSON.parse(raw)) : raw;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export type Stats = {
  policies: number;
  active: number;
  investigations: number;
  satisfied: number;
  paid_atto: string;
  premiums_atto: string;
  escrow_atto: string;
};

export async function getStats(force = false): Promise<Stats> {
  return (await view("get_stats", [], "stats", force)) as Stats;
}

export async function getPolicies(
  offset: number,
  limit: number,
  force = false,
): Promise<{ total: number; policies: Policy[] }> {
  return (await view(
    "get_policies",
    [offset, limit],
    `policies:${offset}:${limit}`,
    force,
  )) as { total: number; policies: Policy[] };
}

/**
 * Every policy this wallet is a party to, NEWEST FIRST.
 *
 * The contract's actor index appends, so `get_policies_for` answers oldest
 * first and the reversal happens here rather than at each call site — the
 * composer reads its own newest policy back to learn the id the contract
 * assigned it, and a list that quietly changed order would hand it the wrong
 * one.
 */
export async function getPoliciesFor(addr: string, force = false): Promise<Policy[]> {
  const v = await view(
    "get_policies_for",
    [addr],
    `policies-for:${addr.toLowerCase()}`,
    force,
  );
  const list = Array.isArray(v) ? (v as Policy[]) : [];
  return [...list].reverse();
}

export async function getPolicy(id: string, force = false): Promise<Policy | null> {
  const v = await view("get_policy", [id], `policy:${id}`, force);
  return (v as Policy | null) ?? null;
}

/** A decided version never changes, so it is cached indefinitely once seen. */
export async function getDecision(
  id: string,
  version: number,
  force = false,
): Promise<Decision | null> {
  const key = `decision:${id}:${version}`;
  const hit = cache.get(key);
  /* Only a decision that exists is held indefinitely, and `investigate`
     refuses to decide a version twice, so a held one can never go stale. An
     absent version caches as null, which is falsy, and is re-read on the
     60 s TTL below until a panel has actually run. */
  if (!force && hit && hit.value) return hit.value as Decision;
  return (await view("get_decision", [id, version], key, force, 60_000)) as Decision | null;
}

export async function getPackage(
  id: string,
  version: number,
  force = false,
): Promise<ClaimPackage | null> {
  return (await view(
    "get_package",
    [id, version],
    `package:${id}:${version}`,
    force,
    60_000,
  )) as ClaimPackage | null;
}

/** A ledger balance is never cached: it is the number a claim button acts on. */
export async function getClaimable(addr: string): Promise<string> {
  if (!CONTRACT_CONFIGURED) throw new Error("no contract configured");
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    functionName: "get_claimable",
    args: [addr],
  });
  return String(raw ?? "0");
}

/**
 * The bounds and vocabularies the writes enforce, reported by the contract
 * itself. A composer that guesses a limit eventually guesses wrong and the
 * user pays for it in a reverted transaction, so the source of truth for the
 * lists a form offers is this view — not a constant the frontend maintains.
 * Cached for five minutes: it changes only when the contract is redeployed.
 */
export type Config = {
  version: string;
  min_coverage_atto: string;
  max_coverage_atto: string;
  min_premium_atto: string;
  threshold: [number, number];
  measurement_hours: [number, number];
  duration_hours: [number, number];
  radius_km: [number, number];
  min_independent: [number, number];
  terms_chars: [number, number];
  title_chars: [number, number];
  notional_chars: [number, number];
  place_chars: [number, number];
  metric_chars: [number, number];
  unit_chars: [number, number];
  basis_entries: [number, number];
  window_seconds: [number, number];
  claim_grace_seconds: [number, number];
  coverage_period_seconds: [number, number];
  default_windows: { claim_grace: number; finality: number; appeal: number };
  appeal_bond_bps: number;
  appeal_bond_floor_atto: string;
  event_types: string[];
  operators: string[];
  source_kinds: string[];
  source_classes: string[];
  outcomes: string[];
  hold_reasons: string[];
  evidence_flags: string[];
  statuses: string[];
};

export async function getConfig(force = false): Promise<Config> {
  return (await view("get_config", [], "config", force, 300_000)) as Config;
}

export type BasisEntry = { kind: string; origin: string; class: "INDEPENDENT" | "PARTY" };

export type Policy = {
  policy_id: string;
  insurer: string;
  policyholder: string;
  status: string;
  title: string;
  notional: string;
  event_type: string;
  metric: string;
  unit: string;
  operator: string;
  threshold: number;
  measurement_hours: number;
  duration_hours: number;
  country: string;
  region: string;
  lat_e6: number;
  lon_e6: number;
  radius_km: number;
  coverage_atto: string;
  premium_atto: string;
  appeal_bond_atto: string;
  min_independent: number;
  terms_sha256: string;
  coverage_start_epoch: number;
  coverage_end_epoch: number;
  claim_grace: number;
  finality_window: number;
  appeal_window: number;
  created_epoch: number;
  activated_epoch: number;
  evidence_version: number;
  evidence_root: string;
  last_claim_epoch: number;
  event_start_epoch: number;
  event_end_epoch: number;
  claimed_reading: number;
  judged_version: number;
  pending_version: number;
  pending_until_epoch: number;
  outcome: string;
  hold_reason: string;
  evidence_flag: string;
  score: number;
  publishers: number;
  qualifying: number;
  contradicting: number;
  final_epoch: number;
  appeal_until_epoch: number;
  appeal_open: boolean;
  appellant: string;
  appeal_grounds: string;
  appeal_new_version: number;
  appealed_version: number;
  appeal_filed_epoch: number;
  settled_epoch: number;
  payout_atto: string;
  refund_atto: string;
  expired_epoch: number;
  cancelled_epoch: number;
  terms_text?: string;
  basis?: BasisEntry[];
};

export type DecisionRow = {
  id: string;
  url: string;
  host: string;
  domain: string;
  origin: string;
  kind: string;
  cls: "INDEPENDENT" | "PARTY";
  label: string;
  added_version: number;
  basis: "FETCHED" | "RECORDED" | "NEW";
  basis_round: number;
  fetch_epoch: number;
  readable: boolean;
  excerpt: string;
  digest: string;
  reading: number | null;
  window_ok: boolean;
  geo_ok: boolean;
  kind_matches: boolean;
};

export type Decision = {
  decision_id: string;
  policy_id: string;
  evidence_version: number;
  evidence_root: string;
  round_kind: "INVESTIGATION" | "RE_INVESTIGATION";
  reconsidered_round: number;
  observed_epoch: number;
  question: string;
  event_start_epoch: number;
  event_end_epoch: number;
  operator: string;
  threshold: number;
  unit: string;
  min_independent: number;
  claimed_reading: number;
  outcome: string;
  hold_reason: string;
  publishers: number;
  qualifying: number;
  contradicting: number;
  score: number;
  evidence_flag: string;
  conflicts: string[];
  reason: string;
  rows: DecisionRow[];
};

export type ClaimPackage = {
  policy_id: string;
  version: number;
  event_start_epoch: number;
  event_end_epoch: number;
  claimed_reading: number;
  filed_by: string;
  rows: Array<{
    id: string;
    url: string;
    norm_url: string;
    host: string;
    domain: string;
    origin: string;
    kind: string;
    cls: "INDEPENDENT" | "PARTY";
    label: string;
    added_version: number;
  }>;
  root: string;
};

// ── transaction finality ─────────────────────────────────────────────

export type TxFinalityView = {
  /** The chain's own word for where the transaction is: "ACCEPTED",
   *  "FINALIZED", … — "UNKNOWN" when the answer named no status. */
  statusName: string;
  /** True once the chain reports FINALIZED: it will not walk this back. */
  finalized: boolean;
  /** What the deciding execution did. Measured against live StudioNet, and
   *  unchanged in the SDK's Studio path under 2.0.0-rc.1: the
   *  consensus-level result is MAJORITY_AGREE for a refused write too (the
   *  panel agreed it errored), so success is read from the leader receipt,
   *  never from the consensus result. */
  executed: "SUCCESS" | "ERROR" | "UNKNOWN";
};

/**
 * Numeric status → name, pinned from the SDK's enum declaration order and
 * verified against live StudioNet (a FINALIZED transaction reports 7).
 */
const STATUS_BY_NUMBER: Record<number, string> = {
  0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING",
  4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED",
  8: "CANCELED", 9: "APPEAL_REVEALING", 10: "APPEAL_COMMITTING",
  11: "READY_TO_FINALIZE", 12: "VALIDATORS_TIMEOUT", 13: "LEADER_TIMEOUT",
};

/**
 * Normalize whatever the RPC returned for a transaction into the three facts
 * lib/tx.ts acts on. Exported for tests: this function decides whether a
 * user is told their write is irreversible, so it is exercised against
 * fixtures of every shape the chain has actually produced.
 *
 * Two shapes were measured live rather than assumed:
 *
 *   a write that TOOK EFFECT    → statusName FINALIZED, result_name
 *     MAJORITY_AGREE, leader_receipt [SUCCESS, ERROR] — the trailing ERROR
 *     is a rotated round, and the DECIDING receipt is entry 0
 *   a write the contract REFUSED → statusName FINALIZED, result_name
 *     MAJORITY_AGREE again — agreement that it errored — with
 *     leader_receipt [ERROR, ERROR]
 *
 * So entry 0 of the leader receipt decides, and the consensus result is
 * never consulted. The SDK's enum spells success FINISHED_WITH_RETURN while
 * the wire says SUCCESS; both are accepted.
 */
export function normalizeTxView(t: unknown): TxFinalityView {
  const tx = (typeof t === "object" && t !== null ? t : {}) as Record<string, unknown>;

  let statusName = "UNKNOWN";
  if (typeof tx.statusName === "string" && tx.statusName) {
    statusName = tx.statusName;
  } else if (typeof tx.status === "number" && STATUS_BY_NUMBER[tx.status]) {
    statusName = STATUS_BY_NUMBER[tx.status];
  } else if (typeof tx.status === "string" && tx.status) {
    statusName = tx.status;
  }

  let executed: TxFinalityView["executed"] = "UNKNOWN";
  const consensus = tx.consensus_data as
    | { leader_receipt?: Array<{ execution_result?: unknown }> }
    | undefined;
  const deciding = consensus?.leader_receipt?.[0]?.execution_result;
  if (deciding === "SUCCESS" || deciding === "FINISHED_WITH_RETURN") {
    executed = "SUCCESS";
  } else if (deciding === "ERROR" || deciding === "FINISHED_WITH_ERROR") {
    executed = "ERROR";
  }

  return { statusName, finalized: statusName === "FINALIZED", executed };
}

const NOT_SEEN: TxFinalityView = { statusName: "UNKNOWN", finalized: false, executed: "UNKNOWN" };

/**
 * Is this the chain saying it has never seen the hash?
 *
 * genlayer-js 1.1.8 answered an unknown hash with null. Under 2.0.0-rc.1 the
 * Studio path hands the lookup to viem, and Studio Next was measured to
 * answer it with a JSON-RPC error, which viem raises as
 * ResourceNotFoundRpcError; a null result would raise TransactionNotFoundError
 * instead. Both are matched, by name and by the sentence, because this
 * classification is what keeps a poll going.
 */
function isNotSeen(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | undefined;
  if (e?.name === "ResourceNotFoundRpcError" || e?.name === "TransactionNotFoundError") return true;
  return /could not be found|resource not found/i.test(String(e?.message ?? ""));
}

/**
 * One status poll of a submitted transaction, through the same proxy and
 * pacing as every other read. Never cached: the point is to see change.
 *
 * The SDK's Studio path issues exactly one RPC for this, eth_getTransactionByHash,
 * which is the second of the two methods the proxy forwards; the shape it
 * returns was measured on Studio Next and is the one normalizeTxView pins.
 */
export async function getTransactionStatus(hash: string): Promise<TxFinalityView> {
  let raw: unknown;
  try {
    raw = await client.getTransaction({ hash: hash as never });
  } catch (err) {
    // An unknown hash is an answer, not an error: the transaction has not
    // been seen yet. Callers keep polling rather than failing.
    if (isNotSeen(err)) return NOT_SEEN;
    throw asReadError(err);
  }
  if (raw === null || raw === undefined) return NOT_SEEN;
  return normalizeTxView(raw);
}
