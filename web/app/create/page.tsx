"use client";

/**
 * THE POLICY BUILDER — a control surface, not a wizard.
 *
 * `create_policy` is payable and the value sent IS the coverage, so this page
 * is where an insurer parts with money. Three things follow from that:
 *
 *   THE FORM SPEAKS HUMAN AND SENDS MACHINE. Windows are chosen in days and
 *   hours and sent as seconds; the coverage period is two wall-clock fields
 *   and is sent as epochs; coordinates are typed in degrees and sent as
 *   microdegrees; GEN is typed with a decimal point and sent as an atto
 *   string. Nothing asks a person to type a unit the contract stores in, and
 *   nothing echoes one back: what the transaction actually carries lives in
 *   the technical fold on the review step.
 *
 *   EVERY BOUND THE CONTRACT ENFORCES IS CHECKED HERE FIRST, beneath the field
 *   it belongs to — never as a red box, never as a surprise after a wallet has
 *   opened. The contract re-runs all of them and its answer is the only one
 *   that counts; this exists so that answer is almost never "no".
 *
 *   THE REVIEW STEP STATES WHAT IS BEING SIGNED — as facts, not paragraphs.
 *   The coverage can leave custody two ways and only two, whole either time.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTRACT_ADDRESS,
  CONTRACT_CONFIGURED,
  formatGen,
  formatSpan,
  formatStamp,
} from "../../lib/config";
import { getConfig, getPoliciesFor, invalidateReads, type Config } from "../../lib/read";
import { contractRefusal, inFlight, writeAndConfirm, type TxProgress } from "../../lib/tx";
import { registrableDomain, validOrigin } from "../../lib/urls";
import { useNow } from "../../lib/useNow";
import { useWallet } from "../../lib/wallet";
import { Ident, Technical } from "../components/bits";
import { TxFlow } from "../components/TxFlow";

/* ── the vocabulary ─────────────────────────────────────────────────────────
   get_config reports every list the contract accepts, so the selects are
   filled from the chain. These constants are the fallback for a config read
   that has not answered yet, and they are what the local checks below are
   written against. */

const EVENT_TYPES = [
  "RAINFALL", "WIND", "EARTHQUAKE", "TEMPERATURE", "FLOOD", "WILDFIRE", "OTHER",
];

const OPERATORS = ["GTE", "GT", "LTE", "LT"];

const OP_WORDS: Record<string, string> = {
  GTE: "at or above",
  GT: "above",
  LTE: "at or below",
  LT: "below",
};

const SOURCE_KINDS = [
  "METEOROLOGICAL_AGENCY", "WEATHER_PROVIDER", "SEISMIC_NETWORK",
  "SATELLITE_OBSERVATION", "GOVERNMENT_RECORD", "NEWS_REPORT", "STATION_LOG",
  "OTHER",
];

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

function kindWords(k: string): string {
  return KIND_WORDS[k] ?? k.toLowerCase().replace(/_/g, " ");
}

/** The kind is what belongs on the page face; the hostname is plumbing and
 *  lives in the fold. */
function kindPhrase(k: string): string {
  const w = kindWords(k);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** The spans a window may be set to, in seconds. The contract's floor is 900
 *  and its ceiling 30 days for the finality and appeal windows, 90 days for
 *  the claim grace, so every option here is legal for all three. */
const SPANS = [900, 3600, 21600, 86400, 259200, 604800, 1209600, 2592000];

/* ── the bounds, mirrored ───────────────────────────────────────────────── */

const ATTO = 10n ** 18n;
const MIN_COVERAGE_ATTO = 10n ** 16n; // 0.01 GEN
const MAX_COVERAGE_ATTO = 10n ** 22n; // 10,000 GEN
const MIN_PREMIUM_ATTO = 10n ** 15n; // 0.001 GEN
const MIN_PERIOD = 900;
const MAX_PERIOD = 31_536_000; // one year
const CLOCK_SLACK = 300; // the contract tolerates this much clock divergence

/* ── conversions ────────────────────────────────────────────────────────── */

/** "1.25" GEN → 1250000000000000000 atto, exactly. Never through a float:
 *  0.1 GEN is not representable in binary and the contract compares integers. */
function genToAtto(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d{1,6}(\.\d{1,18})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * ATTO + BigInt((frac + "000000000000000000").slice(0, 18));
}

function parseWhole(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,12}$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** Decimal degrees → microdegrees, the integer the contract stores. */
function degreesToMicro(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d{1,3}(\.\d{1,8})?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e6);
}

/** A datetime-local value is wall-clock in the reader's own zone; the moment
 *  it becomes is shown back in UTC, because UTC is what the contract's
 *  consensus clock compares against. */
function epochFromLocal(v: string): number | null {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function localFromEpoch(epoch: number): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** An epoch reads as a date a person recognises, with the clock time as its
 *  small qualifier. The number itself belongs in the fold. */
function When({ epoch }: { epoch: number }) {
  const [date, time] = formatStamp(epoch).split(", ");
  return (
    <span className="fact">
      <span className="fact-main">{date}</span>
      {time ? <span className="fact-qual">{time}</span> : null}
    </span>
  );
}

/* ── the steps ──────────────────────────────────────────────────────────── */

const STEPS = [
  { id: "cover", label: "Cover" },
  { id: "trigger", label: "Trigger" },
  { id: "area", label: "Area" },
  { id: "money", label: "Money" },
  { id: "basis", label: "Evidence basis" },
  { id: "review", label: "Review" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

type Problem = { step: StepId; field: string; message: string };

/** Positional names for the technical fold — the contract's parameter order,
 *  which is the only order this array may be sent in. */
const ARG_NAMES = [
  "title", "notional", "event_type", "metric", "unit", "operator", "threshold",
  "measurement_hours", "duration_hours", "country", "region", "lat_e6", "lon_e6",
  "radius_km", "premium_atto", "min_independent", "coverage_start_epoch",
  "coverage_end_epoch", "claim_grace_seconds", "finality_window_seconds",
  "appeal_window_seconds", "terms_text", "basis_json",
];

type BasisRow = { origin: string; kind: string; cls: "INDEPENDENT" | "PARTY" };

/** A labelled control. The line beneath it is a hint or a problem, never both
 *  and never a paragraph: they occupy the same line so nothing jumps as you
 *  type, and a problem simply reads in the brighter colour. */
function Field({
  label,
  hint,
  problem,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  problem?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {problem ? (
        <span className="hint" style={{ color: "var(--bone)" }}>
          {problem}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </label>
  );
}

export default function Compose() {
  const { address, client, chainOk } = useWallet();
  const now = useNow();

  const [step, setStep] = useState<StepId>("cover");
  const [config, setConfig] = useState<Config | null>(null);

  // cover
  const [title, setTitle] = useState("");
  const [notional, setNotional] = useState("");
  const [eventType, setEventType] = useState("RAINFALL");
  const [terms, setTerms] = useState("");

  // trigger
  const [metric, setMetric] = useState("");
  const [unit, setUnit] = useState("");
  const [operator, setOperator] = useState("GTE");
  const [threshold, setThreshold] = useState("");
  const [measurementHours, setMeasurementHours] = useState("24");
  const [durationHours, setDurationHours] = useState("0");

  // area
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [areaMode, setAreaMode] = useState<"named" | "plotted">("named");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("");

  // money
  const [coverage, setCoverage] = useState("");
  const [premium, setPremium] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [claimGrace, setClaimGrace] = useState(1_209_600);
  const [finality, setFinality] = useState(86_400);
  const [appealWindow, setAppealWindow] = useState(86_400);

  // basis
  const [basis, setBasis] = useState<BasisRow[]>([
    { origin: "", kind: "METEOROLOGICAL_AGENCY", cls: "INDEPENDENT" },
  ]);
  const [minIndependent, setMinIndependent] = useState(1);

  // the write
  const [tx, setTx] = useState<TxProgress | null>(null);
  const [refusal, setRefusal] = useState("");
  const [newId, setNewId] = useState("");
  const seen = useRef<Set<string>>(new Set());

  /* The coverage period starts empty and is filled by a click, never by an
     effect: a default computed from the clock differs between the render on
     the server and the render in the browser, and a period this page invented
     is not a period anyone chose. */
  const suggestPeriod = useCallback(() => {
    const soon = Math.floor(Date.now() / 1000) + 3600;
    const start = soon - (soon % 900);
    setStartLocal(localFromEpoch(start));
    setEndLocal(localFromEpoch(start + 30 * 86_400));
  }, []);

  useEffect(() => {
    let live = true;
    getConfig()
      .then((c) => live && setConfig(c))
      .catch(() => {
        /* the selects fall back to the mirrored lists; the contract still
           re-checks every one of them at intake */
      });
    return () => {
      live = false;
    };
  }, []);

  const eventTypes = config?.event_types ?? EVENT_TYPES;
  const operators = config?.operators ?? OPERATORS;
  const sourceKinds = config?.source_kinds ?? SOURCE_KINDS;

  /* ── the derived record ─────────────────────────────────────────────── */

  const coverageAtto = genToAtto(coverage);
  const premiumAtto = genToAtto(premium);
  const startEpoch = epochFromLocal(startLocal);
  const endEpoch = epochFromLocal(endLocal);
  const thresholdN = parseWhole(threshold);
  const measurementN = parseWhole(measurementHours);
  const durationN = parseWhole(durationHours);
  const radiusN = areaMode === "plotted" ? parseWhole(radius) : 0;
  const latMicro = areaMode === "plotted" ? degreesToMicro(lat) : 0;
  const lonMicro = areaMode === "plotted" ? degreesToMicro(lon) : 0;

  const cleanBasis = useMemo(
    () =>
      basis.map((b) => ({
        kind: b.kind,
        origin: b.origin.trim().toLowerCase(),
        class: b.cls,
      })),
    [basis],
  );

  /* A row someone has begun but not yet made a hostname is a different
     problem from having no independent origin at all, and saying the wrong
     one sends them looking for a row they already have. */
  const malformedOrigins = basis.filter(
    (b) => b.origin.trim() !== "" && !validOrigin(b.origin.trim().toLowerCase()),
  ).length;

  /** Publishers, not rows: two origins on one registrable domain are one
   *  voice, and the contract counts them the same way. */
  const publishers = useMemo(() => {
    const set = new Set<string>();
    for (const b of cleanBasis) {
      if (b.class === "INDEPENDENT" && validOrigin(b.origin)) {
        set.add(registrableDomain(b.origin));
      }
    }
    return set;
  }, [cleanBasis]);

  const problems = useMemo<Problem[]>(() => {
    const out: Problem[] = [];
    const add = (where: StepId, field: string, message: string) =>
      out.push({ step: where, field, message });

    // cover
    const t = title.trim();
    if (t.length < 1 || t.length > 120) {
      add("cover", "title", "The title runs 1 to 120 characters.");
    }
    if (notional.trim().length > 40) {
      add("cover", "notional", "What is covered runs 40 characters or fewer.");
    }
    const termsText = terms.trim();
    if (termsText.length < 100 || termsText.length > 12_000) {
      add(
        "cover",
        "terms",
        "The policy text runs 100 to 12,000 characters — the panel reads it as the definition of the metric and of any exclusion.",
      );
    }

    // trigger
    if (metric.trim().length < 1 || metric.trim().length > 80) {
      add("trigger", "metric", "The metric name runs 1 to 80 characters.");
    }
    if (unit.trim().length < 1 || unit.trim().length > 24) {
      add("trigger", "unit", "The unit runs 1 to 24 characters.");
    }
    if (thresholdN === null || thresholdN < 1 || thresholdN > 1_000_000_000) {
      add("trigger", "threshold", "The threshold is a whole number, 1 to 1,000,000,000.");
    }
    if (measurementN === null || measurementN < 1 || measurementN > 720) {
      add("trigger", "measurement", "The measurement window runs 1 to 720 hours.");
    }
    if (durationN === null || durationN > 720) {
      add("trigger", "duration", "The required duration runs 0 to 720 hours; 0 asks for none.");
    }

    // area
    if (country.trim().length < 1 || country.trim().length > 80) {
      add("area", "country", "The country runs 1 to 80 characters.");
    }
    if (region.trim().length < 1 || region.trim().length > 80) {
      add("area", "region", "The region runs 1 to 80 characters.");
    }
    if (areaMode === "plotted") {
      if (latMicro === null || latMicro < -90_000_000 || latMicro > 90_000_000) {
        add("area", "lat", "Latitude is decimal degrees, -90 to 90.");
      }
      if (lonMicro === null || lonMicro < -180_000_000 || lonMicro > 180_000_000) {
        add("area", "lon", "Longitude is decimal degrees, -180 to 180.");
      }
      if (radiusN === null || radiusN < 1 || radiusN > 5000) {
        add("area", "radius", "A plotted point needs a radius, 1 to 5,000 km.");
      }
    }

    // money
    if (coverageAtto === null || coverageAtto < MIN_COVERAGE_ATTO || coverageAtto > MAX_COVERAGE_ATTO) {
      add("money", "coverage", "The coverage runs 0.01 to 10,000 GEN, deposited with this signature.");
    }
    if (premiumAtto === null || premiumAtto < MIN_PREMIUM_ATTO) {
      add("money", "premium", "The premium is at least 0.001 GEN.");
    } else if (coverageAtto !== null && premiumAtto >= coverageAtto) {
      add("money", "premium", "The premium has to sit below the coverage.");
    }
    if (startEpoch === null) {
      add("money", "start", "Give the moment the cover starts.");
    } else if (startEpoch < now - CLOCK_SLACK) {
      add("money", "start", "Cover cannot start in the past.");
    }
    if (endEpoch === null) {
      add("money", "end", "Give the moment the cover ends.");
    } else if (startEpoch !== null) {
      if (endEpoch - startEpoch < MIN_PERIOD) {
        add("money", "end", "The period has to run at least 15 minutes.");
      } else if (endEpoch - startEpoch > MAX_PERIOD) {
        add("money", "end", "The period may run at most one year.");
      }
    }

    // basis
    if (cleanBasis.length < 1 || cleanBasis.length > 6) {
      add("basis", "rows", "The basis names 1 to 6 origins.");
    }
    const origins = new Set<string>();
    cleanBasis.forEach((b, i) => {
      if (!validOrigin(b.origin)) {
        add(
          "basis",
          `origin-${i}`,
          "An origin is a lowercase hostname with at least one dot — no scheme, no path.",
        );
      } else if (origins.has(b.origin)) {
        add("basis", `origin-${i}`, "This origin is already on the list.");
      } else {
        origins.add(b.origin);
      }
    });
    if (publishers.size === 0) {
      add(
        "basis",
        "independence",
        "At least one origin has to be independent of both parties: a trigger only the parties themselves attest cannot pay.",
      );
    } else if (minIndependent > publishers.size) {
      add(
        "basis",
        "min",
        "More publishers are asked to agree than the basis has.",
      );
    }

    return out;
  }, [
    title, notional, terms, metric, unit, thresholdN, measurementN, durationN,
    country, region, areaMode, latMicro, lonMicro, radiusN, coverageAtto,
    premiumAtto, startEpoch, endEpoch, now, cleanBasis, publishers, minIndependent,
  ]);

  const problemFor = useCallback(
    (field: string) => problems.find((p) => p.field === field)?.message,
    [problems],
  );
  const countFor = useCallback(
    (id: StepId) => problems.filter((p) => p.step === id).length,
    [problems],
  );

  /* ── what will be sent ──────────────────────────────────────────────── */

  const args = useMemo(() => {
    if (problems.length > 0 || coverageAtto === null || premiumAtto === null) return null;
    return [
      title.trim(),
      notional.trim(),
      eventType,
      metric.trim(),
      unit.trim(),
      operator,
      thresholdN as number,
      measurementN as number,
      durationN as number,
      country.trim(),
      region.trim(),
      latMicro as number,
      lonMicro as number,
      radiusN as number,
      premiumAtto.toString(),
      minIndependent,
      startEpoch as number,
      endEpoch as number,
      claimGrace,
      finality,
      appealWindow,
      terms.trim(),
      JSON.stringify(cleanBasis),
    ] as unknown[];
  }, [
    problems, title, notional, eventType, metric, unit, operator, thresholdN,
    measurementN, durationN, country, region, latMicro, lonMicro, radiusN,
    premiumAtto, minIndependent, startEpoch, endEpoch, claimGrace, finality,
    appealWindow, terms, cleanBasis, coverageAtto,
  ]);

  const busy = inFlight(tx?.stage ?? "idle");
  const wrote = Boolean(newId);
  const blocked = !CONTRACT_CONFIGURED
    ? "No contract is configured for this deployment."
    : !address
      ? "Connect a wallet — the coverage is sent from it."
      : !chainOk
        ? "Switch your wallet to GenLayer Studio Next."
        : problems.length > 0
          ? `${problems.length} ${problems.length === 1 ? "answer is" : "answers are"} still outstanding.`
          : "";

  const submit = useCallback(async () => {
    if (!args || !client || coverageAtto === null) return;
    setRefusal("");
    setNewId("");

    // A baseline of this wallet's policies, taken BEFORE the write: the
    // contract assigns the id, and the only honest way to learn it is to see
    // which id appeared that was not there a moment ago. A baseline that
    // cannot be read is a baseline that would credit an older policy to this
    // signature, so the write does not go out without one.
    try {
      const mine = await getPoliciesFor(address, true);
      seen.current = new Set(mine.map((p) => p.policy_id));
    } catch {
      setTx({
        stage: "failed",
        at: "estimating",
        detail:
          "Studio Next could not be read to see which policies are already yours, so nothing " +
          "was sent. Retrying usually works.",
      });
      return;
    }

    try {
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "create_policy",
        args,
        valueAtto: coverageAtto,
        onProgress: setTx,
        confirmedDetail: "Finalized. The coverage is in custody against this policy.",
        predicate: async () => {
          const mine = await getPoliciesFor(address, true);
          const fresh = mine.find((p) => !seen.current.has(p.policy_id));
          if (!fresh) return false;
          setNewId(fresh.policy_id);
          return true;
        },
      });
      invalidateReads();
    } catch (err) {
      // The contract's own sentence, verbatim. writeAndConfirm has already
      // put it on the flow; it is repeated here as a quotation because it is
      // the contract speaking, and it is the one thing worth reading twice.
      const said = contractRefusal(err);
      if (said) setRefusal(said);
    }
  }, [args, client, address, coverageAtto]);

  /* ── the surface ────────────────────────────────────────────────────── */

  const opWords = OP_WORDS[operator] ?? operator.toLowerCase();
  const triggerLine =
    metric.trim() && unit.trim() && thresholdN !== null
      ? `${metric.trim()} ${opWords} ${thresholdN} ${unit.trim()}`
      : "";
  const appealBondAtto =
    coverageAtto === null
      ? null
      : coverageAtto / 20n > 5n * 10n ** 16n
        ? coverageAtto / 20n
        : 5n * 10n ** 16n;

  return (
    <main className="page book">
      <header className="pagehead">
        <h1 className="heading-sm">Write a policy</h1>
        <p className="lede-line">
          The coverage is deposited with this signature and leaves custody only through a
          finalized trigger or the expiry reclaim.
        </p>
      </header>

      <section className="metricstrip banked" style={{ marginTop: "var(--gap-section)" }}>
        <span className="metric">
          <span className="metric-label">Coverage deposited</span>
          <span className="metric-value">
            {coverageAtto === null ? (
              "—"
            ) : (
              <>
                {formatGen(coverageAtto)}
                <span className="unit">GEN</span>
              </>
            )}
          </span>
        </span>
        <span className="metric">
          <span className="metric-label">Premium at activation</span>
          <span className="metric-value">
            {premiumAtto === null ? (
              "—"
            ) : (
              <>
                {formatGen(premiumAtto)}
                <span className="unit">GEN</span>
              </>
            )}
          </span>
        </span>
        <span className="metric">
          <span className="metric-label">Publishers that must agree</span>
          {/* "1 of 0" is not a requirement, it is an impossibility — and it
              is what an untouched form said before any origin was named. Until
              there are publishers to count against, the requirement stands on
              its own. */}
          <span className="metric-value">
            {minIndependent}
            {publishers.size > 0 ? <span className="unit">of {publishers.size}</span> : null}
          </span>
        </span>
        <span className="metric">
          <span className="metric-label">Outstanding</span>
          <span className="metric-value">{problems.length}</span>
        </span>
      </section>

      {/* the step bar and the step it opens are one movement, so they sit in
          one stack rather than a page-sized gap apart */}
      <div className="stack">
        <div>
          <nav className="tabs" aria-label="Policy steps">
            {STEPS.map((s) => {
              const n = countFor(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === step ? "tab on" : "tab"}
                  onClick={() => setStep(s.id)}
                  aria-pressed={s.id === step}
                >
                  {s.label}
                  {s.id !== "review" && n > 0 ? ` · ${n}` : ""}
                </button>
              );
            })}
          </nav>
        </div>

        {step === "cover" && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">What is covered</h2>
            </div>
            <div className="stack">
              <Field
                label="Title"
                problem={problemFor("title")}
                hint="One line, as a policyholder would search for it."
              >
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={160}
                  placeholder="Monsoon shortfall cover, Nashik district"
                />
              </Field>
              <div className="grid two">
                <Field
                  label="What is covered"
                  problem={problemFor("notional")}
                  hint="The insured quantity, in words. Optional."
                >
                  <input
                    value={notional}
                    onChange={(e) => setNotional(e.target.value)}
                    maxLength={60}
                    placeholder="500 hectares of maize"
                  />
                </Field>
                <Field label="Event type" hint="The family the trigger belongs to.">
                  <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
                    {eventTypes.map((t) => (
                      <option key={t} value={t}>
                        {t.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {/* the counter stays visible whether or not the length is legal:
                  a writer needs to see the distance to the floor, not only be
                  told they are short of it */}
              <Field
                label="Policy text"
                hint={
                  <span style={{ color: problemFor("terms") ? "var(--bone)" : undefined }}>
                    {terms.trim().length} of 12,000 characters, 100 at the least — the panel reads
                    only this text for the metric and its exclusions.
                  </span>
                }
              >
                <textarea
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  rows={10}
                  maxLength={12_000}
                  placeholder="Rainfall is the total accumulated depth reported for the district gauge…"
                />
              </Field>
            </div>
            <StepFoot onNext={() => setStep("trigger")} nextLabel="Trigger" />
          </section>
        )}

        {step === "trigger" && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">What pays</h2>
            </div>
            <div className="stack">
              <div className="grid two">
                <Field label="Metric" problem={problemFor("metric")} hint="As the publishers name it.">
                  <input
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    maxLength={100}
                    placeholder="accumulated rainfall"
                  />
                </Field>
                <Field label="Unit" problem={problemFor("unit")} hint="Whole units only.">
                  <input
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={40}
                    placeholder="mm"
                  />
                </Field>
              </div>
              <div className="grid two">
                <Field label="Reads" hint="Which side of the threshold pays.">
                  <select value={operator} onChange={(e) => setOperator(e.target.value)}>
                    {operators.map((o) => (
                      <option key={o} value={o}>
                        {OP_WORDS[o] ?? o.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Threshold"
                  problem={problemFor("threshold")}
                  hint="A whole number, in the unit above."
                >
                  <input
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    inputMode="numeric"
                    placeholder="120"
                  />
                </Field>
              </div>
              <div className="grid two">
                <Field
                  label="Measured over"
                  problem={problemFor("measurement")}
                  hint="Hours, 1 to 720."
                >
                  <input
                    value={measurementHours}
                    onChange={(e) => setMeasurementHours(e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field
                  label="Required duration"
                  problem={problemFor("duration")}
                  hint="Hours the condition must hold. 0 asks for none."
                >
                  <input
                    value={durationHours}
                    onChange={(e) => setDurationHours(e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
              </div>
              {triggerLine ? (
                <div className="tile">
                  <div className="pair">
                    <span className="pair-label">The trigger</span>
                    <span className="pair-value lg">{triggerLine}</span>
                    <span className="pair-note">
                      Any {measurementN ?? "—"}-hour window inside the window a claim names.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <StepFoot onBack={() => setStep("cover")} onNext={() => setStep("area")} nextLabel="Area" />
          </section>
        )}

        {step === "area" && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Where it is measured</h2>
            </div>
            <div className="stack">
              <div className="grid two">
                <Field label="Country" problem={problemFor("country")}>
                  <input
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    maxLength={100}
                    placeholder="India"
                  />
                </Field>
                <Field
                  label="Region"
                  problem={problemFor("region")}
                  hint="District, province or station."
                >
                  <input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    maxLength={100}
                    placeholder="Nashik"
                  />
                </Field>
              </div>
              <div className="grid two">
                <Field
                  label="How the area is fixed"
                  hint={
                    areaMode === "named"
                      ? "Judged by name. No coordinates recorded."
                      : "Judged by whether a station sits inside the radius."
                  }
                >
                  <select
                    value={areaMode}
                    onChange={(e) => setAreaMode(e.target.value as "named" | "plotted")}
                  >
                    <option value="named">Named area only</option>
                    <option value="plotted">A plotted point and a radius</option>
                  </select>
                </Field>
              </div>
              {areaMode === "plotted" && (
                <div className="grid three">
                  <Field label="Latitude" problem={problemFor("lat")} hint="Degrees, -90 to 90.">
                    <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="19.9975" />
                  </Field>
                  <Field label="Longitude" problem={problemFor("lon")} hint="Degrees, -180 to 180.">
                    <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="73.7898" />
                  </Field>
                  <Field label="Radius" problem={problemFor("radius")} hint="Kilometres, 1 to 5,000.">
                    <input
                      value={radius}
                      onChange={(e) => setRadius(e.target.value)}
                      inputMode="numeric"
                      placeholder="50"
                    />
                  </Field>
                </div>
              )}
            </div>
            <StepFoot
              onBack={() => setStep("trigger")}
              onNext={() => setStep("money")}
              nextLabel="Money"
            />
          </section>
        )}

        {step === "money" && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">The money and the clock</h2>
            </div>
            <div className="stack">
              <div className="grid two">
                <Field
                  label="Coverage"
                  problem={problemFor("coverage")}
                  hint="GEN, deposited with this signature."
                >
                  <input
                    value={coverage}
                    onChange={(e) => setCoverage(e.target.value)}
                    inputMode="decimal"
                    placeholder="5"
                  />
                </Field>
                <Field
                  label="Premium"
                  problem={problemFor("premium")}
                  hint="GEN, paid at activation and yours from then."
                >
                  <input
                    value={premium}
                    onChange={(e) => setPremium(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.25"
                  />
                </Field>
              </div>
              <div className="grid two">
                <Field
                  label="Cover starts"
                  problem={problemFor("start")}
                  hint={startEpoch === null ? "Your own clock; recorded in UTC." : formatStamp(startEpoch)}
                >
                  <input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                  />
                </Field>
                <Field
                  label="Cover ends"
                  problem={problemFor("end")}
                  hint={endEpoch === null ? "15 minutes to a year after the start." : formatStamp(endEpoch)}
                >
                  <input
                    type="datetime-local"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                  />
                </Field>
              </div>

              {!startLocal && !endLocal ? (
                <div>
                  <button type="button" className="ghost" onClick={suggestPeriod}>
                    fill a period — starts in an hour, runs 30 days
                  </button>
                </div>
              ) : null}

              <div className="grid three">
                <Field
                  label="Claim grace"
                  hint="A claim may still be filed for this long after cover ends; then anyone may return the coverage to you."
                >
                  <select value={claimGrace} onChange={(e) => setClaimGrace(Number(e.target.value))}>
                    {SPANS.map((s) => (
                      <option key={s} value={s}>
                        {formatSpan(s)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Finality window"
                  hint="A determination waits this long before anyone may promote it to the policy's state."
                >
                  <select value={finality} onChange={(e) => setFinality(Number(e.target.value))}>
                    {SPANS.map((s) => (
                      <option key={s} value={s}>
                        {formatSpan(s)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Appeal window"
                  hint="Either party may appeal for this long, with a bond; then anyone may settle."
                >
                  <select
                    value={appealWindow}
                    onChange={(e) => setAppealWindow(Number(e.target.value))}
                  >
                    {SPANS.map((s) => (
                      <option key={s} value={s}>
                        {formatSpan(s)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {appealBondAtto !== null && (
                <div className="tile">
                  <div className="pair">
                    <span className="pair-label">Appeal bond</span>
                    <span className="pair-value">
                      {formatGen(appealBondAtto)}
                      <span className="unit">GEN</span>
                    </span>
                    <span className="pair-note">
                      5% of the coverage, never below 0.05 GEN. Returned only if a second panel
                      reaches a different outcome.
                    </span>
                  </div>
                </div>
              )}
            </div>

            <StepFoot
              onBack={() => setStep("area")}
              onNext={() => setStep("basis")}
              nextLabel="Evidence basis"
            />
          </section>
        )}

        {step === "basis" && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Where evidence may come from</h2>
              <span className="eyebrow">Frozen at signing</span>
            </div>

            <div className="stack">
              <div className="basislist">
                {basis.map((b, i) => (
                  <div className="basisrow" key={i} style={{ alignItems: "flex-end" }}>
                    {/* the row wears the KIND; the hostname is the machine value
                        the contract matches a source url against, and it is typed
                        here because there is nowhere else it can come from */}
                    <span className="field" style={{ flex: "2 1 18ch" }}>
                      <input
                        className="ident"
                        value={b.origin}
                        onChange={(e) =>
                          setBasis((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, origin: e.target.value.trim().toLowerCase() } : r,
                            ),
                          )
                        }
                        aria-label={`Origin ${i + 1}`}
                        placeholder="mausam.imd.gov.in"
                        maxLength={140}
                      />
                    </span>
                    <span className="field" style={{ flex: "1 1 16ch" }}>
                      <select
                        value={b.kind}
                        onChange={(e) =>
                          setBasis((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, kind: e.target.value } : r)),
                          )
                        }
                        aria-label={`Agreed kind for origin ${i + 1}`}
                      >
                        {sourceKinds.map((k) => (
                          <option key={k} value={k}>
                            {kindWords(k)}
                          </option>
                        ))}
                      </select>
                    </span>
                    <span className="field" style={{ flex: "1 1 12ch" }}>
                      <select
                        value={b.cls}
                        onChange={(e) =>
                          setBasis((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, cls: e.target.value as BasisRow["cls"] } : r,
                            ),
                          )
                        }
                        aria-label={`Class for origin ${i + 1}`}
                      >
                        <option value="INDEPENDENT">independent</option>
                        <option value="PARTY">a party&apos;s own</option>
                      </select>
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setBasis((rows) => rows.filter((_, j) => j !== i))}
                      disabled={basis.length <= 1}
                      style={{
                        paddingBottom: 12,
                        color: basis.length <= 1 ? "var(--iron)" : undefined,
                      }}
                    >
                      remove
                    </button>
                    {problemFor(`origin-${i}`) ? (
                      <p className="caption" style={{ flexBasis: "100%", color: "var(--bone)" }}>
                        {problemFor(`origin-${i}`)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setBasis((rows) =>
                      rows.length >= 6
                        ? rows
                        : [...rows, { origin: "", kind: "METEOROLOGICAL_AGENCY", cls: "INDEPENDENT" }],
                    )
                  }
                  disabled={basis.length >= 6}
                >
                  + add an origin
                </button>
                {basis.length >= 6 ? (
                  <span className="caption muted">Six is the most the contract accepts.</span>
                ) : null}
              </div>

              <div className="grid two">
                <Field label="Publishers that must agree" hint="Before a trigger can be determined at all.">
                  <select
                    value={minIndependent}
                    onChange={(e) => setMinIndependent(Number(e.target.value))}
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* the live reading of the basis: a count while it holds, the
                    refusal the contract would give the moment it cannot */}
                {malformedOrigins === 0 && publishers.size > 0 && minIndependent <= publishers.size ? (
                  <div className="tile">
                    <div className="pair">
                      <span className="pair-label">Independent publishers</span>
                      <span className="count">
                        <span className="big-figure">{publishers.size}</span>
                        <span className="of">{minIndependent} must agree</span>
                      </span>
                      <span className="pair-note">
                        A party source may explain a reading, never establish one.
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {malformedOrigins > 0 ? (
                <blockquote className="reason">
                  {malformedOrigins === 1
                    ? "One origin is not yet a hostname"
                    : `${malformedOrigins} origins are not yet hostnames`}{" "}
                  — a hostname is what a source url is matched against: no scheme, no path.
                </blockquote>
              ) : publishers.size === 0 ? (
                <blockquote className="reason">
                  The basis needs at least one independent origin — a trigger only the parties
                  themselves attest cannot pay.
                </blockquote>
              ) : minIndependent > publishers.size ? (
                <blockquote className="reason">
                  {minIndependent} publishers are asked to agree but the basis has{" "}
                  {publishers.size} — the trigger could never be verified.
                </blockquote>
              ) : null}
            </div>

            <StepFoot
              onBack={() => setStep("money")}
              onNext={() => setStep("review")}
              nextLabel="Review"
            />
          </section>
        )}

        {step === "review" && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">What this signature does</h2>
              {problems.length > 0 ? (
                <span className="eyebrow">{problems.length} outstanding</span>
              ) : null}
            </div>

            {problems.length > 0 ? (
              <div className="tablewrap">
                <table className="rows">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>What is missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.map((p) => (
                      <tr key={`${p.field}:${p.message}`}>
                        <td>
                          <button type="button" className="ghost" onClick={() => setStep(p.step)}>
                            {STEPS.find((s) => s.id === p.step)?.label}
                          </button>
                        </td>
                        <td className="body-sm">{p.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="stack loose">
                <div className="pairs">
                  <div className="pair">
                    <span className="pair-label">Pays out</span>
                    <span className="pair-value lg">
                      {formatGen(coverageAtto ?? 0n)}
                      <span className="unit">GEN</span>
                    </span>
                  </div>
                  <div className="pair">
                    <span className="pair-label">Pays when</span>
                    <span className="pair-value">{triggerLine}</span>
                    <span className="pair-note">Any {measurementN}-hour window in the claim.</span>
                  </div>
                  <div className="pair">
                    <span className="pair-label">Where</span>
                    <span className="fact">
                      <span className="fact-main">
                        {region.trim()}, {country.trim()}
                      </span>
                      {areaMode === "plotted" ? (
                        <span className="fact-qual">within {radiusN} km of the plotted point</span>
                      ) : (
                        <span className="fact-qual">judged by name</span>
                      )}
                    </span>
                  </div>
                  <div className="pair">
                    <span className="pair-label">Cover starts</span>
                    <When epoch={startEpoch ?? 0} />
                  </div>
                  <div className="pair">
                    <span className="pair-label">Cover ends</span>
                    <When epoch={endEpoch ?? 0} />
                  </div>
                </div>

                {/* the custody statement, said as facts: two exits, whole either
                    time, and nothing that pays a part of it */}
                <div className="tile">
                  <div className="pair-row">
                    <span className="pair-label">Until the premium is paid</span>
                    <span className="pair-value">a draft you may cancel, coverage returned</span>
                  </div>
                  <div className="pair-row">
                    <span className="pair-label">Once it is paid</span>
                    <span className="pair-value">the premium is yours, the commitment is fixed</span>
                  </div>
                  <div className="pair-row">
                    <span className="pair-label">Pays the policyholder</span>
                    <span className="pair-value">the whole coverage, on a finalized trigger</span>
                  </div>
                  <div className="pair-row">
                    <span className="pair-label">Returns to you</span>
                    <span className="pair-value">
                      the whole coverage, after cover and {formatSpan(claimGrace)} of grace
                    </span>
                  </div>
                  <div className="pair-row">
                    <span className="pair-label">Any other path</span>
                    <span className="pair-value muted">none, and never a part of it</span>
                  </div>
                </div>

                <div className="pair">
                  <span className="pair-label">The panel may read only these</span>
                  <div className="chiprow">
                    {cleanBasis.map((b, i) => (
                      <span className="chip on-card" key={`${b.origin}-${i}`}>
                        {kindPhrase(b.kind)}
                        {b.class === "PARTY" ? " · a party's own" : ""}
                      </span>
                    ))}
                  </div>
                  <span className="pair-note">
                    {publishers.size} independent · {minIndependent} must agree.
                  </span>
                </div>

                <p className="note">
                  Your wallet also posts a fee deposit, sized by the simulation and largely refunded;
                  nothing is irreversible until Studio Next reports the write finalized.
                </p>

                <Technical
                  summary="The arguments this transaction carries"
                  rows={[
                    ["value", `${formatGen(coverageAtto ?? 0n)} GEN (the coverage)`],
                    ["method", "create_policy"],
                    ...cleanBasis.map(
                      (b, i) =>
                        [`origin ${i + 1}`, <Ident key={`o${i}`} value={b.origin} label="Copy origin" />] as [
                          string,
                          React.ReactNode,
                        ],
                    ),
                    ...(args ?? []).map(
                      (a, i) =>
                        [
                          `${String(i + 1).padStart(2, "0")} ${ARG_NAMES[i]}`,
                          typeof a === "string" && a.length > 80 ? `${a.slice(0, 80)}…` : String(a),
                        ] as [string, React.ReactNode],
                    ),
                    [
                      "the whole array",
                      <Ident
                        key="raw"
                        value={JSON.stringify(args ?? [])}
                        label="Copy the argument array"
                      />,
                    ],
                  ]}
                />
              </div>
            )}

            <div
              style={{
                marginTop: 32,
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="pill primary"
                onClick={() => void submit()}
                disabled={Boolean(blocked) || busy || wrote}
              >
                {busy
                  ? "Writing…"
                  : wrote
                    ? "Written"
                    : `Deposit ${coverageAtto === null ? "the coverage" : `${formatGen(coverageAtto)} GEN`} and write the policy`}
              </button>
              {blocked ? <span className="body-sm muted">{blocked}</span> : null}
            </div>

            {tx ? (
              <div style={{ marginTop: 24 }}>
                <TxFlow p={tx} />
              </div>
            ) : null}

            {refusal ? (
              <blockquote className="reason" style={{ marginTop: 20 }}>
                {refusal}
              </blockquote>
            ) : null}

            {wrote ? (
              <p className="note" style={{ marginTop: 20 }}>
                On the record.{" "}
                <Link href={`/policies/${newId}`} className="ghost">
                  Open it
                </Link>{" "}
                ·{" "}
                <Link href="/" className="ghost">
                  back to the book
                </Link>
              </p>
            ) : null}

            <div style={{ marginTop: 24 }}>
              <button type="button" className="ghost" onClick={() => setStep("basis")}>
                ← evidence basis
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/** Step navigation. Neither of these is an action on the record, so neither
 *  competes with the one primary action, which lives on the review step.
 *  Separated by air, not by a rule. */
function StepFoot({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  return (
    <div
      style={{
        marginTop: 40,
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      {onBack ? (
        <button type="button" className="ghost" onClick={onBack}>
          ← back
        </button>
      ) : null}
      {onNext ? (
        <button type="button" className="pill quiet" style={{ marginLeft: "auto" }} onClick={onNext}>
          {nextLabel} →
        </button>
      ) : null}
    </div>
  );
}
