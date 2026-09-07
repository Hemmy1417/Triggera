"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatGen } from "../lib/config";
import { getPolicies, getStats, type Policy, type Stats } from "../lib/read";
import { StateNote, Status } from "./components/bits";
import { PolicyRow } from "./components/PolicyRow";

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

export default function PolicyBook() {
  const [stats, setStats] = useState<Load<Stats>>({ state: "loading" });
  const [book, setBook] = useState<Load<{ total: number; policies: Policy[] }>>({
    state: "loading",
  });
  const [tab, setTab] = useState<TabId>("all");
  const [event, setEvent] = useState<string>("any");
  const [sort, setSort] = useState<SortId>("newest");

  useEffect(() => {
    let live = true;
    getStats()
      .then((d) => live && setStats({ state: "ok", data: d }))
      .catch((e) => live && setStats({ state: "down", why: String(e?.message ?? e) }));
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
    const sorted = [...rows];
    if (sort === "coverage") {
      sorted.sort((a, b) => (BigInt(b.coverage_atto) > BigInt(a.coverage_atto) ? 1 : -1));
    } else if (sort === "deadline") {
      sorted.sort((a, b) => a.coverage_end_epoch - b.coverage_end_epoch);
    }
    return sorted;
  }, [book, tab, event, sort]);

  return (
    <main className="page book">
      {/* the metric strip: dense, inline, above the record — never a hero */}
      <section className="metricstrip">
        {stats.state === "loading" && <span className="caption muted">Reading the contract…</span>}
        {stats.state === "down" && (
          <span className="caption" style={{ color: "var(--bone)" }}>
            The contract could not be reached just now. Nothing below is empty; it is unread.
          </span>
        )}
        {stats.state === "ok" && (
          <>
            <span className="metric">
              <span className="metric-label">Coverage in custody</span>
              <span className="metric-value">{formatGen(stats.data.escrow_atto)} GEN</span>
            </span>
            <span className="metric">
              <span className="metric-label">Policies</span>
              <span className="metric-value">{stats.data.policies}</span>
            </span>
            <span className="metric">
              <span className="metric-label">Investigations</span>
              <span className="metric-value">{stats.data.investigations}</span>
            </span>
            <span className="metric">
              <span className="metric-label">Triggers met</span>
              <span className="metric-value">{stats.data.satisfied}</span>
            </span>
            <span className="metric">
              <span className="metric-label">Paid out</span>
              <span className="metric-value">{formatGen(stats.data.paid_atto)} GEN</span>
            </span>
          </>
        )}
      </section>

      {/* tabs switch the data view */}
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
        <Link href="/create" className="pill" style={{ marginLeft: "auto" }}>
          Write a policy
        </Link>
      </nav>

      {/* the control surface: filters and sort are first-class */}
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
        {book.state === "ok" && (
          <span className="caption muted" style={{ marginLeft: "auto" }}>
            {shown.length} of {book.data.total}
          </span>
        )}
      </div>

      {book.state === "loading" && <StateNote kind="loading">Reading the policy book…</StateNote>}
      {book.state === "down" && (
        <StateNote kind="unreachable">
          The policy book could not be read. This is the network, not the record.
        </StateNote>
      )}
      {book.state === "ok" && shown.length === 0 && (
        <StateNote kind="empty">
          {book.data.total === 0 ? (
            <>
              No policy has been written on this contract yet.{" "}
              <Link href="/create" className="ghost">Write the first</Link>.
            </>
          ) : (
            <>No policy matches this view.</>
          )}
        </StateNote>
      )}
      {book.state === "ok" && shown.length > 0 && (
        <div className="policyrows">
          {shown.map((p) => (
            <PolicyRow key={p.policy_id} policy={p} />
          ))}
        </div>
      )}
    </main>
  );
}

/** Re-exported so the row can render a status without importing twice. */
export { Status };
