"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { formatDate, formatGen, formatSpan } from "../../../lib/config";
import {
  getDecision,
  getPackage,
  getPolicy,
  type ClaimPackage,
  type Decision,
  type Policy,
} from "../../../lib/read";
import { Actions } from "../../components/Actions";
import { Dot, Ident, StateNote, Status, Technical } from "../../components/bits";
import { triggerSentence } from "../../components/trigger";
import { explorerAddress } from "../../components/Shell";

type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "down"; why: string };

const TABS = ["Trigger", "Evidence", "Determination", "Settlement"] as const;
type Tab = (typeof TABS)[number];

/* What an origin IS, in the words both parties agreed to. The KIND is the
   fact a reader came for; the hostname behind it is plumbing and lives in
   the technical fold. */
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

const classWords = (cls: string) => (cls === "INDEPENDENT" ? "Independent" : "A party's own");

const HOLD_WORDS: Record<string, string> = {
  EVIDENCE_INSUFFICIENT: "the record does not establish what the metric did in the insured area",
  UNCORROBORATED: "fewer independent publishers than the policy requires stated a usable reading",
  SPLIT_EVIDENCE: "the publishers divided exactly, and the protocol will not break a tie by guessing",
};

const CONFLICT_WORDS: Record<string, string> = {
  FABRICATION_INDICATED: "a source appears fabricated",
  WINDOW_MISMATCH: "a reading is for the wrong window",
  LOCATION_MISMATCH: "a reading is for the wrong place",
  UNIT_MISMATCH: "a reading is in the wrong unit",
  READING_CONTRADICTION: "the readings contradict each other",
  SOURCE_MISLABELLED: "a source is not what its agreed label says",
  OTHER_CONFLICT: "another material contradiction",
};

function outcomeWords(o: string): { state: string; label: string } {
  if (o === "SATISFIED") return { state: "satisfied", label: "trigger met" };
  if (o === "NOT_SATISFIED") return { state: "not-satisfied", label: "trigger not met" };
  if (o === "UNDETERMINED") return { state: "undetermined", label: "undetermined" };
  return { state: "draft", label: "not yet determined" };
}

function windowWords(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) {
    const d = hours / 24;
    return d === 1 ? "24 hours" : `${d} days`;
  }
  return `${hours} hours`;
}

/** Where the policy applies, as a place a person recognises. The coordinates
 *  that produced it are a machine value and belong in the fold. */
function placeWords(p: Policy): string {
  const where = `${p.region}, ${p.country}`;
  return p.radius_km > 0 ? `${where} · ${p.radius_km} km` : where;
}

export default function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [policy, setPolicy] = useState<Load<Policy | null>>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("Trigger");
  const [pkg, setPkg] = useState<ClaimPackage | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  /* An act on this page changes the record, so the page has to be able to
     read itself again. `reload` is bumped when a write LANDS; the re-read is
     forced past the four-second cache, and it deliberately does NOT put the
     view back into its loading state — the transaction flow is rendered by a
     component below, and blanking the page would unmount the very lifecycle
     the user is watching. */
  const [reload, setReload] = useState(0);
  const again = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    getPolicy(id, reload > 0)
      .then((p) => live && setPolicy({ state: "ok", data: p }))
      .catch((e) => {
        /* a failed refresh keeps the record that is already on screen: the
           first read is the only one allowed to report the page unreadable */
        if (live && reload === 0) setPolicy({ state: "down", why: String(e?.message ?? e) });
      });
    return () => {
      live = false;
    };
  }, [id, reload]);

  const p = policy.state === "ok" ? policy.data : null;
  const version = p?.evidence_version ?? 0;
  const judged = p?.judged_version || p?.pending_version || 0;

  useEffect(() => {
    if (!p || version === 0) return;
    let live = true;
    /* A version's package and decision never change once written, so they are
       cached hard — but an ABSENT decision caches as null for a minute, and a
       round that has just landed would be reported as "not yet decided" for
       the rest of it. A landed write forces both. */
    const force = reload > 0;
    getPackage(id, version, force).then((v) => live && setPkg(v)).catch(() => {});
    if (judged > 0) {
      getDecision(id, judged, force).then((v) => live && setDecision(v)).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [id, p, version, judged, reload]);

  if (policy.state === "loading") {
    return (
      <main className="page">
        <StateNote kind="loading">Reading the policy…</StateNote>
      </main>
    );
  }
  if (policy.state === "down") {
    return (
      <main className="page">
        <StateNote kind="unreachable">
          This policy could not be read. This is the network, not the record.
        </StateNote>
      </main>
    );
  }
  if (!p) {
    return (
      <main className="page">
        <StateNote kind="empty">
          No policy with this identifier exists on the contract.{" "}
          <Link href="/policies" className="ghost">Back to the book</Link>.
        </StateNote>
      </main>
    );
  }

  /* THE HEADLINE VERDICT IS GATED ON THE SAME TEST AS THE SETTLEMENT PANEL.
   *
   * The contract never clears p.outcome when a round ends without paying, so
   * the moment a newer claim is filed the field still holds the PREVIOUS
   * round's answer until promote() overwrites it. The settlement tab already
   * refuses to speak in that gap; the headline must too, and it matters more
   * here because this is the largest text on the page — announcing "trigger
   * met" over a panel that is at this moment still reading would be the worst
   * thing this page could say. Versions cannot go stale, so they are the
   * test. */
  const outcomeIsCurrent = Number(p.evidence_version) <= Number(p.judged_version);
  const out = outcomeIsCurrent
    ? outcomeWords(p.outcome)
    : { state: "draft", label: "under investigation" };
  const publishers = (p.basis ?? []).filter((b) => b.class === "INDEPENDENT");
  const parties = (p.basis ?? []).filter((b) => b.class === "PARTY");

  return (
    <main className="page detail">
      {/* the fact header: the trigger large, the determination beside it */}
      <header className="detail-head">
        <div style={{ minWidth: 0 }}>
          <Link href="/policies" className="eyebrow" style={{ display: "inline-block", marginBottom: 12 }}>
            ← the policy book
          </Link>
          <h1 className="detail-trigger">{triggerSentence(p)}</h1>
          <p className="detail-sub">
            {p.title} · {p.region}, {p.country}
          </p>
        </div>
        <div className="detail-verdict">
          {/* the outcome, said once. UNDETERMINED is a peer of the other two. */}
          <span className="verdict">
            <Dot state={out.state} />
            {out.label}
          </span>
          <div className="pair">
            <span className="pair-label">Coverage</span>
            <span className="pair-value lg">
              {formatGen(p.coverage_atto)}
              <span className="unit">GEN</span>
            </span>
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Policy record">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={t === tab ? "tab on" : "tab"}
            onClick={() => setTab(t)}
            aria-pressed={t === tab}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Trigger" && (
        <section className="grid two">
          <div className="card">
            <div className="card-head">
              <span className="card-title">Terms</span>
            </div>
            <div className="pairs">
              <div className="pair">
                <span className="pair-label">Premium</span>
                <span className="pair-value lg">
                  {formatGen(p.premium_atto)}
                  <span className="unit">GEN</span>
                </span>
                <span className="pair-note">the insurer&apos;s from activation</span>
              </div>
              <div className="pair">
                <span className="pair-label">Measured over</span>
                <span className="pair-value lg">{windowWords(p.measurement_hours)}</span>
                <span className="pair-note">any such window inside the claim</span>
              </div>
              <div className="pair wide">
                <span className="pair-label">Period</span>
                <span className="pair-value">
                  {formatDate(p.coverage_start_epoch)} — {formatDate(p.coverage_end_epoch)}
                </span>
                <span className="pair-note">
                  claims for {formatSpan(p.claim_grace)} after it ends
                </span>
              </div>
              <div className="pair wide">
                <span className="pair-label">Insured area</span>
                {/* drawn, not spelled: the coordinates behind the plot are in the fold */}
                <div className="area">
                  <span className="area-chip">{placeWords(p)}</span>
                </div>
              </div>
            </div>
            <Technical
              summary="Coordinates and windows"
              rows={[
                [
                  "centre",
                  `${(p.lat_e6 / 1e6).toFixed(4)}, ${(p.lon_e6 / 1e6).toFixed(4)}`,
                ],
                ["radius", `${p.radius_km} km`],
                ["coverage start", String(p.coverage_start_epoch)],
                ["coverage end", String(p.coverage_end_epoch)],
                ["measurement window", `${p.measurement_hours} h`],
                ["claim grace", formatSpan(p.claim_grace)],
              ]}
            />
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">Evidence origins</span>
              <span className="eyebrow">frozen at signing</span>
            </div>
            <div className="basislist">
              {(p.basis ?? []).map((b, i) => (
                <div className="basisrow" key={`${b.origin}-${i}`}>
                  <span className="basis-what">{kindWords(b.kind)}</span>
                  <span className="chip">{classWords(b.class)}</span>
                </div>
              ))}
            </div>
            {/* the page's one sentence. It carries two facts nothing else can:
                the origin list is closed, and kind and class are AGREED labels
                the panel tests rather than facts the app vouches for. */}
            <p className="body-sm muted" style={{ marginTop: 24 }}>
              These origins and no others, under the kinds and classes both parties agreed.
            </p>
            <div className="pairs two" style={{ marginTop: 28 }}>
              <div className="pair">
                <span className="pair-label">Publishers required</span>
                <span className="count">
                  <span className="big-figure">{p.min_independent}</span>
                  <span className="of">of {publishers.length}</span>
                </span>
                <span className="pair-note">one voice per publisher, counted and never averaged</span>
              </div>
              {parties.length > 0 ? (
                <div className="pair">
                  <span className="pair-label">Party sources</span>
                  <span className="pair-value lg">{parties.length}</span>
                  <span className="pair-note">informs, never counts</span>
                </div>
              ) : null}
            </div>
            {p.terms_text ? (
              <details className="technical">
                <summary>Read the policy text</summary>
                <p className="body-sm" style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>
                  {p.terms_text}
                </p>
              </details>
            ) : null}
            <Technical
              rows={[
                ...(p.basis ?? []).map(
                  (b, i) =>
                    [
                      `origin ${i + 1} · ${kindWords(b.kind).toLowerCase()}`,
                      <Ident key={`${b.origin}-${i}`} value={b.origin} />,
                    ] as [string, React.ReactNode],
                ),
                ["policy", <Ident key="i" value={p.policy_id} />],
                ["commitment", <Ident key="h" value={p.terms_sha256} label="Copy hash" />],
                ["insurer", <Ident key="a" value={p.insurer} />],
                ["policyholder", p.policyholder ? <Ident key="b" value={p.policyholder} /> : "—"],
                [
                  "contract",
                  <a key="c" href={explorerAddress(p.policy_id)} target="_blank" rel="noreferrer">
                    explorer
                  </a>,
                ],
              ]}
            />
          </div>
        </section>
      )}

      {tab === "Evidence" && (
        <section>
          {version === 0 ? (
            <div className="empty">No claim filed on this policy.</div>
          ) : !pkg ? (
            <div className="empty">Reading the claim…</div>
          ) : (
            <div className="card">
              <div className="card-head">
                <span className="card-title">Claim, version {pkg.version}</span>
                <span className="eyebrow">
                  filed by the {pkg.filed_by.replace(/^appellant:/, "appellant, ")}
                </span>
              </div>
              <div className="pairs three">
                <div className="pair">
                  <span className="pair-label">Event window</span>
                  <span className="pair-value">
                    {formatDate(pkg.event_start_epoch)} — {formatDate(pkg.event_end_epoch)}
                  </span>
                </div>
                <div className="pair">
                  <span className="pair-label">Claimed reading</span>
                  <span className="pair-value lg">
                    {pkg.claimed_reading}
                    <span className="unit">{p.unit}</span>
                  </span>
                  {/* the claim is never treated as a reading; the label says so */}
                  <span className="pair-note">a claim, never a reading</span>
                </div>
                <div className="pair">
                  <span className="pair-label">Sources named</span>
                  <span className="pair-value lg">{pkg.rows.length}</span>
                </div>
              </div>
              <div className="basislist" style={{ marginTop: 28 }}>
                {pkg.rows.map((r) => (
                  <div className="basisrow" key={r.id}>
                    <span className="basis-what">{r.label}</span>
                    <span className="chip">{kindWords(r.kind)}</span>
                    <span className="chip">{classWords(r.cls)}</span>
                  </div>
                ))}
              </div>
              <Technical
                rows={[
                  ...pkg.rows.map(
                    (r, i) =>
                      [
                        `${i + 1}. ${r.label}`,
                        <a
                          key={r.id}
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mono"
                          style={{ color: "var(--iris)" }}
                        >
                          {r.url}
                        </a>,
                      ] as [string, React.ReactNode],
                  ),
                  ["package root", <Ident key="root" value={pkg.root} label="Copy root" />] as [
                    string,
                    React.ReactNode,
                  ],
                ]}
              />
            </div>
          )}
        </section>
      )}

      {tab === "Determination" && (
        <section className="stack loose">
          {!decision ? (
            <div className="empty">No determination recorded yet.</div>
          ) : (
            <>
              <div className="card lifted">
                <div className="card-head">
                  <span className="card-title">
                    {decision.round_kind === "RE_INVESTIGATION"
                      ? `Re-investigation of round ${decision.reconsidered_round}`
                      : "Investigation"}
                  </span>
                  <span className="eyebrow">version {decision.evidence_version}</span>
                </div>
                <div className="stack">
                  <span className="verdict">
                    <Dot state={outcomeWords(decision.outcome).state} />
                    {outcomeWords(decision.outcome).label}
                  </span>
                  <div className="pairs three">
                    <div className="pair">
                      <span className="pair-label">Publishers past the threshold</span>
                      <span className="count">
                        <span className="big-figure">{decision.qualifying}</span>
                        <span className="of">of {decision.publishers}</span>
                      </span>
                      {/* a count of publishers, never a mean of readings */}
                      <span className="pair-note">counted, never averaged</span>
                    </div>
                    <div className="pair">
                      <span className="pair-label">Short of it</span>
                      <span className="pair-value lg">{decision.contradicting}</span>
                    </div>
                    <div className="pair">
                      <span className="pair-label">Threshold</span>
                      <span className="pair-value lg">
                        {decision.threshold}
                        <span className="unit">{decision.unit}</span>
                      </span>
                    </div>
                  </div>
                  {decision.hold_reason ? (
                    <div className="tile">
                      <span className="pair-label">On hold</span>
                      <div className="pair-value sm" style={{ marginTop: 10 }}>
                        {HOLD_WORDS[decision.hold_reason] ?? decision.hold_reason}
                      </div>
                    </div>
                  ) : null}
                  {/* The contract bakes the machine values into this string:
                      "within 50 km of latitude 11.5, longitude 125.5" and
                      "between epoch 1788819222 and epoch 1788834227". Printed
                      verbatim it put coordinates and epochs back on the face,
                      which is the one thing this pass exists to stop. The
                      question is asked here in the reader's terms; the
                      contract's exact words stay one fold away, because they
                      are what the panel actually received. */}
                  <div className="tile quiet">
                    <span className="pair-label">The question the panel answered</span>
                    <div className="pair-value sm" style={{ marginTop: 10 }}>
                      Did {triggerSentence(p)} occur in {placeWords(p)} over the claimed
                      window?
                    </div>
                    <Technical
                      summary="The question as the contract stored it"
                      rows={[["question", decision.question]]}
                    />
                  </div>
                </div>
              </div>

              {/* the evidence explorer: every reading against the threshold */}
              <div className="card">
                <div className="card-head">
                  <span className="card-title">Every source, read</span>
                  <span className="eyebrow">one voice each, at its least favourable page</span>
                </div>
                <div className="tablewrap">
                  <table className="rows">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th className="num">Reading</th>
                        <th>Against {decision.threshold} {decision.unit}</th>
                        <th>Provenance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decision.rows.map((r) => {
                        const usable =
                          r.cls === "INDEPENDENT" && r.readable && r.window_ok && r.geo_ok &&
                          r.kind_matches && r.reading !== null;
                        const meets =
                          usable && r.reading !== null
                            ? decision.operator === "GTE" ? r.reading >= decision.threshold
                              : decision.operator === "GT" ? r.reading > decision.threshold
                              : decision.operator === "LTE" ? r.reading <= decision.threshold
                              : r.reading < decision.threshold
                            : false;
                        return (
                          <tr key={r.id}>
                            <td>
                              {r.label}
                              <div className="caption muted">{classWords(r.cls).toLowerCase()}</div>
                            </td>
                            <td className="num">
                              {r.reading === null ? (
                                <span className="faint">no reading</span>
                              ) : (
                                `${r.reading} ${decision.unit}`
                              )}
                            </td>
                            <td>
                              {!usable ? (
                                <span className="muted body-sm">
                                  {!r.readable
                                    ? "unreachable"
                                    : r.cls !== "INDEPENDENT"
                                      ? "informs only"
                                      : !r.kind_matches
                                        ? "not what its label says"
                                        : !r.geo_ok
                                          ? "wrong place"
                                          : !r.window_ok
                                            ? "wrong window"
                                            : "states no reading"}
                                </span>
                              ) : (
                                <Status
                                  state={meets ? "qualifying" : "contradicting"}
                                  label={meets ? "meets it" : "short of it"}
                                />
                              )}
                            </td>
                            <td>
                              {/* RECORDED was compared verbatim by every validator;
                                  FETCHED is the leader's record, digest-sealed but
                                  not corroborated. One word here, the whole
                                  distinction in the fold below. */}
                              {r.basis === "RECORDED" ? (
                                <span
                                  className="tag recorded"
                                  title="compared verbatim by every validator"
                                >
                                  recorded · round {r.basis_round}
                                </span>
                              ) : r.basis === "NEW" ? (
                                <span className="tag" title="added by the appellant this round">
                                  new
                                </span>
                              ) : (
                                <span
                                  className="tag fetched"
                                  title="the leader's record, digest-sealed but not corroborated"
                                >
                                  fetched
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {decision.conflicts.length > 0 && (
                  <div className="tile" style={{ marginTop: 28 }}>
                    <span className="pair-label">Also noted</span>
                    <div className="pair-value sm" style={{ marginTop: 10 }}>
                      {decision.conflicts.map((c) => CONFLICT_WORDS[c] ?? c.toLowerCase()).join("; ")}
                    </div>
                  </div>
                )}

                <blockquote className="reason" style={{ marginTop: 28 }}>
                  {decision.reason}
                </blockquote>

                <Technical
                  rows={[
                    ["recorded", "compared verbatim by every validator"],
                    ["fetched", "the leader's record, digest-sealed, not corroborated"],
                    ["determination", <Ident key="d" value={decision.decision_id} />],
                    ["evidence root", <Ident key="r" value={decision.evidence_root} label="Copy root" />],
                    ["observed", formatDate(decision.observed_epoch)],
                    ["sufficiency", decision.evidence_flag.toLowerCase()],
                    ["confidence", `${decision.score} of 100`],
                    /* the publisher behind each source, and the digest every
                       validator matched on. Both are machine values: they are
                       reachable here and nowhere on the face. */
                    ...decision.rows.map(
                      (r, i) =>
                        [`${i + 1}. ${r.label}`, <Ident key={r.id} value={r.origin} />] as [
                          string,
                          React.ReactNode,
                        ],
                    ),
                    ...decision.rows.map(
                      (r, i) =>
                        [
                          `${i + 1}. digest`,
                          <Ident key={`${r.id}-digest`} value={r.digest} label="Copy digest" />,
                        ] as [string, React.ReactNode],
                    ),
                  ]}
                />
              </div>
            </>
          )}
        </section>
      )}

      {tab === "Settlement" && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">Settlement</span>
            <span className="eyebrow">{p.status.toLowerCase().replace(/_/g, " ")}</span>
          </div>
          <div className="stack">
            {p.status === "PAID" ? (
              <div className="pair">
                <span className="pair-label">Paid to the policyholder</span>
                <span className="pair-value lg">
                  {formatGen(p.payout_atto)}
                  <span className="unit">GEN</span>
                </span>
                <span className="pair-note">the whole coverage, claimable by them alone</span>
              </div>
            ) : p.status === "EXPIRED" ? (
              <div className="pair">
                <span className="pair-label">Returned to the insurer</span>
                <span className="pair-value lg">
                  {formatGen(p.refund_atto)}
                  <span className="unit">GEN</span>
                </span>
                <span className="pair-note">
                  the period and its grace passed with no trigger verified
                </span>
              </div>
            ) : Number(p.evidence_version) > Number(p.judged_version) ? (
              /* A recorded outcome is only the CURRENT word while no newer claim
                 is waiting on a panel. The contract never clears p.outcome when
                 a round ends without paying: promote() on UNDETERMINED sets
                 status back to ACTIVE and leaves the outcome standing, and
                 settle() on NOT_SATISFIED does the same. So once a fresh claim
                 is filed, the fields below still hold the PREVIOUS round's
                 verdict until the new one is promoted — and this panel would
                 have announced "the trigger was not met" over a live
                 investigation. Gate on the versions, which cannot go stale. */
              <>
                <div className="gate stale">
                  A newer claim is on the record and has not been determined yet, so nothing here
                  is settled.
                </div>
                <div className="pair">
                  <span className="pair-label">Locked while the panel reads</span>
                  <span className="pair-value lg">
                    {formatGen(p.coverage_atto)}
                    <span className="unit">GEN</span>
                  </span>
                </div>
              </>
            ) : p.outcome === "SATISFIED" ? (
              <div className="pair">
                <span className="pair-label">Moves to the policyholder</span>
                <span className="pair-value lg">
                  {formatGen(p.coverage_atto)}
                  <span className="unit">GEN</span>
                </span>
                <span className="pair-note">
                  the whole coverage, once the {formatSpan(p.appeal_window)} appeal window closes
                </span>
              </div>
            ) : p.outcome === "NOT_SATISFIED" ? (
              <div className="pair">
                <span className="pair-label">Trigger not met</span>
                <span className="pair-value lg">Nothing moves</span>
                <span className="pair-note">
                  coverage locked, the policy live for the rest of its period
                </span>
              </div>
            ) : p.outcome === "UNDETERMINED" ? (
              <div className="pair">
                <span className="pair-label">Record on hold</span>
                <span className="pair-value lg">Nothing moves</span>
                <span className="pair-note">
                  a better claim inside the {formatSpan(p.claim_grace)} grace; after it, the
                  insurer&apos;s reclaim
                </span>
              </div>
            ) : (
              <div className="pair">
                <span className="pair-label">Locked against this policy</span>
                <span className="pair-value lg">
                  {formatGen(p.coverage_atto)}
                  <span className="unit">GEN</span>
                </span>
                <span className="pair-note">
                  leaves only through a finalized trigger or the expiry reclaim
                </span>
              </div>
            )}
            {/* the boundaries above are display; the contract's own clock decides */}
            <p className="caption muted">
              Windows run on the consensus clock the contract fetches itself, so the boundaries
              shown here may be minutes off.
            </p>
            <Technical
              rows={[
                ["appeal bond", `${formatGen(p.appeal_bond_atto)} GEN`],
                ["finality window", formatSpan(p.finality_window)],
                ["appeal window", formatSpan(p.appeal_window)],
                ["claim grace", formatSpan(p.claim_grace)],
                ["payout", `${formatGen(p.payout_atto)} GEN`],
                ["refund", `${formatGen(p.refund_atto)} GEN`],
              ]}
            />
          </div>
        </section>
      )}

      {/* The path itself, under the record it acts on: every write the
          contract exposes, filtered to what this wallet can do to this policy
          right now. `.page.detail > * + *` spaces it like any other section. */}
      <Actions policy={p} onLanded={again} />
    </main>
  );
}
