"use client";

/**
 * THE INVESTIGATION — one round of the panel, whole.
 *
 * Ordered so it reads as the sequence it describes: the question put to the
 * panel, the determination drawn, the round in stages, every source the count
 * was made of, then the panel's own words.
 *
 * Three rules the rest of the app also keeps, and this page keeps hardest:
 *
 *   NO MACHINE VALUE ON THE PAGE FACE. Hostnames, urls, digests, fetch epochs
 *   and coordinates live in the technical folds, which is what they are for.
 *   The face carries the human fact each one stands for: a publisher's agreed
 *   kind, a named place, a date.
 *
 *   LABELS, NOT SENTENCES. Where a card wanted a paragraph it lays out
 *   label/value pairs instead. The page is allowed one sentence — the lede —
 *   and every claim the old prose made survives as a label, a tag or a fold.
 *
 *   THE PICTURE IS A COUNT, NOT AN AVERAGE. ThresholdScale places one node per
 *   source against the agreed threshold. A party's own source is hollow
 *   because it never counts, and a source the round could not use is neither —
 *   the same arithmetic the contract runs, drawn rather than described.
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
import { Dot, Ident, StateNote, Status, Technical } from "../../../../components/bits";
import { triggerSentence } from "../../../../components/trigger";
import { ThresholdScale, type ScaleNode } from "../../../../components/ThresholdScale";

type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "down"; why: string };

type Record3 = { policy: Policy | null; decision: Decision | null; pkg: ClaimPackage | null };

/** What a publisher IS. This is what the face shows; the host it publishes
 *  from is plumbing and lives in the fold. */
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

  /* One node per source, placed at its reading, tagged with the source's
     agreed name — never its host. Class and usability decide the node's kind;
     nothing here averages, weights or ranks anything. */
  const nodes = useMemo<ScaleNode[]>(() => {
    if (!decision) return [];
    return decision.rows.map((r) => {
      const counted = r.cls === "INDEPENDENT" && usable(r) && r.reading !== null;
      const meets =
        counted && r.reading !== null
          ? meetsThreshold(decision.operator, r.reading, decision.threshold)
          : false;
      return {
        publisher: r.label || KIND_WORDS[r.kind] || "source",
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
          This round could not be read — the network between you and the contract, not the
          record itself.{" "}
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--gap-air)",
          flexWrap: "wrap",
        }}
      >
        <span className="eyebrow">Rounds</span>
        <nav className="tabs" aria-label="Rounds of this policy">
          {versions.map((n) => (
            <Link
              key={n}
              href={`/policies/${id}/investigation/${n}`}
              className={n === ver ? "tab on" : "tab"}
              aria-current={n === ver ? "page" : undefined}
            >
              Version {n}
            </Link>
          ))}
          <Link href={`/policies/${id}`} className="tab">
            The policy
          </Link>
        </nav>
      </div>
    );

  /* The page's opening block: back-link, title, the ONE sentence, and the
     policy's facts as chips rather than as a sub-paragraph. */
  const head = (lede: string) => (
    <header className="pagehead">
      <Link href={`/policies/${id}`} className="eyebrow">
        ← {p.title}
      </Link>
      <h1 className="heading-sm">
        {decision
          ? decision.round_kind === "RE_INVESTIGATION"
            ? `Re-investigation, reconsidering round ${decision.reconsidered_round}`
            : `Investigation of claim version ${decision.evidence_version}`
          : `Claim version ${Number.isInteger(ver) && ver >= 1 ? ver : v}`}
      </h1>
      <p className="lede-line">{lede}</p>
      <div className="chiprow">
        <span className="chip">{triggerSentence(p)}</span>
        <span className="chip">
          {p.region}, {p.country}
        </span>
        {decision ? (
          <span className="chip">observed {formatStamp(decision.observed_epoch)}</span>
        ) : null}
      </div>
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
          ? "No claim has been filed on this policy, so no panel has been asked anything."
          : ver > p.evidence_version
            ? `Version ${ver} has not been filed: this policy's evidence reaches version ${p.evidence_version}.`
            : `The claim at version ${ver} exists, but no panel has read it yet.`;

    return (
      <main className="page">
        {head(missing)}

        <section>
          <div className="section-head">
            <span className="eyebrow">What the round will answer</span>
          </div>
          <div className="pairs">
            <div className="pair">
              <span className="pair-label">Who may run it</span>
              <span className="pair-value">anyone</span>
              <span className="pair-note">
                not the policyholder&apos;s to withhold, nor the insurer&apos;s to stall
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">Threshold</span>
              <span className="pair-value lg">
                {p.threshold}
                <span className="unit">{p.unit}</span>
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">Publishers required</span>
              <span className="pair-value lg">{p.min_independent}</span>
            </div>
          </div>
        </section>

        {pkg ? (
          <section>
            <div className="section-head">
              <span className="eyebrow">The claim filed at version {pkg.version}</span>
            </div>
            <div className="pairs">
              <div className="pair">
                <span className="pair-label">Event window</span>
                <span className="pair-value sm">{formatStamp(pkg.event_start_epoch)}</span>
                <span className="pair-note">to {formatStamp(pkg.event_end_epoch)}</span>
              </div>
              <div className="pair">
                <span className="pair-label">Pages the panel may read</span>
                <span className="pair-value lg">{pkg.rows.length}</span>
                <span className="pair-note">and no others</span>
              </div>
            </div>
            <div className="tablewrap" style={{ marginTop: "var(--gap-section)" }}>
              <table className="rows">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Agreed kind</th>
                    <th>Class</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.label}</td>
                      <td>{KIND_WORDS[r.kind] ?? r.kind.toLowerCase()}</td>
                      <td>{r.cls === "INDEPENDENT" ? "independent" : "a party's own"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* the pages themselves: machine values, so a fold */}
            <Technical
              summary="The pages named, in full"
              rows={pkg.rows.map((r, i): [string, React.ReactNode] => [
                `${i + 1} · ${r.label}`,
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
              ])}
            />
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
      stage: "The event window the claim named, the only period a reading may be for",
      when: `${formatStamp(decision.event_start_epoch)} to ${formatStamp(decision.event_end_epoch)}`,
    },
    {
      stage: "Every validator fetched the named pages itself",
      when: fetchedAt > 0 ? formatWhen(fetchedAt, now) : formatStamp(0),
    },
    {
      stage: (
        <>
          Deterministic code counted the publishers against{" "}
          <span className="figure">
            {decision.threshold} {decision.unit}
          </span>
        </>
      ),
      when: formatWhen(decision.observed_epoch, now),
    },
    {
      stage: "The finality window — the record assigns nothing until it has passed",
      when: isPending
        ? formatWhen(p.pending_until_epoch, now)
        : isJudged && p.final_epoch > 0
          ? `passed; became the policy's state ${formatStamp(p.final_epoch)}`
          : `${formatSpan(p.finality_window)} from the record being written`,
    },
    {
      stage: "The appeal window — either party, on a bond, with one new source",
      when:
        isJudged && p.appeal_until_epoch > 0
          ? formatWhen(p.appeal_until_epoch, now)
          : `${formatSpan(p.appeal_window)} once the record becomes the policy's state`,
    },
  ];

  return (
    <main className="page">
      {/* The lede may only claim what EVERY round does. "Every validator
          fetched each named page itself" is false the moment a round is
          re-heard: a RECORDED row is read from the stored bytes and nothing
          is refetched. What is true of every round is the arithmetic — code
          counts publishers and never averages them. */}
      {head(
        "Deterministic code counts the publishers and derives the outcome — it never averages them.",
      )}

      {/* the thesis: what the panel was actually asked, verbatim */}
      <section>
        <div className="section-head">
          <span className="eyebrow">The question the panel was asked</span>
        </div>
        {/* The contract stores this question with the machine values baked
            into the string: "within 50 km of latitude 11.5, longitude 125.5"
            and "between epoch 1788819222 and epoch 1788905622". Printed
            verbatim it put coordinates and epochs in the largest text on the
            page. The same question is asked here in the terms a reader holds;
            the contract's exact wording stays one fold away, because it is
            what the panel actually received. */}
        <p className="question">
          Did {triggerSentence(p)} occur in {p.region}, {p.country}
          {p.radius_km > 0 ? ` (within ${p.radius_km} km)` : ""} between{" "}
          {formatWhen(decision.event_start_epoch, now)} and{" "}
          {formatWhen(decision.event_end_epoch, now)}?
        </p>
        <Technical
          summary="The question as the contract stored it"
          rows={[["question", decision.question]]}
        />
        <div className="pairs two" style={{ marginTop: "var(--gap-section)" }}>
          <div className="pair">
            <span className="pair-label">Answered by</span>
            <span className="pair-value sm">
              every validator independently, from pages it fetched itself
            </span>
          </div>
          <div className="pair">
            <span className="pair-label">Not asked</span>
            <span className="pair-value sm">
              whether the trigger was met, or what anyone is owed
            </span>
          </div>
        </div>
      </section>

      {/* the determination, drawn — the count, never an average */}
      <section>
        <div className="section-head">
          <span className="eyebrow">The determination</span>
        </div>

        <div className="card lifted">
          <div className="verdict">
            <Dot state={out.state} />
            {out.label}
          </div>
          <p className="pair-note" style={{ marginTop: 12 }}>
            {decision.hold_reason
              ? (HOLD_WORDS[decision.hold_reason] ?? "the record is on hold")
              : "derived from the count below, chosen by no validator"}
          </p>
          <div className="pairs three" style={{ marginTop: "var(--gap-section)" }}>
            <div className="pair">
              <span className="pair-label">Independent publishers</span>
              <span className="count">
                <span className="big-figure">{decision.publishers}</span>
                <span className="of">of {decision.min_independent} required</span>
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">Past the threshold</span>
              <span className="big-figure">{decision.qualifying}</span>
            </div>
            <div className="pair">
              <span className="pair-label">Short of it</span>
              <span className="big-figure">{decision.contradicting}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "var(--gap-section)" }}>
          <ThresholdScale
            nodes={nodes}
            threshold={decision.threshold}
            unit={decision.unit}
            operator={decision.operator}
          />
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
            {/* The plot is the area drawn; its caption names the place. The
                coordinates that produced it are a machine value and sit in
                the fold beside it. */}
            <div
              className="area"
              role="img"
              aria-label={`Insured area: ${p.radius_km} km around ${p.region}, ${p.country}`}
            >
              <span className="area-chip">{p.radius_km} km</span>
            </div>
            <div style={{ minWidth: 0, flex: "1 1 260px" }}>
              <div className="pair">
                <span className="pair-label">Every reading had to be for</span>
                <span className="pair-value lg">
                  {p.region}, {p.country}
                </span>
                <span className="pair-note">
                  within {p.radius_km} km of the plotted point
                </span>
              </div>
              <Technical
                summary="The plotted point"
                rows={[
                  ["latitude", (p.lat_e6 / 1_000_000).toFixed(4)],
                  ["longitude", (p.lon_e6 / 1_000_000).toFixed(4)],
                  ["radius", `${p.radius_km} km`],
                ]}
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* the round, in the order it happened */}
      <section>
        <div className="section-head">
          <span className="eyebrow">The round, stage by stage</span>
        </div>
        <ol className="timeline">
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
        <div className="section-head">
          <span className="eyebrow">The evidence, source by source</span>
        </div>
        <div className="pairs">
          <div className="pair">
            <span className="pair-label">Sources named</span>
            <span className="pair-value lg">{rows.length}</span>
          </div>
          <div className="pair">
            <span className="pair-label">Came back readable</span>
            <span className="pair-value lg">{readable}</span>
          </div>
          <div className="pair">
            <span className="pair-label">Stated a usable figure</span>
            <span className="pair-value lg">{withReading}</span>
          </div>
          <div className="pair">
            <span className="pair-label">One voice per publisher</span>
            <span className="pair-value sm">its least trigger-favourable page</span>
          </div>
        </div>

        <div className="sources" style={{ marginTop: "var(--gap-section)" }}>
          {rows.map((r) => {
            const counted = r.cls === "INDEPENDENT" && usable(r) && r.reading !== null;
            const meets =
              counted && r.reading !== null
                ? meetsThreshold(decision.operator, r.reading, decision.threshold)
                : false;
            /* Every machine value this source has. The host it publishes
               from is one of them: the face says what the publisher IS. */
            const tech: Array<[string, React.ReactNode]> = [
              ["publisher", r.domain],
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
            ];
            if (r.basis === "RECORDED") {
              tech.push(["recorded at round", String(r.basis_round)]);
            }
            return (
              <article className="source" key={r.id}>
                <div className="source-head">
                  <div className="fact" style={{ minWidth: 0 }}>
                    <h2 className="source-title">{r.label}</h2>
                    <span className="fact-qual">
                      {KIND_WORDS[r.kind] ?? r.kind.toLowerCase()}
                    </span>
                  </div>
                  <div className="source-figure">
                    <div className="pair-label" style={{ marginBottom: 8 }}>
                      Reading
                    </div>
                    <div className="source-reading">
                      {r.reading === null ? (
                        "none usable"
                      ) : (
                        <>
                          {r.reading}
                          <span className="unit">{decision.unit}</span>
                        </>
                      )}
                    </div>
                    <div style={{ marginTop: 10, display: "inline-flex" }}>
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

                {/* Provenance as one word, not a paragraph: RECORDED bytes are
                    compared verbatim between nodes, a FETCHED passage is the
                    leader's record. The fold under the excerpt says which
                    part of that every validator actually agreed. */}
                <div className="source-chips">
                  <span className={r.basis === "RECORDED" ? "tag recorded" : "tag fetched"}>
                    {r.basis === "RECORDED" ? "recorded" : "fetched"}
                  </span>
                  <span className="chip">
                    {r.cls === "INDEPENDENT" ? "independent" : "a party's own"}
                  </span>
                  {r.basis === "NEW" ? <span className="chip">added by the appellant</span> : null}
                  {!r.readable ? <span className="chip">the page could not be read</span> : null}
                </div>

                {/* The three checks are the panel's findings ABOUT a page it
                    read. A page that could not be read was never assessed, so
                    its booleans are defaults, not findings — the contract
                    takes the same line, forcing `reading = None` for an
                    unreadable row. Rendering them anyway put three specific
                    accusations against a page that merely 404'd. */}
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
                  <div className="pair" style={{ marginTop: "var(--gap-tight)" }}>
                    <span className="pair-label">Not assessed</span>
                    <span className="pair-value sm">window · insured area · kind</span>
                  </div>
                )}

                {/* What consensus does and does not cover here. For a row
                    fetched THIS round, every validator agreed the reading
                    against its own fetch, and an INDEPENDENT row's reading
                    must match exactly or the round is refused. The passage is
                    different: validators check that the leader's digest covers
                    the bytes the leader stored, not that those bytes match
                    what they fetched — so it is sealed and re-checkable, but
                    not itself corroborated. A RECORDED row IS compared
                    verbatim between nodes, because both read the same stored
                    bytes. */}
                {r.excerpt ? (
                  <details className="technical">
                    <summary>
                      {r.basis === "RECORDED"
                        ? "The stored passage"
                        : "The passage the leader recorded"}
                    </summary>
                    <p
                      className="body-sm"
                      style={{ marginTop: "var(--gap-tight)", whiteSpace: "pre-wrap" }}
                    >
                      {r.excerpt}
                    </p>
                    {r.basis === "RECORDED" ? (
                      <div className="pair-row">
                        <span className="pair-label">Compared verbatim</span>
                        <span className="pair-value">
                          by every validator, from these same bytes
                        </span>
                      </div>
                    ) : (
                      <>
                        {/* Only an INDEPENDENT row's reading is agreed exactly.
                            The validator compares reading, window_ok, geo_ok
                            and kind_matches against its OWN fetch and refuses
                            the round on any mismatch — but only for that
                            class. A PARTY row's reading is explicitly left
                            free ("party rows inform only"), so claiming
                            consensus over it would be false. */}
                        {r.cls === "INDEPENDENT" ? (
                          <div className="pair-row">
                            <span className="pair-label">Agreed by every validator</span>
                            <span className="pair-value">the reading, each against its own fetch</span>
                          </div>
                        ) : (
                          <div className="pair-row">
                            <span className="pair-label">Not agreed</span>
                            <span className="pair-value">
                              a party&apos;s own source informs the panel and never counts
                            </span>
                          </div>
                        )}
                        <div className="pair-row">
                          <span className="pair-label">Not corroborated</span>
                          <span className="pair-value">
                            this passage — the leader&apos;s record, sealed by the digest
                          </span>
                        </div>
                      </>
                    )}
                  </details>
                ) : null}

                <Technical summary="Technical record of this source" rows={tech} />
              </article>
            );
          })}
        </div>
      </section>

      {/* the panel's own words */}
      <section>
        <div className="section-head">
          <span className="eyebrow">The panel&apos;s reason</span>
        </div>
        <blockquote className="reason">{decision.reason}</blockquote>
        {decision.conflicts.length > 0 ? (
          <div className="pair" style={{ marginTop: "var(--gap-section)" }}>
            <span className="pair-label">Also noted</span>
            <span className="pair-value sm">
              {decision.conflicts.map((c) => CONFLICT_WORDS[c] ?? c.toLowerCase()).join("; ")}
            </span>
          </div>
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
