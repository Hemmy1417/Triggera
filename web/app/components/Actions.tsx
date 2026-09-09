"use client";

/**
 * THE ACTION SURFACE — every write the contract exposes, as something a
 * connected wallet can actually do.
 *
 * Until this existed the app could write exactly one method, create_policy,
 * and the other ten lived only in tests and scripts. A protocol whose acts
 * are unreachable from its interface is a protocol nobody can check.
 *
 * Four rules, all of them the app's existing ones applied to a card that
 * spends money:
 *
 *   ONE WRITE PATH. Every act goes through writeAndConfirm — fee simulation,
 *   signature, submission, a VIEW PREDICATE that proves the state moved, then
 *   finality — and renders the same TxFlow the policy builder does. There is
 *   no second way to send a transaction in this app.
 *
 *   AN ACT SAYS WHAT IT COSTS AND WHAT IT DOES BEFORE IT IS CLICKED. Where
 *   the value must match the contract exactly — the activation premium, the
 *   appeal bond — the figure is stated in full and the write sends that same
 *   number, never a re-derivation of it.
 *
 *   AN UNAVAILABLE ACT IS A SENTENCE, NOT A FAILING BUTTON. lib/acts.ts
 *   mirrors the contract's gates and returns the reason; this renders it.
 *
 *   A REFUSED WRITE SHOWS THE CONTRACT'S OWN WORDS. And a PASSING failure —
 *   the consensus clock or a model, which every write here but the withdrawal
 *   depends on — is named as something to retry, because it is.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  CONTRACT_ADDRESS,
  CONTRACT_CONFIGURED,
  epochFromLocal,
  formatGenExact,
  formatSpan,
  localFromEpoch,
} from "../../lib/config";
import { sameAddress } from "../../lib/chain";
import {
  availableActs,
  CONTRACT_LIMITS,
  offered,
  withheld,
  type Act,
  type ActId,
} from "../../lib/acts";
import {
  getClaimable,
  getPolicy,
  invalidateReads,
  type BasisEntry,
  type Policy,
} from "../../lib/read";
import {
  contractRefusal,
  inFlight,
  passingFailure,
  writeAndConfirm,
  type TxProgress,
} from "../../lib/tx";
import { matchBasis, normalizeUrl, validUrl } from "../../lib/urls";
import { useNow } from "../../lib/useNow";
import { useWallet } from "../../lib/wallet";
import { Field, Ident, Technical } from "./bits";
import { TxFlow } from "./TxFlow";

/* ── the bounds these two forms are written against ──────────────────────
   Mirrors of contracts/triggera.py, checked here so the contract's answer is
   almost never "no"; the contract re-runs every one of them and its answer is
   the only one that counts. */
const MAX_SOURCES = 6;
const MAX_LABEL_CHARS = 80;
const MIN_GROUNDS_CHARS = 20;
const MAX_GROUNDS_CHARS = 600;
const MAX_EVENT_WINDOW_SECONDS = 2_592_000;
const MAX_READING = 10 ** 12;

const KIND_WORDS: Record<string, string> = {
  METEOROLOGICAL_AGENCY: "Meteorological agency",
  WEATHER_PROVIDER: "Weather provider",
  SEISMIC_NETWORK: "Seismic network",
  SATELLITE_OBSERVATION: "Satellite observation",
  GOVERNMENT_RECORD: "Government record",
  NEWS_REPORT: "News report",
  STATION_LOG: "Station log",
  OTHER: "Other",
};

function kindWords(kind: string): string {
  const known = KIND_WORDS[kind];
  if (known) return known;
  const s = kind.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What to say once a write is FINAL, per act.
 *
 * Six of these are permissionless, so the sentence speaks about the STATE and
 * never about the user's transaction: a keeper step can be satisfied by a
 * stranger's transaction landing first, and writeAndConfirm appends the honest
 * "this transaction itself finalized without effect" line when that happens.
 */
const CONFIRMED: Record<ActId, string> = {
  activate: "Finalized. You are the policyholder, and the premium is the insurer's.",
  cancel_policy: "Finalized. The draft is cancelled and the coverage is credited back to you.",
  file_claim: "Finalized. The claim is on the record, waiting on a panel.",
  investigate: "Finalized. A determination is recorded, and its finality window is running.",
  promote: "Finalized. The determination is now the policy's own state.",
  appeal: "Finalized. The appeal is open and the bond is held against it.",
  re_investigate:
    "Finalized. The appeal is concluded, and the new determination's finality window is running.",
  lapse_appeal:
    "Finalized. The appeal lapsed, the decision it contested stands, and the bond is back with the appellant.",
  settle: "Finalized. The decision is carried out.",
  expire: "Finalized. The coverage is back on the insurer's ledger.",
  claim: "Finalized. The balance has left the contract for this wallet.",
};

/** Which side of this policy the connected wallet is on. The contract stores
 *  addresses lowercase and the wallet hands back EIP-55, so this comparison
 *  goes through sameAddress or it is false for the party every time. */
function roleWords(p: Policy, address: string): string {
  if (!address) return "not connected";
  if (sameAddress(address, p.insurer)) return "as the insurer";
  if (sameAddress(address, p.policyholder)) return "as the policyholder";
  return "as anyone";
}

/** The gate every act but the withdrawal passes through before its own. */
function walletGate(address: string, chainOk: boolean): string {
  if (!CONTRACT_CONFIGURED) return "No contract is configured for this deployment.";
  if (!address) return "Connect a wallet — these acts are signed from it.";
  if (!chainOk) return "Switch your wallet to GenLayer Studio Next.";
  return "";
}

/**
 * Has the chain caught up with the act that was just sent?
 *
 * Every predicate here polls a field the contract ACTUALLY MOVES for that
 * act, which is subtler than it looks: promote on an UNDETERMINED outcome
 * puts the status back to ACTIVE, and settle on NOT_SATISFIED does the same,
 * so neither can be confirmed by watching the status. The versions and the
 * settlement stamp can only go forward, so those are what get watched. Every
 * read is forced past the 4-second cache, which would otherwise answer with
 * the value from before the write.
 */
async function landed(
  id: ActId,
  policyId: string,
  address: string,
  before: Policy | null,
  beforeBalance: bigint,
): Promise<boolean> {
  if (id === "claim") return BigInt(await getClaimable(address)) < beforeBalance;
  const p = await getPolicy(policyId, true);
  if (!p || !before) return false;
  switch (id) {
    case "activate":
      return sameAddress(p.policyholder, address);
    case "cancel_policy":
      return p.status === "CANCELLED";
    case "file_claim":
      return Number(p.evidence_version) > Number(before.evidence_version);
    case "investigate":
      return p.status === "PENDING_FINALITY" &&
        Number(p.pending_version) === Number(before.evidence_version);
    case "promote":
      /* Promotion moves the PENDING version into the judged one, and does it
         whether the outcome is conclusive or an UNDETERMINED hold that sends
         the status back to ACTIVE — so the version is the only field that
         says it happened. The guard keeps a policy with nothing pending from
         satisfying this the instant it is asked. */
      return (
        Number(before.pending_version) > 0 &&
        Number(p.judged_version) === Number(before.pending_version)
      );
    case "appeal":
      return p.appeal_open;
    case "re_investigate":
      return !p.appeal_open && p.status === "PENDING_FINALITY";
    case "lapse_appeal":
      return !p.appeal_open;
    case "settle":
      return Number(p.settled_epoch) > Number(before.settled_epoch);
    case "expire":
      return p.status === "EXPIRED";
    default:
      return false;
  }
}

/* ── the shared write ───────────────────────────────────────────────────── */

type Runner = {
  tx: TxProgress | null;
  refusal: string;
  busy: boolean;
  running: ActId | "";
  run: (act: Act, args: unknown[], policyId: string) => Promise<void>;
};

/**
 * One write at a time, with one flow and one quotation to show for it.
 *
 * `tx` is deliberately never cleared on success: writeAndConfirm RESOLVES at
 * accepted and keeps reporting through onProgress for up to two more minutes
 * while it proves finality, so a component that tidied the flow away on
 * resolve would snatch the lifecycle from under the reader mid-step.
 */
function useRunner(onLanded: () => void): Runner {
  const { address, client } = useWallet();
  const [tx, setTx] = useState<TxProgress | null>(null);
  const [refusal, setRefusal] = useState("");
  const [running, setRunning] = useState<ActId | "">("");

  const run = useCallback(
    async (act: Act, args: unknown[], policyId: string) => {
      if (!client) return;
      setRefusal("");
      setRunning(act.id);

      /* The baseline every predicate below is measured against, read fresh:
         the page's own copy of the policy can be minutes old, and a stale
         baseline would report a write as landed the moment it was sent. */
      let before: Policy | null = null;
      let beforeBalance = 0n;
      try {
        if (act.id === "claim") {
          beforeBalance = BigInt(await getClaimable(address));
        } else {
          before = await getPolicy(policyId, true);
          if (!before) throw new Error("the policy could not be read");
        }
      } catch {
        setTx({
          stage: "failed",
          at: "estimating",
          detail:
            "Studio Next could not be read to see where this policy stands, so nothing was " +
            "sent. Retrying usually works.",
        });
        setRunning("");
        return;
      }

      try {
        await writeAndConfirm({
          client,
          address: CONTRACT_ADDRESS,
          functionName: act.id,
          args,
          valueAtto: act.cost,
          onProgress: setTx,
          confirmedDetail: CONFIRMED[act.id],
          /* A panel round is minutes of live fetching inside consensus, so
             the confirmation ceiling is raised from three minutes to nine
             for the two acts that run one. */
          predicateTries: act.slow ? 90 : 30,
          predicate: () => landed(act.id, policyId, address, before, beforeBalance),
        });
        invalidateReads();
        onLanded();
      } catch (err) {
        /* The contract's own sentence, verbatim — except that a TRANSIENT or
           LLM_ERROR one is not a refusal at all. Every write here but the
           withdrawal reads the consensus clock, and a clock that could not be
           agreed is a write to send again, not a write that was rejected. */
        const said = contractRefusal(err);
        if (said) {
          setRefusal(
            passingFailure(said)
              ? `${said} Nothing was sent, and the same write usually goes through on the next attempt.`
              : said,
          );
        }
      } finally {
        setRunning("");
      }
    },
    [client, address, onLanded],
  );

  return { tx, refusal, busy: inFlight(tx?.stage ?? "idle"), running, run };
}

/**
 * The wallet's claimable balance, and a way to ask for it again.
 *
 * Read on connection and after a landed write, never on a timer: it is an
 * uncached RPC call and the Studio meters reads. The balance is held WITH the
 * address it was read for, so switching accounts can never show the previous
 * one's money for the render before the new read lands, and a read that fails
 * leaves the balance unknown rather than asserting zero — an unread balance is
 * not an empty one.
 */
/* ONE BALANCE, NOT TWO.
 *
 * This hook has two callers: the global Withdrawal in Shell, and the act rail
 * on a policy page. Given a state of its own, each kept a private copy — so a
 * withdrawal made from one left the other still holding the pre-withdrawal
 * figure, offering to take money that was already gone. The contract would
 * have refused it with "nothing claimable", which is the right answer to a
 * question the app should never have asked.
 *
 * The balance belongs to the WALLET, not to either component, so it lives
 * outside both: one snapshot, one loader, and every mounted reader notified
 * together. It is still read only on connection and after a landed write —
 * never on a timer — and a read that fails still leaves the balance unknown
 * rather than asserting zero, because an unread balance is not an empty one.
 */
let CLAIM_SNAPSHOT: { addr: string; atto: bigint } = { addr: "", atto: 0n };
const CLAIM_LISTENERS = new Set<() => void>();
const claimSubscribe = (fn: () => void) => {
  CLAIM_LISTENERS.add(fn);
  return () => {
    CLAIM_LISTENERS.delete(fn);
  };
};
const claimSnapshot = () => CLAIM_SNAPSHOT;

async function loadClaimable(address: string): Promise<void> {
  if (!address || !CONTRACT_CONFIGURED) return;
  try {
    const v = await getClaimable(address);
    CLAIM_SNAPSHOT = { addr: address, atto: BigInt(v) };
    for (const fn of CLAIM_LISTENERS) fn();
  } catch {
    /* unknown, not zero: the withdrawal is simply not offered until a read
       succeeds, and a failed read must not erase a balance already shown */
  }
}

function useClaimable(address: string): { atto: bigint; refresh: () => void } {
  const held = useSyncExternalStore(claimSubscribe, claimSnapshot, claimSnapshot);
  useEffect(() => {
    void loadClaimable(address);
  }, [address]);
  const refresh = useCallback(() => {
    void loadClaimable(address);
  }, [address]);
  const atto = sameAddress(held.addr, address) ? held.atto : 0n;
  return useMemo(() => ({ atto, refresh }), [atto, refresh]);
}

/* ── the claim form ─────────────────────────────────────────────────────── */

type SourceRow = { url: string; label: string };

type ClaimDraft = {
  startLocal: string;
  endLocal: string;
  reading: string;
  sources: SourceRow[];
};

/** A window defaulted from the policy: one measurement window, ending at the
 *  last whole hour that is both past and inside the coverage period. */
function seedClaim(p: Policy): ClaimDraft {
  const capped = Math.min(Math.floor(Date.now() / 1000), Number(p.coverage_end_epoch));
  const end = capped - (capped % 3600);
  const span = Math.max(3600, Number(p.measurement_hours) * 3600);
  const start = Math.max(Number(p.coverage_start_epoch), end - span);
  const independent = (p.basis ?? []).filter((b) => b.class === "INDEPENDENT");
  const first = independent[0] ?? (p.basis ?? [])[0];
  return {
    startLocal: localFromEpoch(start),
    endLocal: localFromEpoch(end),
    /* The window and the sources are defaulted from the policy; the READING
       is not. It is the one thing on this form the policy cannot know, and a
       number the app suggested would be a claim the app made. */
    reading: "",
    sources: [
      first
        ? { url: `https://${first.origin}/`, label: kindWords(first.kind) }
        : { url: "", label: "" },
    ],
  };
}

/** Every local mirror of what file_claim would refuse, per field. */
function claimProblems(
  d: ClaimDraft,
  p: Policy,
  now: number,
): { fields: Record<string, string>; sources: string[]; overall: string[] } {
  const fields: Record<string, string> = {};
  const overall: string[] = [];
  const start = epochFromLocal(d.startLocal);
  const end = epochFromLocal(d.endLocal);

  if (start === null) fields.start = "Name when the event window opened.";
  if (end === null) fields.end = "Name when it closed.";
  if (start !== null && end !== null) {
    if (end <= start) fields.end = "The window has to end after it starts.";
    else if (end > now) fields.end = "The window has to be over before a claim names it.";
    else if (end - start > MAX_EVENT_WINDOW_SECONDS) {
      fields.end = "A claim may name at most 30 days.";
    }
    if (start < Number(p.coverage_start_epoch)) {
      fields.start = "The window has to lie inside the coverage period.";
    }
    if (end > Number(p.coverage_end_epoch)) {
      fields.end = "The window has to lie inside the coverage period.";
    }
  }

  const reading = /^\d{1,13}$/.test(d.reading.trim()) ? Number(d.reading.trim()) : null;
  if (reading === null || reading > MAX_READING) {
    fields.reading = `A whole number, in ${p.unit}.`;
  }

  const sources = d.sources.map(() => "");
  const seen = new Set<string>();
  let independent = 0;
  d.sources.forEach((row, i) => {
    const url = row.url.trim();
    const label = row.label.trim();
    if (!url) {
      sources[i] = "Name the page the panel will read.";
      return;
    }
    if (!validUrl(url)) {
      sources[i] = "An http or https address, plain ASCII, up to 400 characters.";
      return;
    }
    const matched = matchBasis(url, (p.basis ?? []) as BasisEntry[]);
    if (!matched) {
      sources[i] =
        "This page sits outside the agreed evidence basis — the panel reads only the origins both parties signed.";
      return;
    }
    const norm = normalizeUrl(url);
    if (seen.has(norm)) {
      sources[i] = "This page is already named above; one page is one source, however it is spelled.";
      return;
    }
    seen.add(norm);
    if (matched.class === "INDEPENDENT") independent += 1;
    if (!label) sources[i] = "Say what this page is.";
    else if (label.length > MAX_LABEL_CHARS) sources[i] = "At most 80 characters.";
  });

  if (d.sources.length < 1 || d.sources.length > MAX_SOURCES) {
    overall.push(`Name between one and ${MAX_SOURCES} sources.`);
  }
  if (independent === 0) {
    overall.push(
      "At least one source has to sit on an independent origin — a party's own record cannot trigger a payout.",
    );
  }

  return { fields, sources, overall };
}

/* ── the appeal form ────────────────────────────────────────────────────── */

type AppealDraft = { grounds: string; url: string; label: string };

function appealProblems(
  d: AppealDraft,
  p: Policy,
  atCeiling: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  const grounds = d.grounds.trim();
  if (grounds.length < MIN_GROUNDS_CHARS || grounds.length > MAX_GROUNDS_CHARS) {
    out.grounds = `Between ${MIN_GROUNDS_CHARS} and ${MAX_GROUNDS_CHARS} characters — ${grounds.length} so far.`;
  }
  const url = d.url.trim();
  if (url) {
    if (atCeiling) {
      out.url = "The record is full, so this appeal can carry its grounds and nothing else.";
    } else if (!validUrl(url)) {
      out.url = "An http or https address, plain ASCII, up to 400 characters.";
    } else if (!matchBasis(url, (p.basis ?? []) as BasisEntry[])) {
      out.url =
        "This page sits outside the agreed evidence basis — an appeal cannot widen what was signed.";
    } else if (!d.label.trim()) {
      out.label = "Say what this page is.";
    } else if (d.label.trim().length > MAX_LABEL_CHARS) {
      out.label = "At most 80 characters.";
    }
  }
  return out;
}

/* ── the surface ────────────────────────────────────────────────────────── */

/** The origins a source may sit on, as the kind both parties agreed plus the
 *  hostname itself in the fold — the hostname is a machine value and does not
 *  belong on the face, but a form that asks for a URL owes it with copy. */
function BasisFold({ basis }: { basis: BasisEntry[] }) {
  return (
    <Technical
      summary="The origins a source may sit on"
      rows={basis.map(
        (b, i) =>
          [
            `${kindWords(b.kind).toLowerCase()} · ${b.class === "INDEPENDENT" ? "independent" : "a party's own"}`,
            <Ident key={`${b.origin}-${i}`} value={b.origin} label="Copy origin" />,
          ] as [string, React.ReactNode],
      )}
    />
  );
}

/** Why a policy offers nothing, in the words of what happened to it. */
function closedWords(p: Policy): string {
  if (p.status === "PAID") {
    return "This policy is closed. The trigger was met, the coverage was paid to the policyholder, and it has been withdrawn — nothing is left to do here.";
  }
  if (p.status === "EXPIRED") {
    return "This policy is closed. Its period and claim grace ran out, and the coverage went back to the insurer.";
  }
  if (p.status === "CANCELLED") {
    return "This draft was cancelled before anyone activated it, and its coverage was returned.";
  }
  return "Nothing is available to this wallet on this policy right now.";
}

export function Actions({
  policy,
  onLanded,
}: {
  policy: Policy;
  onLanded: () => void;
}) {
  const { address, chainOk } = useWallet();
  const now = useNow();
  const balance = useClaimable(address);
  const [openForm, setOpenForm] = useState<"claim" | "appeal" | "">("");
  const [claim, setClaim] = useState<ClaimDraft>({
    startLocal: "",
    endLocal: "",
    reading: "",
    sources: [],
  });
  const [appeal, setAppeal] = useState<AppealDraft>({ grounds: "", url: "", label: "" });

  const landedThen = useCallback(() => {
    setOpenForm("");
    balance.refresh();
    onLanded();
  }, [onLanded, balance]);

  const { tx, refusal, busy, running, run } = useRunner(landedThen);

  const claimable = balance.atto;
  const acts = useMemo(
    () => availableActs(policy, address, now, claimable),
    [policy, address, now, claimable],
  );
  const can = offered(acts);
  const cannot = withheld(acts);
  const gate = walletGate(address, chainOk);

  const basis = (policy.basis ?? []) as BasisEntry[];
  /* A new source is a new version, and the record holds a fixed number of
     them — an appeal at the ceiling may still carry its grounds. */
  const atCeiling = Number(policy.evidence_version) >= CONTRACT_LIMITS.versionsMax;
  const claimIssues = claimProblems(claim, policy, now);
  const claimBlocked =
    Object.keys(claimIssues.fields).length +
      claimIssues.sources.filter(Boolean).length +
      claimIssues.overall.length >
    0;
  const appealIssues = appealProblems(appeal, policy, atCeiling);
  const appealBlocked = Object.keys(appealIssues).length > 0;

  const start = () => {
    setClaim(seedClaim(policy));
    setOpenForm("claim");
  };

  const send = (act: Act) => {
    if (act.id === "file_claim") {
      const s = epochFromLocal(claim.startLocal);
      const e = epochFromLocal(claim.endLocal);
      if (s === null || e === null) return;
      void run(
        act,
        [
          policy.policy_id,
          s,
          e,
          Number(claim.reading.trim()),
          JSON.stringify(
            claim.sources.map((r) => ({ url: r.url.trim(), label: r.label.trim() })),
          ),
        ],
        policy.policy_id,
      );
      return;
    }
    if (act.id === "appeal") {
      const url = atCeiling ? "" : appeal.url.trim();
      void run(
        act,
        [policy.policy_id, appeal.grounds.trim(), url, url ? appeal.label.trim() : ""],
        policy.policy_id,
      );
      return;
    }
    if (act.id === "claim") {
      void run(act, [], policy.policy_id);
      return;
    }
    void run(act, [policy.policy_id], policy.policy_id);
  };

  /* A CLOSED POLICY IS AN ANSWER, NOT AN ABSENCE.
     Returning null here made the whole rail vanish on a settled policy — and
     the first policy a visitor opens on this deployment is a settled one, so
     the acts appeared to not exist at all. A record that has run its course
     should SAY it has run its course. It also keeps the rail on screen while
     a transaction that emptied the list is still reporting itself. */
  if (acts.length === 0 && !tx) {
    return (
      <section className="card" aria-label="Actions">
        <div className="card-head">
          <span className="card-title">What you can do now</span>
        </div>
        <p className="body-sm muted" style={{ marginTop: 12 }}>
          {closedWords(policy)}
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-label="Actions">
      <div className="card-head">
        <span className="card-title">What you can do now</span>
        <span className="eyebrow">{roleWords(policy, address)}</span>
      </div>

      <div className="stack">
        {can.map((act, i) => {
          const isOpen = act.form !== undefined && openForm === act.form;
          const inFlightHere = running === act.id;
          return (
            <div className="tile" key={act.id}>
              <div className="pair">
                <span className="pair-label">{act.label}</span>
                <span className="pair-note">{act.does}</span>
              </div>

              <div className="pair-row" style={{ marginTop: 14 }}>
                <span className="pair-label">Sends</span>
                <span className="pair-value">
                  {act.cost > 0n ? (
                    <>
                      {formatGenExact(act.cost)}
                      <span className="unit">GEN</span>
                    </>
                  ) : (
                    "nothing but the fee"
                  )}
                </span>
              </div>
              {act.cost > 0n ? (
                <p className="caption muted" style={{ marginTop: 8 }}>
                  This amount has to match to the last atto, so it is sent exactly as shown.
                </p>
              ) : null}
              {act.slow ? (
                <p className="caption muted" style={{ marginTop: 8 }}>
                  A panel round fetches every source live inside consensus, and the fee
                  simulation runs the same round first — expect several minutes, and leave this
                  page open.
                </p>
              ) : null}
              {act.permissionless ? (
                <p className="caption muted" style={{ marginTop: 8 }}>
                  Anyone may call this one, so someone else&apos;s transaction can get there
                  first. The record is what changes, not who paid for it.
                </p>
              ) : null}

              {/* the two acts that need answers before they can be sent */}
              {act.form === "claim" && isOpen ? (
                <ClaimForm
                  policy={policy}
                  draft={claim}
                  setDraft={setClaim}
                  issues={claimIssues}
                  basis={basis}
                />
              ) : null}
              {act.form === "appeal" && isOpen ? (
                <AppealForm
                  draft={appeal}
                  setDraft={setAppeal}
                  issues={appealIssues}
                  atCeiling={atCeiling}
                  basis={basis}
                />
              ) : null}

              <div className="chiprow" style={{ marginTop: 20, alignItems: "center" }}>
                {act.form && !isOpen ? (
                  <button
                    type="button"
                    className={i === 0 ? "pill primary" : "pill"}
                    onClick={() => (act.form === "claim" ? start() : setOpenForm("appeal"))}
                    disabled={busy}
                  >
                    {act.label}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={i === 0 ? "pill primary" : "pill"}
                    onClick={() => send(act)}
                    disabled={
                      Boolean(gate) ||
                      busy ||
                      (act.form === "claim" && claimBlocked) ||
                      (act.form === "appeal" && appealBlocked)
                    }
                  >
                    {inFlightHere && busy ? "Writing…" : act.form ? "Send it" : act.label}
                  </button>
                )}
                {act.form && isOpen ? (
                  <button type="button" className="ghost" onClick={() => setOpenForm("")}>
                    cancel
                  </button>
                ) : null}
                {gate ? <span className="body-sm muted">{gate}</span> : null}
                {!gate && act.form === "claim" && isOpen && claimBlocked ? (
                  <span className="body-sm muted">
                    {claimIssues.overall[0] ?? "Some answers are still outstanding."}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* an act that would be refused is never offered as a button that fails */}
        {cannot.map((act) => (
          <div className="gate" key={act.id}>
            <span className="pair-label">{act.label}</span>
            <span>{act.blocked}</span>
          </div>
        ))}

        {tx ? <TxFlow p={tx} /> : null}
        {refusal ? <blockquote className="reason">{refusal}</blockquote> : null}

        <p className="caption muted">
          Windows run on the consensus clock the contract fetches itself, so the boundaries
          shown here may be minutes off.
        </p>

        <Technical
          summary="What each act sends"
          rows={[
            ...acts.map(
              (a) =>
                [
                  a.id,
                  a.cost > 0n ? `${a.cost.toString()} atto` : "no value",
                ] as [string, React.ReactNode],
            ),
            ["policy", <Ident key="pid" value={policy.policy_id} />],
            ["contract", <Ident key="c" value={CONTRACT_ADDRESS} label="Copy contract address" />],
            ["claimable to this wallet", `${claimable.toString()} atto`],
          ]}
        />
      </div>
    </section>
  );
}

function ClaimForm({
  policy,
  draft,
  setDraft,
  issues,
  basis,
}: {
  policy: Policy;
  draft: ClaimDraft;
  setDraft: (d: ClaimDraft) => void;
  issues: { fields: Record<string, string>; sources: string[]; overall: string[] };
  basis: BasisEntry[];
}) {
  const set = (patch: Partial<ClaimDraft>) => setDraft({ ...draft, ...patch });
  const setSource = (i: number, patch: Partial<SourceRow>) =>
    set({ sources: draft.sources.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="stack" style={{ marginTop: 24 }}>
      <div className="pairs two">
        <Field
          label="Event opened"
          problem={issues.fields.start}
          hint="inside the coverage period"
        >
          <input
            type="datetime-local"
            value={draft.startLocal}
            onChange={(e) => set({ startLocal: e.target.value })}
          />
        </Field>
        <Field
          label="Event closed"
          problem={issues.fields.end}
          hint={`already over — the agreed measurement window is ${formatSpan(Number(policy.measurement_hours) * 3600)}`}
        >
          <input
            type="datetime-local"
            value={draft.endLocal}
            onChange={(e) => set({ endLocal: e.target.value })}
          />
        </Field>
      </div>

      <Field
        label={`Reading you claim, in ${policy.unit}`}
        problem={issues.fields.reading}
        hint="a claim, never a reading — the panel states what the sources themselves say"
      >
        <input
          inputMode="numeric"
          value={draft.reading}
          onChange={(e) => set({ reading: e.target.value })}
        />
      </Field>

      <div className="stack">
        {draft.sources.map((row, i) => (
          <div className="pairs two" key={i}>
            <Field
              label={`Source ${i + 1}`}
              problem={issues.sources[i]}
              hint="a page on one of the agreed origins that states the reading"
            >
              <input
                value={row.url}
                onChange={(e) => setSource(i, { url: e.target.value })}
                placeholder="https://"
              />
            </Field>
            <Field label="What it is" hint="how this page should be read">
              <input
                value={row.label}
                onChange={(e) => setSource(i, { label: e.target.value })}
              />
            </Field>
          </div>
        ))}
        <div className="chiprow">
          {draft.sources.length < MAX_SOURCES ? (
            <button
              type="button"
              className="ghost"
              onClick={() => set({ sources: [...draft.sources, { url: "", label: "" }] })}
            >
              + another source
            </button>
          ) : null}
          {draft.sources.length > 1 ? (
            <button
              type="button"
              className="ghost"
              onClick={() => set({ sources: draft.sources.slice(0, -1) })}
            >
              − the last one
            </button>
          ) : null}
        </div>
      </div>

      <BasisFold basis={basis} />
    </div>
  );
}

function AppealForm({
  draft,
  setDraft,
  issues,
  atCeiling,
  basis,
}: {
  draft: AppealDraft;
  setDraft: (d: AppealDraft) => void;
  issues: Record<string, string>;
  atCeiling: boolean;
  basis: BasisEntry[];
}) {
  const set = (patch: Partial<AppealDraft>) => setDraft({ ...draft, ...patch });
  return (
    <div className="stack" style={{ marginTop: 24 }}>
      <Field
        label="Grounds"
        problem={issues.grounds}
        hint="what the round got wrong, in one paragraph — it is recorded with the appeal"
      >
        <textarea
          rows={4}
          value={draft.grounds}
          onChange={(e) => set({ grounds: e.target.value })}
        />
      </Field>

      {atCeiling ? (
        <div className="gate">
          <span className="pair-label">No new source</span>
          <span>The record already holds its six versions, so this appeal carries grounds alone.</span>
        </div>
      ) : (
        <div className="pairs two">
          <Field
            label="One more source, if you have one"
            problem={issues.url}
            hint="optional, and on an agreed origin — the second round reads the recorded bytes plus this"
          >
            <input
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://"
            />
          </Field>
          <Field label="What it is" problem={issues.label} hint="required with a source">
            <input value={draft.label} onChange={(e) => set({ label: e.target.value })} />
          </Field>
        </div>
      )}

      <BasisFold basis={basis} />
    </div>
  );
}

/* ── the withdrawal, on every page ──────────────────────────────────────── */

/**
 * A credited balance follows the wallet.
 *
 * The pull ledger is the contract's only external value path: settle, expire,
 * cancel and a decided appeal all CREDIT rather than pay, and nothing moves
 * until the wallet withdraws it. So the balance cannot live on one page — a
 * user who settles a policy and navigates away would have no way of knowing
 * money was waiting. Renders nothing at all when there is nothing to take.
 */
export function Withdrawal() {
  const { address, chainOk } = useWallet();
  const balance = useClaimable(address);
  const { tx, refusal, busy, run } = useRunner(balance.refresh);

  /* A successful withdrawal sets the balance to zero, and returning null on
     that would unmount the very lifecycle reporting the success — the user
     would see the act vanish and never learn it landed. Stay mounted while a
     transaction is still on screen. */
  if (balance.atto <= 0n && !tx) return null;

  const act: Act = {
    id: "claim",
    label: `Withdraw ${formatGenExact(balance.atto)} GEN`,
    does: "the only path value takes out of the contract",
    cost: 0n,
    blocked: "",
  };
  const gate = walletGate(address, chainOk);

  return (
    <div className="claimbar">
      <div className="gate live">
        <span className="pair-label">Yours to withdraw</span>
        <span className="pair-value">
          {formatGenExact(balance.atto)}
          <span className="unit">GEN</span>
        </span>
        <span className="spacer" style={{ flex: "1 1 auto" }} />
        <button
          type="button"
          className="pill"
          onClick={() => void run(act, [], "")}
          disabled={Boolean(gate) || busy}
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
      </div>
      {tx ? (
        <div style={{ marginTop: 16 }}>
          <TxFlow p={tx} />
        </div>
      ) : null}
      {refusal ? (
        <blockquote className="reason" style={{ marginTop: 16 }}>
          {refusal}
        </blockquote>
      ) : null}
    </div>
  );
}
