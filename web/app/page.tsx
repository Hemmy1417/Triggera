"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatGen } from "../lib/config";
import { getPolicies, getStats, type Policy, type Stats } from "../lib/read";
import { StateNote, Status } from "./components/bits";
import { PolicyRow } from "./components/PolicyRow";
import { ThresholdScale } from "./components/ThresholdScale";

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
      {/* The claim, and the protocol's live state beside it. The right half
          is data rather than decoration: what a reader wants to know first is
          whether anything is actually running. */}
      <section className="lede">
        <div>
          <p className="eyebrow">parametric insurance verification</p>
          <h1 className="lede-claim">
            The policy sets the rule.
            <br />
            Reality is investigated.
            <br />
            <em>Consensus settles it.</em>
          </h1>
          <p className="body muted measure" style={{ marginTop: 20 }}>
            A panel of validators fetches the agreed sources itself and reports what each
            one says. Deterministic code counts the publishers and moves the coverage. No
            adjuster, no single oracle, and no average.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            <Link href="/create" className="pill primary">
              Write a policy
            </Link>
            <Link href="/rules" className="pill">
              How it decides
            </Link>
          </div>
        </div>

        <div className="bento lede-live">
          <div className="card tight w3">
            <p className="stat-label">Coverage in custody</p>
            <p className="big-figure">
              {stats.state === "ok" ? formatGen(stats.data.escrow_atto) : "—"}
              <span className="stat-unit"> GEN</span>
            </p>
          </div>
          <div className="card tight w3">
            <p className="stat-label">Paid on triggers</p>
            <p className="big-figure">
              {stats.state === "ok" ? formatGen(stats.data.paid_atto) : "—"}
              <span className="stat-unit"> GEN</span>
            </p>
          </div>
          <div className="card tight w2">
            <p className="stat-label">Policies</p>
            <p className="big-figure">{stats.state === "ok" ? stats.data.policies : "—"}</p>
          </div>
          <div className="card tight w2">
            <p className="stat-label">Investigations</p>
            <p className="big-figure">{stats.state === "ok" ? stats.data.investigations : "—"}</p>
          </div>
          <div className="card tight w2">
            <p className="stat-label">Triggers met</p>
            <p className="big-figure">{stats.state === "ok" ? stats.data.satisfied : "—"}</p>
          </div>
          {stats.state === "down" ? (
            <p className="caption w6" style={{ color: "var(--bone)" }}>
              The contract could not be reached just now. These are unread, not zero.
            </p>
          ) : null}
        </div>
      </section>

      {/* The mechanism, drawn. One record, the readings placed against the
          threshold that decides them. */}
      <section className="card proof">
        <p className="eyebrow">how a determination is reached</p>
        <p className="subheading" style={{ marginTop: 8, maxWidth: "46ch" }}>
          Rainfall at or above 120 mm, read by three independent publishers and the
          policyholder&apos;s own gauge.
        </p>
        <ThresholdScale
          operator="GTE"
          threshold={120}
          unit="mm"
          nodes={[
            { publisher: "agency.example.gov", reading: 96, contradicting: true },
            { publisher: "weather.example.com", reading: 101, contradicting: true },
            { publisher: "satellite.example.org", reading: 318, qualifying: true },
            { publisher: "holder.example.net", reading: 240, party: true },
          ]}
        />
        <p className="body-sm muted" style={{ maxWidth: "62ch" }}>
          Averaged, this record pays: the mean clears the threshold on the strength of one
          outlier and one interested party. Counted a publisher at a time, one of three is
          past it and the trigger is not met. The hollow node is the policyholder&apos;s own
          gauge, which is shown and never counted.{" "}
          <Link href="/rules" className="ghost">
            The full derivation
          </Link>
        </p>
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
