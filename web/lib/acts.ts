/**
 * WHAT THIS WALLET CAN DO TO THIS POLICY, RIGHT NOW.
 *
 * Every write the contract exposes has gates — a status, a role, a window,
 * a version ceiling — and the app has exactly two honest ways to treat them.
 * It can offer a button and let the chain refuse it, which spends the user's
 * attention on a transaction that was never going to land. Or it can mirror
 * the gates here and say, in one sentence, why an act is not available yet.
 * This file is the second.
 *
 * Three rules hold it together:
 *
 *   THE CONTRACT IS THE AUTHORITY, NOT THIS FILE. Every sentence below
 *   mirrors a `raise` in contracts/triggera.py, and the contract re-runs all
 *   of them at intake with its own consensus clock. This exists so its answer
 *   is almost never "no" — never so the app can decide anything.
 *
 *   AN UNAVAILABLE ACT STILL EXPLAINS ITSELF. `blocked` is a SENTENCE, not a
 *   boolean: empty means offerable, and anything else is what the reader is
 *   owed instead of a button that fails. An act nobody in this wallet's role
 *   could ever perform is not returned at all — a stranger is not shown a
 *   list of things they are not.
 *
 *   NO MACHINE VALUES IN THE COPY. Amounts are GEN, windows are spans,
 *   moments are distances ("in three hours"). Epochs, atto figures and enum
 *   strings belong in the technical folds on the page, not in a sentence.
 *
 * Pure: no React, no network, no clock of its own. `now` is passed in, which
 * is what makes every gate here testable against every status and both roles
 * — tests/acts.test.ts does exactly that.
 */
import { sameAddress } from "./chain";
import { formatGenExact, formatRelative, formatSpan } from "./config";
import type { Policy } from "./read";

export type ActId =
  | "activate"
  | "cancel_policy"
  | "file_claim"
  | "investigate"
  | "promote"
  | "appeal"
  | "re_investigate"
  | "lapse_appeal"
  | "settle"
  | "expire"
  | "claim";

export type Act = {
  id: ActId;
  /** The button's own words — a verb phrase, never the method name. */
  label: string;
  /** One short line: what this write does to the record. */
  does: string;
  /**
   * The value that must accompany the write, in atto. Zero for everything
   * that is not payable. Where it is non-zero the contract compares it
   * integer-for-integer, so the face shows the exact figure and the write
   * sends this number — never a re-derivation of it.
   */
  cost: bigint;
  /** "" when the act is offerable; otherwise why it is not, in one sentence. */
  blocked: string;
  /** This act needs answers before it can be sent. */
  form?: "claim" | "appeal";
  /** A full panel round: live web fetches inside consensus, minutes not seconds. */
  slow?: boolean;
  /** Anyone may call it, so a stranger's transaction can satisfy it first. */
  permissionless?: boolean;
};

/**
 * The two bounds a policy view does not carry. Both are contract constants
 * (MAX_VERSIONS, STALE_APPEAL_SECONDS) and both are reported by get_config,
 * so a caller with a live config passes them rather than trusting these.
 */
export type ActLimits = { versionsMax: number; staleAppealSeconds: number };

export const CONTRACT_LIMITS: ActLimits = { versionsMax: 6, staleAppealSeconds: 3_600 };

/** The statuses in which a policy is still running its course. */
const LIVE_STATUSES = ["ACTIVE", "INVESTIGATING", "PENDING_FINALITY", "FINAL"];

function statusWords(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

function atto(v: string | number | bigint): bigint {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
}

function gen(v: string | bigint): string {
  return `${formatGenExact(v)} GEN`;
}

/**
 * Every act this wallet could take on this policy, offerable or not.
 *
 * `claimableAtto` is the wallet's ledger balance — it belongs here because
 * the withdrawal is not a property of the policy at all, and putting it in
 * the same list is what makes the path read continuously: settle credits a
 * balance, and the very next act on the card is taking it out.
 */
export function availableActs(
  p: Policy,
  address: string,
  now: number,
  claimableAtto: bigint,
  limits: ActLimits = CONTRACT_LIMITS,
): Act[] {
  const acts: Act[] = [];
  const isInsurer = sameAddress(address, p.insurer);
  const isHolder = sameAddress(address, p.policyholder);

  const coverage = gen(p.coverage_atto);
  const graceEnd = Number(p.coverage_end_epoch) + Number(p.claim_grace);
  const patienceEnd = Number(p.last_claim_epoch) + Number(p.finality_window);
  const staleAt = Number(p.appeal_filed_epoch) + limits.staleAppealSeconds;
  const unjudged = Number(p.evidence_version) > Number(p.judged_version);

  /* ── the draft: entered by anyone but the insurer, withdrawn by them ──── */

  if (p.status === "DRAFT") {
    acts.push({
      id: "activate",
      label: "Take this policy on",
      does: `Pay the premium and become the policyholder. The coverage, ${coverage}, stays in custody against the trigger.`,
      cost: atto(p.premium_atto),
      blocked: isInsurer
        ? "A policy needs two parties, and the insurer cannot insure its own draft."
        : now >= Number(p.coverage_end_epoch)
          ? "The coverage period is over, and a period that has ended cannot be entered."
          : "",
    });

    if (isInsurer) {
      acts.push({
        id: "cancel_policy",
        label: "Withdraw the draft",
        does: `Nobody has taken this policy on. Cancelling credits the coverage, ${coverage}, back to you.`,
        cost: 0n,
        blocked: "",
      });
    }
  }

  /* ── the claim: the policyholder's alone ─────────────────────────────── */

  if (isHolder && LIVE_STATUSES.includes(p.status)) {
    acts.push({
      id: "file_claim",
      label: "File a claim",
      does: "Name the event window, the reading you claim, and the pages the panel will read.",
      cost: 0n,
      form: "claim",
      blocked: p.appeal_open
        ? "An appeal is open on the last decision, and it decides before another claim can be filed."
        : p.status !== "ACTIVE"
          ? `A claim is filed on an active policy with no decision pending; this one is ${statusWords(p.status)}.`
          : now > graceEnd
            ? `The claim grace after the coverage period ran out ${formatRelative(graceEnd, now)}.`
            : Number(p.evidence_version) >= limits.versionsMax
              ? `The record already holds its ${limits.versionsMax} claim versions.`
              : "",
    });
  }

  /* ── the determination: open to anyone, on purpose ───────────────────── */

  if (p.status === "INVESTIGATING") {
    acts.push({
      id: "investigate",
      label: "Put the claim to the panel",
      does: "Every validator fetches the named pages itself; the outcome follows from what they read.",
      cost: 0n,
      slow: true,
      permissionless: true,
      blocked: p.appeal_open
        ? "An appeal is open, and its own round is the one that decides."
        : Number(p.evidence_version) === 0
          ? "No claim has been filed on this policy yet."
          : "",
    });
  }

  if (p.status === "PENDING_FINALITY") {
    acts.push({
      id: "promote",
      label: "Make the decision final",
      does: "Turn the pending determination into the policy's own state.",
      cost: 0n,
      permissionless: true,
      blocked: p.appeal_open
        ? "An appeal is open, and the re-investigation decides this one."
        : now <= Number(p.pending_until_epoch)
          ? `The finality window is still open — it closes ${formatRelative(Number(p.pending_until_epoch), now)}.`
          : "",
    });
  }

  /* ── the appeal: a party, a bond, and one window ─────────────────────── */

  if (p.status === "FINAL" && (isInsurer || isHolder)) {
    acts.push({
      id: "appeal",
      label: "Appeal this decision",
      does: `Contest it with a bond of ${gen(p.appeal_bond_atto)}. A re-read that changes the outcome returns the bond; one that does not gives it to the other party.`,
      cost: atto(p.appeal_bond_atto),
      form: "appeal",
      /* THE CEILING GATES THE APPEAL TOO, AND IT DID NOT.
         appeal() does not merely record grounds: it writes a NEW package at
         evidence_version + 1 (triggera.py, `new_version`), so a record already
         holding its last version has nowhere to put one and the contract
         refuses unconditionally. Offering the appeal here with no reason —
         complete with its bond figure — promised a party an act that could
         only ever come back refused, and would have taken them through the
         grounds form to find out. The claim act already gated this; the appeal
         was written as though only the window and the parties mattered. */
      blocked: p.appeal_open
        ? sameAddress(address, p.appellant)
          ? "Your appeal is already open on this decision."
          : "An appeal is already open on this decision."
        : now > Number(p.appeal_until_epoch)
          ? `The appeal window closed ${formatRelative(Number(p.appeal_until_epoch), now)}.`
          : Number(p.evidence_version) >= limits.versionsMax
            ? `An appeal adds a version, and the record already holds its ${limits.versionsMax}.`
            : "",
    });
  }

  if (p.appeal_open) {
    acts.push({
      id: "re_investigate",
      label: "Run the appeal round",
      does: "The panel re-reads the recorded bytes of the appealed round, and fetches only what the appellant added.",
      cost: 0n,
      slow: true,
      permissionless: true,
      blocked: "",
    });

    acts.push({
      id: "lapse_appeal",
      label: "Lapse the appeal",
      does: "Close an appeal no round ever concluded: the appealed decision is restored and the bond goes back to the appellant.",
      cost: 0n,
      permissionless: true,
      blocked:
        now <= staleAt
          ? `The stale window opens ${formatRelative(staleAt, now)} — until then, the appeal round is the way out.`
          : "",
    });
  }

  /* ── settlement and the exits ────────────────────────────────────────── */

  if (p.status === "FINAL") {
    acts.push({
      id: "settle",
      label: "Settle this policy",
      does:
        p.outcome === "SATISFIED"
          ? `Credit the whole coverage, ${coverage}, to the policyholder.`
          : p.outcome === "NOT_SATISFIED"
            ? "Close the round: nothing moves, and the policy stays live for the rest of its period."
            : "Carry out the decision that stands.",
      cost: 0n,
      permissionless: true,
      blocked: p.appeal_open
        ? "An appeal is open, and it must conclude before anything settles."
        : now <= Number(p.appeal_until_epoch)
          ? `The appeal window is still open — it closes ${formatRelative(Number(p.appeal_until_epoch), now)}.`
          : p.outcome !== "SATISFIED" && p.outcome !== "NOT_SATISFIED"
            ? "No conclusive decision stands on this policy."
            : p.evidence_flag !== "SUFFICIENT"
              ? "The determination was made over an insufficient record, which cannot settle."
              : "",
    });
  }

  if (p.status === "ACTIVE" || p.status === "INVESTIGATING") {
    acts.push({
      id: "expire",
      label: "Return the coverage",
      does: `The period and its grace passed with no trigger verified, so ${coverage} goes back to the insurer.`,
      cost: 0n,
      permissionless: true,
      blocked: p.appeal_open
        ? "An open appeal has to be resolved first."
        : now <= graceEnd
          ? `Claims run for ${formatSpan(Number(p.claim_grace))} after the coverage period — that grace ends ${formatRelative(graceEnd, now)}.`
          : unjudged && now <= patienceEnd
            ? `A claim on the record has not been investigated yet. Put it to the panel, or return the coverage ${formatRelative(patienceEnd, now)}.`
            : "",
    });
  }

  /* ── the withdrawal: the only path value takes out of the contract ───── */

  if (claimableAtto > 0n) {
    acts.push({
      id: "claim",
      label: `Withdraw ${gen(claimableAtto)}`,
      does: "Your credited balance leaves the contract for this wallet. It is the only way value ever does.",
      cost: 0n,
      blocked: "",
    });
  }

  return acts;
}

/** The acts a wallet can take right now. */
export function offered(acts: Act[]): Act[] {
  return acts.filter((a) => a.blocked === "");
}

/** The acts it cannot, each carrying the reason instead of a failing button. */
export function withheld(acts: Act[]): Act[] {
  return acts.filter((a) => a.blocked !== "");
}
