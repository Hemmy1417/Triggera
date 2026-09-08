"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatGen } from "../lib/config";
import { getStats, type Stats } from "../lib/read";
import { ThresholdScale } from "./components/ThresholdScale";

type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "down"; why: string };

export default function Landing() {
  const [stats, setStats] = useState<Load<Stats>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    getStats()
      .then((d) => live && setStats({ state: "ok", data: d }))
      .catch((e) => live && setStats({ state: "down", why: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="page">
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

      {/* The record itself lives at /policies. The landing page makes the
          argument and points at it, rather than being two pages at once. */}
      <section className="closer">
        <p className="eyebrow">the record</p>
        <p className="subheading" style={{ marginTop: 8, maxWidth: "44ch" }}>
          {stats.state === "ok" && stats.data.policies > 0
            ? `${stats.data.policies} ${stats.data.policies === 1 ? "policy has" : "policies have"} been written on this contract, with every claim, reading and determination each has drawn.`
            : "Every policy written on this contract, with every claim, reading and determination it has drawn."}
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
          <Link href="/policies" className="pill primary">
            Read the policy book
          </Link>
          <Link href="/create" className="pill">
            Write a policy
          </Link>
        </div>
      </section>
    </main>
  );
}
