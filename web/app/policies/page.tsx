"use client";

/**
 * THE POLICY BOOK — every policy the contract holds, as its own route.
 *
 * The nav points here, so it opens with the book and nothing else: a reader
 * who came to look something up is not made to read a pitch first.
 *
 * The row is written HERE rather than shared with the landing page. Two
 * listings of one book drift apart, and the moment they do the record has two
 * versions of itself; the shared parts are copied whole, not imported, so
 * neither page can break the other.
 *
 * TWO COUNTS, LABELLED APART. What the contract holds and what this view has
 * filtered are different numbers, so each carries its own label rather than a
 * sentence explaining the difference. Neither is ever rendered as 0 from a
 * failed read — an unread count is "—", which means unknown.
 *
 * NO MACHINE VALUE ON THE FACE. A publisher is named by the KIND both parties
 * agreed to, never by its hostname; the hostname is a machine string and lives
 * on the policy's own page, in the fold, beside the origin it belongs to.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatGen } from "../../lib/config";
import { getPolicies, type Policy } from "../../lib/read";
import { StateNote, Status } from "../components/bits";
import { triggerSentence } from "../components/trigger";

type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "down"; why: string };

/** The data views. A tab is a question a reader arrives with, not a category
 *  of ours: what is live, what is being read, what has been decided. */
const TABS = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "investigating", label: "Under investigation" },
  { id: "determined", label: "Determined" },
  { id: "closed", label: "Closed" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function inTab(p: Policy, tab: TabId): boolean {
  switch (tab) {
    case "live":
      return p.status === "ACTIVE" || p.status === "DRAFT";
    case "investigating":
      return p.status === "INVESTIGATING" || p.status === "PENDING_FINALITY";
    case "determined":
      return p.status === "FINAL" || (p.outcome !== "" && p.status !== "PAID");
    case "closed":
      return p.status === "PAID" || p.status === "EXPIRED" || p.status === "CANCELLED";
    default:
      return true;
  }
}

const SORTS = [
  { id: "newest", label: "Newest" },
  { id: "coverage", label: "Coverage" },
  { id: "deadline", label: "Coverage ends" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

/* ── the row ─────────────────────────────────────────────────────────────── */

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

/** What the record currently says about the trigger, in words. A hue is
 *  attached to it and to nothing else on the row. */
function determination(p: Policy): { state: string; label: string } {
  if (p.outcome === "SATISFIED") return { state: "satisfied", label: "trigger met" };
  if (p.outcome === "NOT_SATISFIED") return { state: "not-satisfied", label: "trigger not met" };
  if (p.outcome === "UNDETERMINED") return { state: "undetermined", label: "undetermined" };
  if (p.status === "INVESTIGATING") return { state: "investigating", label: "reading evidence" };
  if (p.status === "PENDING_FINALITY") return { state: "pending-finality", label: "awaiting finality" };
  return { state: p.status.toLowerCase(), label: "no claim filed" };
}

/**
 * One policy, at a glance: the trigger it pays on, the money behind it, and
 * how many publishers must agree. The window, the origins and the rest of the
 * record are one click away on the policy's own page — this row is the way in,
 * not a second copy of it.
 */
function BookRow({ policy: p }: { policy: Policy }) {
  const d = determination(p);
  const publishers = (p.basis ?? []).filter((b) => b.class === "INDEPENDENT");
  /* The kinds, deduplicated and in the order the policy names them. This is
     the human fact the hostnames stand for; the hostnames themselves are
     machine strings and are not shown here. */
  const kinds = Array.from(new Set(publishers.map((b) => kindWords(b.kind))));

  return (
    <Link href={`/policies/${p.policy_id}`} className="policyrow">
      <div className="policyrow-head">
        <div style={{ minWidth: 0 }}>
          <div className="policyrow-title">{triggerSentence(p)}</div>
          <div className="policyrow-sub">
            {p.title} · {p.region}, {p.country}
          </div>
        </div>
        <div className="policyrow-badges">
          <span className="badge">{p.event_type.toLowerCase()}</span>
          <Status state={d.state} label={d.label} />
        </div>
      </div>

      <dl className="policyrow-metrics">
        <div className="rowmetric">
          <dt>Coverage</dt>
          <dd className="figure">{formatGen(p.coverage_atto)} GEN</dd>
        </div>
        <div className="rowmetric">
          <dt>Premium</dt>
          <dd className="figure">{formatGen(p.premium_atto)} GEN</dd>
        </div>
        {/* Publishers are COUNTED, never averaged: how many must agree, out of
            how many the policy names, and what kinds of body they are. */}
        <div className="rowmetric">
          <dt>Publishers must agree</dt>
          <dd className="fact">
            <span className="fact-main figure">
              {p.min_independent} of {publishers.length || "—"}
            </span>
            {kinds.length > 0 ? <span className="fact-qual">{kinds.join(" · ")}</span> : null}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default function PolicyBookPage() {
  const [book, setBook] = useState<Load<{ total: number; policies: Policy[] }>>({
    state: "loading",
  });
  const [tab, setTab] = useState<TabId>("all");
  const [event, setEvent] = useState<string>("any");
  const [sort, setSort] = useState<SortId>("newest");

  useEffect(() => {
    let live = true;
    getPolicies(0, 50)
      .then((d) => live && setBook({ state: "ok", data: d }))
      .catch((e) => live && setBook({ state: "down", why: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, []);

  const eventTypes = useMemo(() => {
    if (book.state !== "ok") return [];
    return Array.from(new Set(book.data.policies.map((p) => p.event_type))).sort();
  }, [book]);

  const shown = useMemo(() => {
    if (book.state !== "ok") return [];
    const rows = book.data.policies
      .filter((p) => inTab(p, tab))
      .filter((p) => event === "any" || p.event_type === event);
    /* "Newest" is the contract's own order, kept rather than re-sorted: the
       index appends, so its order IS the order they were written in. */
    const sorted = [...rows];
    if (sort === "coverage") {
      sorted.sort((a, b) => (BigInt(b.coverage_atto) > BigInt(a.coverage_atto) ? 1 : -1));
    } else if (sort === "deadline") {
      sorted.sort((a, b) => a.coverage_end_epoch - b.coverage_end_epoch);
    }
    return sorted;
  }, [book, tab, event, sort]);

  return (
    <main className="page">
      <header className="pagehead">
        <p className="eyebrow">the record</p>
        <h1 className="display">The policy book</h1>
        <p className="lede-line">
          Every policy this contract holds, and what the record says about each.
        </p>
      </header>

      {/* the views, and the one action the page offers */}
      <div className="toolbar">
        <nav className="tabs" aria-label="Policy views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? "tab on" : "tab"}
              onClick={() => setTab(t.id)}
              aria-pressed={t.id === tab}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <Link href="/create" className="pill primary">
          Write a policy
        </Link>
      </div>

      {/* filters left, counts right. The two counts answer different questions
          and say so with their labels; "—" is unknown, never zero. */}
      <div className="toolbar">
        <label className="control">
          <span className="control-label">Event</span>
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="any">Any</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          <span className="control-label">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortId)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <div className="pair">
          <span className="pair-label">In this view</span>
          <span className="pair-value">{book.state === "ok" ? shown.length : "—"}</span>
        </div>
        <div className="pair">
          <span className="pair-label">On this contract</span>
          <span className="pair-value">{book.state === "ok" ? book.data.total : "—"}</span>
        </div>
      </div>

      {/* three states, three shapes: a read that failed must never render as a
          book with nothing in it. */}
      {book.state === "loading" && <p className="empty">Reading…</p>}
      {book.state === "down" && (
        <StateNote kind="unreachable">
          The policy book could not be read just now — the network between you and the
          contract, not the record itself.
        </StateNote>
      )}
      {book.state === "ok" && shown.length === 0 && (
        <p className="empty">
          {book.data.total === 0 ? "No policy written yet." : "No policy in this view."}
        </p>
      )}
      {book.state === "ok" && shown.length > 0 && (
        <div className="policyrows">
          {shown.map((p) => (
            <BookRow key={p.policy_id} policy={p} />
          ))}
        </div>
      )}
    </main>
  );
}
