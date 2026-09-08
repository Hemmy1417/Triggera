"use client";

/**
 * THE POLICY BOOK — every policy the contract holds, as its own route.
 *
 * The landing page opens with the claim and shows the same rows underneath
 * it. This is where the nav points, so it opens with the book and nothing
 * else: a reader who came here to look something up is not made to read a
 * pitch first.
 *
 * The views, the filters and the row are deliberately the SAME machinery as
 * the landing page's rather than a second, thinner listing. Two listings of
 * one book drift apart, and the moment they do the record has two versions
 * of itself. The landing page is left untouched; the shared parts are copied
 * whole, not imported out of it, so neither page can break the other.
 *
 * The count in the header is the contract's own total — not the length of
 * whatever this view has filtered, which is reported separately in the
 * toolbar so the two numbers can never be mistaken for each other.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getPolicies, type Policy } from "../../lib/read";
import { StateNote } from "../components/bits";
import { PolicyRow } from "../components/PolicyRow";

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
      <header>
        <p className="eyebrow">the record</p>
        <h1 className="display" style={{ marginTop: "var(--gap-tight)" }}>
          The policy book
        </h1>
        <p className="body muted measure" style={{ marginTop: "var(--gap-tight)" }}>
          Every policy written on this contract: the trigger it pays on, the money behind
          it, who its evidence may come from, and whatever the record currently says about
          it.
        </p>
        <p className="body-sm muted" style={{ marginTop: "var(--gap-tight)" }}>
          {book.state === "ok" ? (
            <>
              <span className="figure">{book.data.total}</span>{" "}
              {book.data.total === 1 ? "policy has" : "policies have"} been written here.
            </>
          ) : book.state === "loading" ? (
            <>Counting what the contract holds…</>
          ) : (
            <>The count could not be read, so it is unknown rather than zero.</>
          )}
        </p>
      </header>

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
            {shown.length} of {book.data.total} shown
          </span>
        )}
      </div>

      {/* three states, three sentences: a read that failed must never render
          as a book with nothing in it. */}
      {book.state === "loading" && (
        <StateNote kind="loading">Reading the policy book from the contract…</StateNote>
      )}
      {book.state === "down" && (
        <StateNote kind="unreachable">
          The policy book could not be read just now. This is the network between you and
          the contract, not the record itself.
        </StateNote>
      )}
      {book.state === "ok" && shown.length === 0 && (
        <StateNote kind="empty">
          {book.data.total === 0 ? (
            <>
              No policy has been written on this contract yet.{" "}
              <Link href="/create" className="ghost">
                Write the first
              </Link>
              .
            </>
          ) : (
            <>
              No policy matches this view. Widen it, or{" "}
              <Link href="/create" className="ghost">
                write one
              </Link>
              .
            </>
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
