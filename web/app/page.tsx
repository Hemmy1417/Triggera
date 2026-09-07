"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatGen } from "../lib/config";
import { getPolicies, getStats, type Policy, type Stats } from "../lib/read";
import { Stat, StateNote, Status } from "./components/bits";

type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "down"; why: string };

/** A policy's headline, written from the trigger the two parties signed —
 *  the record's own words, never an id. */
function headline(p: Policy): string {
  const op =
    p.operator === "GTE" ? "at or above" :
    p.operator === "GT" ? "above" :
    p.operator === "LTE" ? "at or below" : "below";
  return `${p.metric} ${op} ${p.threshold} ${p.unit}`;
}

export default function Home() {
  const [stats, setStats] = useState<Load<Stats>>({ state: "loading" });
  const [latest, setLatest] = useState<Load<Policy[]>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    getStats()
      .then((d) => live && setStats({ state: "ok", data: d }))
      .catch((e) => live && setStats({ state: "down", why: String(e?.message ?? e) }));
    getPolicies(0, 6)
      .then((d) => live && setLatest({ state: "ok", data: d.policies }))
      .catch((e) => live && setLatest({ state: "down", why: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <section className="room-inner" style={{ paddingTop: 72 }}>
        <div className="grid two" style={{ gap: 48, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 24 }}>
            <span className="announce">Parametric verification on GenLayer</span>
            <h1 className="display">
              Reality, put to
              <br />
              consensus.
            </h1>
            <p className="subheading measure">
              A parametric policy names the condition that pays. When an event happens,
              every validator fetches the evidence itself and reads it. Deterministic
              code turns those readings into the determination, and the determination
              moves the coverage.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/policies" className="pill">
                Read the policy book
              </Link>
              <Link href="/create" className="pill quiet">
                Write a policy
              </Link>
            </div>
          </div>

          <div className="card">
            <span className="eyebrow">On the contract now</span>
            <div style={{ marginTop: 24 }}>
              {stats.state === "loading" && (
                <StateNote kind="loading">Reading the contract…</StateNote>
              )}
              {stats.state === "down" && (
                <StateNote kind="unreachable">
                  The contract could not be reached just now. This is the network, not
                  the record: nothing here is empty, it is unread.
                </StateNote>
              )}
              {stats.state === "ok" && (
                <div className="stat-grid">
                  <Stat
                    label="Coverage in custody"
                    value={formatGen(stats.data.escrow_atto)}
                    unit="GEN"
                  />
                  <Stat label="Policies written" value={stats.data.policies} />
                  <Stat label="Investigations run" value={stats.data.investigations} />
                  <Stat
                    label="Paid on triggers"
                    value={formatGen(stats.data.paid_atto)}
                    unit="GEN"
                  />
                </div>
              )}
            </div>
            <p className="caption muted" style={{ marginTop: 24 }}>
              Live from GenLayer Studio Next. Custody is every locked coverage and
              unclaimed balance.
            </p>
          </div>
        </div>
      </section>

      <section className="room">
        <div className="room-inner">
          <h2 className="heading">Why a panel, not an oracle.</h2>
          <div className="grid two" style={{ marginTop: 48 }}>
            <div className="window">
              <div className="window-bar">
                <i className="window-dot" />
                <span className="eyebrow">A conventional oracle</span>
              </div>
              <div className="window-body">
                <div className="muted">one source</div>
                <div className="muted">↓</div>
                <div className="muted">a value</div>
                <div className="muted">↓</div>
                <div className="muted">the contract pays</div>
                <p className="body-sm muted" style={{ marginTop: 16, fontFamily: "var(--sans)" }}>
                  Whoever controls the source controls the payout, and a source that
                  disagrees with another has nowhere to be reconciled.
                </p>
              </div>
            </div>
            <div className="window">
              <div className="window-bar">
                <i className="window-dot" style={{ background: "var(--iris)" }} />
                <span className="eyebrow">Triggera</span>
              </div>
              <div className="window-body">
                <div>several publishers, agreed in advance</div>
                <div className="muted">↓</div>
                <div>every validator fetches and reads each one</div>
                <div className="muted">↓</div>
                <div>one voice per publisher, never an average</div>
                <div className="muted">↓</div>
                <div>code derives the determination</div>
                <p className="body-sm muted" style={{ marginTop: 16, fontFamily: "var(--sans)" }}>
                  When the publishers genuinely disagree, the protocol is allowed to say
                  so: an undetermined record holds the money instead of guessing.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="room">
        <div className="room-inner">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24, flexWrap: "wrap" }}>
            <h2 className="heading-sm">Latest policies</h2>
            <Link href="/policies" className="ghost">
              All policies →
            </Link>
          </div>
          <div style={{ marginTop: 24 }}>
            {latest.state === "loading" && (
              <StateNote kind="loading">Reading the policy book…</StateNote>
            )}
            {latest.state === "down" && (
              <StateNote kind="unreachable">
                The policy book could not be reached just now.
              </StateNote>
            )}
            {latest.state === "ok" && latest.data.length === 0 && (
              <StateNote kind="empty">
                No policy has been written on this contract yet.{" "}
                <Link href="/create" className="ghost">Write the first</Link>.
              </StateNote>
            )}
            {latest.state === "ok" && latest.data.length > 0 && (
              <div className="tablewrap">
                <table className="rows">
                  <thead>
                    <tr>
                      <th>Policy</th>
                      <th>Trigger</th>
                      <th>Status</th>
                      <th className="num">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.data.map((p) => (
                      <tr key={p.policy_id}>
                        <td>
                          <Link href={`/policies/${p.policy_id}`} className="title">
                            {p.title}
                          </Link>
                          <div className="caption muted">
                            {p.region}, {p.country}
                          </div>
                        </td>
                        <td className="body-sm">{headline(p)}</td>
                        <td>
                          <Status state={p.status} />
                        </td>
                        <td className="num">{formatGen(p.coverage_atto)} GEN</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
