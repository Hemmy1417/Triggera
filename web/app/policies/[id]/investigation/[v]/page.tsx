"use client";

/**
 * THE INVESTIGATION — one round of the panel, whole.
 *
 * This is the page where GenLayer is visibly doing the work: a question was
 * put to a panel, every validator fetched the named pages itself, each one
 * reported what its page said, and deterministic code counted the publishers
 * and derived an outcome nobody chose. The page is ordered so it can be read
 * top to bottom as that sequence — the question, the determination drawn, the
 * round in stages, then every source the count was made of, then the panel's
 * own words.
 *
 * Two rules the rest of the app also keeps, and this page keeps hardest:
 *
 *   THE PROSE HAS NO MACHINE VALUES IN IT. No enum spelling, no null, no
 *   hash, no epoch integer. A reading is "states 157 km/h"; a check is
 *   "outside the insured area"; a missing figure is "states no usable
 *   reading". Urls, digests and fetch epochs live in the technical folds,
 *   which is what they are for.
 *
 *   THE PICTURE IS A COUNT, NOT AN AVERAGE. ThresholdScale places one node
 *   per source against the agreed threshold. Independent readings are marked
 *   past or short of it, a party's own source is hollow because it never
 *   counts, and a source the round could not use is neither — the same
 *   arithmetic the contract runs, drawn rather than described.
 *
 * A version that was never judged is the state most readers will meet first,
 * because a policy with no claim filed has no rounds at all. It says exactly
 * that, shows the claim if one was filed, and links back — it does not render
 * an empty investigation.
 */

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { formatSpan, formatStamp, formatWhen } from "../../../../../lib/config";
import {
  getDecision,
  getPackage,
  getPolicy,
  type ClaimPackage,
  type Decision,
  type DecisionRow,
  type Policy,
} from "../../../../../lib/read";
import { useNow } from "../../../../../lib/useNow";
import { Ident, StateNote, Status, Technical } from "../../../../components/bits";
import { triggerSentence } from "../../../../components/PolicyRow";
import { InsuredArea, ThresholdScale, type ScaleNode } from "../../../../components/ThresholdScale";

type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "down"; why: string };

type Record3 = { policy: Policy | null; decision: Decision | null; pkg: ClaimPackage | null };

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

/** The comparison the contract makes, in the same four cases. */
function meetsThreshold(operator: string, reading: number, threshold: number): boolean {
  if (operator === "GTE") return reading >= threshold;
  if (operator === "GT") return reading > threshold;
  if (operator === "LTE") return reading <= threshold;
  return reading < threshold;
}

/**
 * A source the round could count: readable this round, for the right window
 * and the right place, and what its agreed label says. Class is NOT part of
 * this — a party's own source can be perfectly usable and still never count —
 * so the two tests are kept apart wherever they are asked.
 */
function usable(r: DecisionRow): boolean {
  return r.readable && r.window_ok && r.geo_ok && r.kind_matches;
}

/**
 * `get_decision` and `get_package` answer "" for a version that holds
 * nothing, which arrives here as a falsy value the declared `Decision | null`
 * does not describe. Anything without the field the page reads is treated as
 * absent rather than rendered as a record of empty fields.
 */
function asDecision(v: Decision | null): Decision | null {
  return v && Array.isArray(v.rows) ? v : null;
}
function asPackage(v: ClaimPackage | null): ClaimPackage | null {
  return v && Array.isArray(v.rows) ? v : null;
}

export default function InvestigationPage({
  params,
}: {
  params: Promise<{ id: string; v: string }>;
}) {
  const { id, v } = use(params);
  const ver = Number(v);
  const [rec, setRec] = useState<Load<Record3>>({ state: "loading" });
  const now = useNow();

  useEffect(() => {
    let live = true;
    /* A version that is not a counting number is answered without asking the
       contract for it — but the policy is still read, so the page can name
       what the reader was looking at while it says the version does not
       exist. */
    const asked = Number.isInteger(ver) && ver >= 1;
    /* One gate for all three reads: a page that renders the policy while the
       decision read is still in flight would show "never judged" for a round
       that exists, which is the one wrong answer this page can give. */
    Promise.all([
      getPolicy(id),
      asked ? getDecision(id, ver) : Promise.resolve(null),
      asked ? getPackage(id, ver) : Promise.resolve(null),
    ])
      .then(([policy, decision, pkg]) => {
        if (!live) return;
        setRec({
          state: "ok",
          data: { policy: policy || null, decision: asDecision(decision), pkg: asPackage(pkg) },
        });
      })
      .catch((e) => live && setRec({ state: "down", why: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, [id, ver]);

  const data = rec.state === "ok" ? rec.data : null;
  const p = data?.policy ?? null;
  const decision = data?.decision ?? null;

  /* One node per source, placed at its reading. Class and usability decide
     the node's kind; nothing here averages, weights or ranks anything. */
  const nodes = useMemo<ScaleNode[]>(() => {
    if (!decision) return [];
    return decision.rows.map((r) => {
      const counted = r.cls === "INDEPENDENT" && usable(r) && r.reading !== null;
      const meets =
        counted && r.reading !== null
          ? meetsThreshold(decision.operator, r.reading, decision.threshold)
          : false;
      return {
        publisher: r.domain,
        reading: r.reading,
        party: r.cls === "PARTY",
        qualifying: counted && meets,
        contradicting: counted && !meets,
      };
    });
  }, [decision]);

  if (rec.state === "loading") {
    return (
      <main className="page">
        <StateNote kind="loading">Reading the investigation from the contract…</StateNote>
      </main>
    );
  }
  if (rec.state === "down") {
    return (
      <main className="page">
        <StateNote kind="unreachable">
          This round could not be read. This is the network between you and the contract,
          not the record itself.{" "}
          <Link href={`/policies/${id}`} className="ghost">
            Back to the policy
          </Link>
          .
        </StateNote>
      </main>
    );
  }
  if (!p) {
    return (
      <main className="page">
        <StateNote kind="empty">
          No policy with this identifier exists on the contract.{" "}
          <Link href="/policies" className="ghost">
            Back to the policy book
          </Link>
          .
        </StateNote>
      </main>
    );
  }

  const versions = Array.from({ length: Math.max(0, p.evidence_version) }, (_, i) => i + 1);
  const rounds =
    versions.length === 0 ? null : (
      <nav className="tabs" aria-label="Rounds of this policy">
        <span className="control-label" style={{ marginRight: 8 }}>
          Rounds
        </span>
        {versions.map((n) => (
          <Link
            key={n}
            href={`/policies/${id}/investigation/${n}`}
            className={n === ver ? "tab on" : "tab"}
            aria-current={n === ver ? "page" : undefined}
          >
            {n === ver ? `Version ${n}, shown` : `Version ${n}`}
          </Link>
        ))}
        <Link href={`/policies/${id}`} className="tab" style={{ marginLeft: "auto" }}>
          The policy
        </Link>
      </nav>
    );

  const head = (
    <header>
      <Link
        href={`/policies/${id}`}
        className="eyebrow"
        style={{ display: "inline-block", marginBottom: "var(--gap-tight)" }}
      >
        ← {p.title}
      </Link>
      <h1 className="heading-sm">
        {decision
          ? decision.round_kind === "RE_INVESTIGATION"
            ? `Re-investigation, reconsidering round ${decision.reconsidered_round}`
            : `Investigation of claim version ${decision.evidence_version}`
          : `Claim version ${Number.isInteger(ver) && ver >= 1 ? ver : v}`}
      </h1>
      <p className="detail-sub">
        {triggerSentence(p)} · {p.region}, {p.country}
        {decision ? <> · observed {formatWhen(decision.observed_epoch, now)}</> : null}
      </p>
    </header>
  );

  /* ── the version was never judged ──────────────────────────────────────
     The state a reader meets on any policy whose claim has not been read
     yet, so it says what is missing, what would be here, and what the record
     DOES hold at this version. */
  if (!decision) {
    const pkg = data?.pkg ?? null;
    const missing =
      !Number.isInteger(ver) || ver < 1
        ? `There is no version “${v}” of this policy's evidence: versions are counted from one.`
        : p.evidence_version === 0
          ? "No claim has been filed on this policy, so no version of its evidence exists and no panel has been asked anything."
          : ver > p.evidence_version
            ? `This policy's evidence reaches version ${p.evidence_version}. Version ${ver} has not been filed.`
            : `No investigation was recorded at version ${ver} of this policy's evidence. The claim exists; no panel has read it.`;

    return (
      <main className="page">
        {head}

        <StateNote kind="empty">
          {missing}{" "}
          <Link href={`/policies/${id}`} className="ghost">
            Back to the policy
          </Link>
          .
        </StateNote>

        <section>
          <span className="eyebrow">What appears here when the round runs</span>
          <p className="body muted measure" style={{ marginTop: "var(--gap-tight)" }}>
            Anyone may run the investigation — it is not the policyholder&apos;s to withhold
            or the insurer&apos;s to stall. When someone does, every validator fetches each
            named page itself, states what that page says about the insured area over a
            window of the agreed length, and this page fills with the result: the question
            they were asked, each publisher&apos;s reading placed against{" "}
            <span className="figure">
              {p.threshold} {p.unit}
            </span>
            , the count that derived the outcome, and the panel&apos;s own reason.
          </p>
        </section>

        {pkg ? (
          <section>
            <span className="eyebrow">
              The claim filed at version {pkg.version} · {pkg.rows.length}{" "}
              {pkg.rows.length === 1 ? "source" : "sources"} named
            </span>
            <p className="body muted" style={{ marginTop: "var(--gap-tight)" }}>
              The event window ran {formatStamp(pkg.event_start_epoch)} to{" "}
              {formatStamp(pkg.event_end_epoch)}. These are the pages the panel will be
              sent to, and no others.
            </p>
            <div className="tablewrap" style={{ marginTop: "var(--gap-section)" }}>
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
                      <td className="body-sm muted">
                        {KIND_WORDS[r.kind] ?? r.kind.toLowerCase()}
                      </td>
                      <td className="body-sm">
                        {r.cls === "INDEPENDENT" ? "independent" : "a party's own"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {rounds}
      </main>
    );
  }

  /* ── the round, whole ──────────────────────────────────────────────── */

  const rows = decision.rows;
  const readable = rows.filter((r) => r.readable).length;
  const withReading = rows.filter((r) => r.reading !== null).length;
  const fetchEpochs = rows.map((r) => r.fetch_epoch).filter((e) => e > 0);
  const fetchedAt = fetchEpochs.length > 0 ? Math.min(...fetchEpochs) : 0;
  const out = outcomeWords(decision.outcome);

  const isPending = p.pending_version === ver && p.pending_until_epoch > 0;
  const isJudged = p.judged_version === ver;

  /* Only stages the record actually holds. Where an epoch has not been
     written, the stage states the window's LENGTH from the policy rather
     than inventing a time for it. */
  const stages: Array<{ stage: React.ReactNode; when?: string }> = [
    {
      stage: "The event window the claim named, and the only period any reading may be for",
      when: `${formatStamp(decision.event_start_epoch)} to ${formatStamp(decision.event_end_epoch)}`,
    },
    {
      stage: `Every validator fetched the ${rows.length} named ${
        rows.length === 1 ? "source" : "sources"
      } itself — ${readable} of them came back readable`,
      when: fetchedAt > 0 ? formatWhen(fetchedAt, now) : formatStamp(0),
    },
    {
      stage: `Each page was asked what it states, and ${withReading} of ${rows.length} stated a figure the round could use`,
    },
    {
      stage: (
        <>
          Deterministic code counted the publishers against{" "}
          <span className="figure">
            {decision.threshold} {decision.unit}
          </span>{" "}
          and derived {out.label} — no validator chose it
        </>
      ),
      when: formatWhen(decision.observed_epoch, now),
    },
    {
      stage: "The finality window: the record assigns nothing until it has passed",
      when: isPending
        ? formatWhen(p.pending_until_epoch, now)
        : isJudged && p.final_epoch > 0
          ? `passed; became the policy's state ${formatStamp(p.final_epoch)}`
          : `${formatSpan(p.finality_window)} from the record being written`,
    },
    {
      stage: "The appeal window: either party may appeal on a bond, with one new source",
      when:
        isJudged && p.appeal_until_epoch > 0
          ? formatWhen(p.appeal_until_epoch, now)
          : `${formatSpan(p.appeal_window)} once the record becomes the policy's state`,
    },
  ];

  return (
    <main className="page">
      {head}

      {/* the thesis: what the panel was actually asked, verbatim */}
      <section>
        <span className="eyebrow">The question the panel was asked</span>
        <p className="question" style={{ marginTop: "var(--gap-tight)" }}>
          {decision.question}
        </p>
        <p className="body-sm muted measure" style={{ marginTop: "var(--gap-tight)" }}>
          Every validator answered this independently, from pages it fetched itself. None of
          them was asked whether the trigger was met, or what anyone is owed.
        </p>
      </section>

      {/* the determination, drawn */}
      <section>
        <span className="eyebrow">The determination</span>
        <ThresholdScale
          nodes={nodes}
          threshold={decision.threshold}
          unit={decision.unit}
          operator={decision.operator}
        />
        <p className="body" style={{ marginTop: "var(--gap-section)" }}>
          {decision.publishers} independent{" "}
          {decision.publishers === 1 ? "publisher" : "publishers"} spoke;{" "}
          {decision.qualifying} of them past the threshold, {decision.contradicting} short
          of it. The policy required {decision.min_independent} to speak at all.
        </p>
        <div className="determination">
          <Status state={out.state} label={out.label} />
          {decision.hold_reason ? (
            <span className="muted">{HOLD_WORDS[decision.hold_reason] ?? "the record is on hold"}</span>
          ) : (
            <span className="muted">
              derived from the count above, not from any validator&apos;s opinion
            </span>
          )}
        </div>
        {p.radius_km > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--gap-section)",
              flexWrap: "wrap",
              marginTop: "var(--gap-section)",
            }}
          >
            <InsuredArea latE6={p.lat_e6} lonE6={p.lon_e6} radiusKm={p.radius_km} />
            <p className="body-sm muted" style={{ maxWidth: "42ch" }}>
              Every reading had to be for this area — {p.region}, {p.country}, inside{" "}
              {p.radius_km} km of the plotted point. A page reporting the right figure for
              somewhere else is not a reading of this event.
            </p>
          </div>
        ) : null}
      </section>

      {/* the round, in the order it happened */}
      <section>
        <span className="eyebrow">The round, stage by stage</span>
        <ol className="timeline" style={{ marginTop: "var(--gap-tight)" }}>
          {stages.map((s, i) => (
            <li key={i}>
              <div>
                <div className="stage">{s.stage}</div>
                {s.when ? <div className="stage-when">{s.when}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* every source the count was made of */}
      <section>
        <span className="eyebrow">The evidence, source by source</span>
        <p className="body-sm muted measure" style={{ marginTop: "var(--gap-tight)" }}>
          Each publisher speaks once, at its least trigger-favourable page. Two pages on one
          publisher are one voice, and a party&apos;s own instrument is shown here and never
          counted.
        </p>
        <div className="sources" style={{ marginTop: "var(--gap-section)" }}>
          {rows.map((r) => {
            const counted = r.cls === "INDEPENDENT" && usable(r) && r.reading !== null;
            const meets =
              counted && r.reading !== null
                ? meetsThreshold(decision.operator, r.reading, decision.threshold)
                : false;
            return (
              <article className="source" key={r.id}>
                <div className="source-head">
                  <div style={{ minWidth: 0 }}>
                    <h2 className="source-title">{r.label}</h2>
                    <p className="body-sm" style={{ marginTop: 6 }}>
                      <span className="ident">{r.domain}</span>
                    </p>
                  </div>
                  <div className="source-figure">
                    <div className="source-reading">
                      {r.reading === null
                        ? "states no usable reading"
                        : `states ${r.reading} ${decision.unit}`}
                    </div>
                    <div style={{ marginTop: 8, display: "inline-flex" }}>
                      {counted ? (
                        <Status
                          state={meets ? "qualifying" : "contradicting"}
                          label={meets ? "past the threshold" : "short of the threshold"}
                        />
                      ) : (
                        <span className="caption muted">
                          {r.cls === "PARTY" ? "informs only, never counted" : "not counted"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="source-chips">
                  <span className="badge">{KIND_WORDS[r.kind] ?? r.kind.toLowerCase()}</span>
                  <span className="badge">
                    {r.cls === "INDEPENDENT" ? "independent" : "a party's own"}
                  </span>
                  <span className="badge">
                    {r.basis === "RECORDED"
                      ? `recorded at round ${r.basis_round}, re-read from those bytes`
                      : r.basis === "NEW"
                        ? "added by the appellant"
                        : "fetched this round"}
                  </span>
                  <span className="badge">
                    {r.readable ? "the page was read" : "the page could not be read"}
                  </span>
                </div>

                {/* The three checks are the panel's findings ABOUT a page it
                    read. A page that could not be read was never assessed, so
                    the booleans that come back for it are defaults, not
                    findings — the contract itself takes this line, forcing
                    `reading = None` for an unreadable row on the grounds that
                    "an unreadable page states nothing, whatever the model says
                    about it". Rendering them anyway put three specific
                    accusations against a page that merely 404'd: that it was
                    outside the window, outside the insured area, and not what
                    its label said. None of that was determined. */}
                {r.readable ? (
                  <ul className="checks">
                    <li className={r.window_ok ? undefined : "flag"}>
                      {r.window_ok ? "within the agreed window" : "outside the agreed window"}
                    </li>
                    <li className={r.geo_ok ? undefined : "flag"}>
                      {r.geo_ok ? "inside the insured area" : "outside the insured area"}
                    </li>
                    <li className={r.kind_matches ? undefined : "flag"}>
                      {r.kind_matches
                        ? "what its agreed label says"
                        : "not what its agreed label says"}
                    </li>
                  </ul>
                ) : (
                  <p className="body-sm muted" style={{ marginTop: 10 }}>
                    Nothing was assessed about this page: it did not come back, so the
                    panel had no content to judge its window, its area or its kind
                    against.
                  </p>
                )}

                {/* What consensus does and does not cover here, said plainly.
                    For a row fetched THIS round, every validator agreed the
                    reading and the three checks against its own fetch, and an
                    INDEPENDENT row's reading must match exactly or the round
                    is refused. The passage itself is different: validators
                    check that the leader's digest covers the bytes the leader
                    stored, not that those bytes match what they fetched. So
                    the excerpt is the record's, sealed and re-checkable, but
                    it is not itself corroborated — and calling it "the
                    passage the panel read" claimed a agreement the protocol
                    does not make. A RECORDED row IS compared verbatim between
                    nodes, because both are reading the same stored bytes. */}
                {r.excerpt ? (
                  <details className="technical">
                    <summary>
                      {r.basis === "RECORDED"
                        ? "The stored passage, read identically by every validator"
                        : "The passage the leader recorded, sealed by its digest"}
                    </summary>
                    <p
                      className="body-sm"
                      style={{ marginTop: "var(--gap-tight)", whiteSpace: "pre-wrap" }}
                    >
                      {r.excerpt}
                    </p>
                    {r.basis !== "RECORDED" ? (
                      <p className="caption muted" style={{ marginTop: 10 }}>
                        The reading taken from this page was agreed by every validator against
                        its own fetch. This passage is the leader&apos;s record of what it
                        read, fixed by the digest above so a later panel reads the same bytes.
                      </p>
                    ) : null}
                  </details>
                ) : null}

                <Technical
                  summary="Technical record of this source"
                  rows={[
                    [
                      "page",
                      <a
                        key="u"
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                        style={{ color: "var(--iris)" }}
                      >
                        {r.url}
                      </a>,
                    ],
                    ["digest", <Ident key="d" value={r.digest} label="Copy digest" />],
                    ["fetched", formatStamp(r.fetch_epoch)],
                    ["added at version", String(r.added_version)],
                  ]}
                />
              </article>
            );
          })}
        </div>
      </section>

      {/* the panel's own words */}
      <section>
        <span className="eyebrow">The panel&apos;s reason</span>
        <blockquote className="reason" style={{ marginTop: "var(--gap-tight)" }}>
          {decision.reason}
        </blockquote>
        {decision.conflicts.length > 0 ? (
          <p className="body-sm" style={{ marginTop: "var(--gap-section)" }}>
            The panel also noted:{" "}
            {decision.conflicts.map((c) => CONFLICT_WORDS[c] ?? c.toLowerCase()).join("; ")}.
          </p>
        ) : null}
        <Technical
          rows={[
            ["determination", <Ident key="d" value={decision.decision_id} />],
            ["evidence root", <Ident key="r" value={decision.evidence_root} label="Copy root" />],
            ["observed", formatStamp(decision.observed_epoch)],
            ["sufficiency", decision.evidence_flag.toLowerCase().replace(/_/g, " ")],
            ["confidence", `${decision.score} of 100`],
            ["claimed reading", `${decision.claimed_reading} ${decision.unit}, never used as one`],
          ]}
        />
      </section>

      {rounds}
    </main>
  );
}
