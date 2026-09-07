"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { formatDate, formatGen, formatSpan } from "../../../lib/config";
import {
  getDecision,
  getPackage,
  getPolicy,
  type ClaimPackage,
  type Decision,
  type Policy,
} from "../../../lib/read";
import { Ident, StateNote, Status, Technical } from "../../components/bits";
import { triggerSentence } from "../../components/PolicyRow";
import { explorerAddress } from "../../components/Shell";

type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "down"; why: string };

const TABS = ["Trigger", "Evidence", "Determination", "Settlement"] as const;
type Tab = (typeof TABS)[number];

const KIND_WORDS: Record<string, string> = {
  METEOROLOGICAL_AGENCY: "meteorological agency",
  WEATHER_PROVIDER: "weather provider",
  SEISMIC_NETWORK: "seismic network",
  SATELLITE_OBSERVATION: "satellite observation",
  GOVERNMENT_RECORD: "government record",
  NEWS_REPORT: "news report",
  STATION_LOG: "station log",
  OTHER: "other",
};

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

export default function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [policy, setPolicy] = useState<Load<Policy | null>>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("Trigger");
  const [pkg, setPkg] = useState<ClaimPackage | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  useEffect(() => {
    let live = true;
    getPolicy(id)
      .then((p) => live && setPolicy({ state: "ok", data: p }))
      .catch((e) => live && setPolicy({ state: "down", why: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, [id]);

  const p = policy.state === "ok" ? policy.data : null;
  const version = p?.evidence_version ?? 0;
  const judged = p?.judged_version || p?.pending_version || 0;

  useEffect(() => {
    if (!p || version === 0) return;
    let live = true;
    getPackage(id, version).then((v) => live && setPkg(v)).catch(() => {});
    if (judged > 0) {
      getDecision(id, judged).then((v) => live && setDecision(v)).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [id, p, version, judged]);

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
          <Link href="/" className="ghost">Back to the book</Link>.
        </StateNote>
      </main>
    );
  }

  const out = outcomeWords(p.outcome);
  const publishers = (p.basis ?? []).filter((b) => b.class === "INDEPENDENT");
  const parties = (p.basis ?? []).filter((b) => b.class === "PARTY");

  return (
    <main className="page detail">
      {/* the fact header: the trigger large, the determination beside it */}
      <header className="detail-head">
        <div style={{ minWidth: 0 }}>
          <Link href="/" className="eyebrow" style={{ display: "inline-block", marginBottom: 12 }}>
            ← the policy book
          </Link>
          <h1 className="detail-trigger">{triggerSentence(p)}</h1>
          <p className="detail-sub">
            {p.title} · {p.region}, {p.country} · measured over{" "}
            {p.measurement_hours} hours
          </p>
        </div>
        <div className="detail-verdict">
          <Status state={out.state} label={out.label} />
          <div className="detail-coverage">
            <span className="figure">{formatGen(p.coverage_atto)}</span>
            <span className="muted"> GEN coverage</span>
          </div>
          <div className="caption muted">
            {p.min_independent} of {publishers.length} publishers must agree
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
            <span className="eyebrow">What pays</span>
            <dl className="factlist">
              <div>
                <dt>The condition</dt>
                <dd>{triggerSentence(p)}, over any {p.measurement_hours}-hour window inside the claimed event window.</dd>
              </div>
              <div>
                <dt>The insured area</dt>
                <dd>
                  {p.region}, {p.country}
                  {p.radius_km > 0
                    ? `, within ${p.radius_km} km of ${(p.lat_e6 / 1e6).toFixed(4)}, ${(p.lon_e6 / 1e6).toFixed(4)}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>The period</dt>
                <dd>
                  {formatDate(p.coverage_start_epoch)} to {formatDate(p.coverage_end_epoch)}. A claim
                  may be filed for {formatSpan(p.claim_grace)} after it ends; then the insurer may
                  reclaim the coverage.
                </dd>
              </div>
              <div>
                <dt>The money</dt>
                <dd>
                  {formatGen(p.coverage_atto)} GEN coverage against a {formatGen(p.premium_atto)} GEN
                  premium. A trigger met pays the whole coverage; the premium is the insurer&apos;s
                  the moment the policy is activated.
                </dd>
              </div>
            </dl>
          </div>

          <div className="card">
            <span className="eyebrow">Where evidence may come from</span>
            <p className="body-sm muted" style={{ marginTop: 12 }}>
              Frozen when the policy was written and signed by the premium. The panel reads these
              origins and no others. Kinds and classes are labels both parties agreed; the panel is
              told so, and judges each page as what it shows itself to be.
            </p>
            <div className="basislist">
              {(p.basis ?? []).map((b) => (
                <div className="basisrow" key={b.origin}>
                  <span className="ident">{b.origin}</span>
                  <span className="caption muted">{KIND_WORDS[b.kind] ?? b.kind.toLowerCase()}</span>
                  <span className="caption" style={{ color: b.class === "INDEPENDENT" ? "var(--bone)" : "var(--ash)" }}>
                    {b.class === "INDEPENDENT" ? "independent" : "a party's own"}
                  </span>
                </div>
              ))}
            </div>
            <p className="caption muted" style={{ marginTop: 16 }}>
              {publishers.length} independent {publishers.length === 1 ? "publisher" : "publishers"}
              {parties.length > 0 ? `, ${parties.length} party source` : ""}. Two pages on one
              publisher are one voice.
            </p>
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
        <section className="card">
          {version === 0 ? (
            <StateNote kind="empty">
              No claim has been filed on this policy. Evidence appears here when the policyholder
              names an event window and the pages to read.
            </StateNote>
          ) : !pkg ? (
            <StateNote kind="loading">Reading the claim…</StateNote>
          ) : (
            <>
              <span className="eyebrow">
                Claim, version {pkg.version} · filed by the {pkg.filed_by.replace(/^appellant:/, "appellant, ")}
              </span>
              <p className="body" style={{ marginTop: 12 }}>
                The event window ran {formatDate(pkg.event_start_epoch)} to{" "}
                {formatDate(pkg.event_end_epoch)}. The policyholder claims{" "}
                <span className="figure">{pkg.claimed_reading}</span> {p.unit} — a claim, which the
                panel never treats as a reading.
              </p>
              <div className="tablewrap" style={{ marginTop: 24 }}>
                <table className="rows">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Publisher</th>
                      <th>Agreed kind</th>
                      <th>Class</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkg.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.label}</td>
                        <td>
                          <span className="ident">{r.domain}</span>
                        </td>
                        <td className="body-sm muted">{KIND_WORDS[r.kind] ?? r.kind.toLowerCase()}</td>
                        <td className="body-sm">
                          {r.cls === "INDEPENDENT" ? "independent" : "a party's own"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Technical
                rows={[
                  ...pkg.rows.map(
                    (r) =>
                      [
                        r.id,
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
            </>
          )}
        </section>
      )}

      {tab === "Determination" && (
        <section>
          {!decision ? (
            <StateNote kind="empty">
              No determination has been recorded yet. When anyone runs the investigation, every
              validator fetches each source itself and the record appears here.
            </StateNote>
          ) : (
            <div style={{ display: "grid", gap: 24 }}>
              <div className="window">
                <div className="window-bar">
                  <i className="window-dot" style={{ background: "var(--iris)" }} />
                  <span className="eyebrow">
                    {decision.round_kind === "RE_INVESTIGATION"
                      ? `Re-investigation, reconsidering round ${decision.reconsidered_round}`
                      : "Investigation"}{" "}
                    · version {decision.evidence_version}
                  </span>
                </div>
                <div className="window-body">
                  <div style={{ fontFamily: "var(--sans)", fontSize: 15, marginBottom: 16 }}>
                    {decision.question}
                  </div>
                  <div className="determination">
                    <Status state={outcomeWords(decision.outcome).state} label={outcomeWords(decision.outcome).label} />
                    <span className="muted">
                      {decision.qualifying} of {decision.publishers} publishers read past the
                      threshold, {decision.contradicting} short of it
                    </span>
                  </div>
                  {decision.hold_reason ? (
                    <p style={{ fontFamily: "var(--sans)", marginTop: 12, color: "var(--bone)" }}>
                      {HOLD_WORDS[decision.hold_reason] ?? decision.hold_reason}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* the evidence explorer: every reading against the threshold */}
              <div className="card">
                <span className="eyebrow">Why the record reads as it does</span>
                <p className="body-sm muted" style={{ marginTop: 12 }}>
                  Each publisher speaks once, at its least trigger-favourable page. The readings are
                  never averaged: the determination is a count of publishers, not a mean.
                </p>
                <div className="tablewrap" style={{ marginTop: 24 }}>
                  <table className="rows">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Publisher</th>
                        <th className="num">Reading</th>
                        <th>Against {decision.threshold} {decision.unit}</th>
                        <th>Read</th>
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
                              <div className="caption muted">
                                {r.basis === "RECORDED"
                                  ? `recorded at round ${r.basis_round}, re-read`
                                  : r.basis === "NEW"
                                    ? "added by the appellant"
                                    : "fetched this round"}
                              </div>
                            </td>
                            <td>
                              <span className="ident">{r.domain}</span>
                              <div className="caption muted">
                                {r.cls === "INDEPENDENT" ? "independent" : "a party's own"}
                              </div>
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
                            <td className="body-sm muted">{r.readable ? "read" : "unreachable"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {decision.conflicts.length > 0 && (
                  <p className="body-sm" style={{ marginTop: 20 }}>
                    The panel also noted:{" "}
                    {decision.conflicts.map((c) => CONFLICT_WORDS[c] ?? c.toLowerCase()).join("; ")}.
                  </p>
                )}

                <blockquote className="reason" style={{ marginTop: 24 }}>
                  {decision.reason}
                </blockquote>

                <Technical
                  rows={[
                    ["determination", <Ident key="d" value={decision.decision_id} />],
                    ["evidence root", <Ident key="r" value={decision.evidence_root} label="Copy root" />],
                    ["observed", formatDate(decision.observed_epoch)],
                    ["sufficiency", decision.evidence_flag.toLowerCase()],
                    ["confidence", `${decision.score} of 100`],
                    ...decision.rows.map(
                      (r) => [`${r.id} digest`, <Ident key={r.id} value={r.digest} label="Copy digest" />] as [string, React.ReactNode],
                    ),
                  ]}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {tab === "Settlement" && (
        <section className="card">
          <span className="eyebrow">What moves, and when</span>
          {p.status === "PAID" ? (
            <p className="body" style={{ marginTop: 16 }}>
              The trigger was met and the policy paid{" "}
              <span className="figure">{formatGen(p.payout_atto)} GEN</span> — the whole coverage —
              to the policyholder&apos;s ledger, claimable by them alone.
            </p>
          ) : p.status === "EXPIRED" ? (
            <p className="body" style={{ marginTop: 16 }}>
              The coverage period and its claim grace passed without a trigger being verified, so{" "}
              <span className="figure">{formatGen(p.refund_atto)} GEN</span> returned to the
              insurer. A trigger nobody could verify is not paid, and the money is not stranded.
            </p>
          ) : p.outcome === "SATISFIED" ? (
            <p className="body" style={{ marginTop: 16 }}>
              The trigger is met. After the appeal window closes, anyone may settle and the whole{" "}
              <span className="figure">{formatGen(p.coverage_atto)} GEN</span> coverage moves to the
              policyholder.
            </p>
          ) : p.outcome === "NOT_SATISFIED" ? (
            <p className="body" style={{ marginTop: 16 }}>
              The trigger was not met. Nothing moves: the coverage stays locked and the policy stays
              live for the rest of its period.
            </p>
          ) : p.outcome === "UNDETERMINED" ? (
            <p className="body" style={{ marginTop: 16 }}>
              The record is on hold, so nothing moves. The policyholder may file a better claim
              inside the grace; after it, the insurer may reclaim the coverage.
            </p>
          ) : (
            <p className="body" style={{ marginTop: 16 }}>
              Nothing has settled. The coverage of{" "}
              <span className="figure">{formatGen(p.coverage_atto)} GEN</span> is locked against
              this policy and can leave only through a finalized trigger or the expiry reclaim.
            </p>
          )}
          <p className="caption muted" style={{ marginTop: 24 }}>
            Every window is wall-clock, read from a consensus clock the contract fetches itself.
            The boundaries shown here may be a few minutes off; the contract&apos;s own clock decides.
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
        </section>
      )}
    </main>
  );
}
