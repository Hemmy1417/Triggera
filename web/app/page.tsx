"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatGen } from "../lib/config";
import { getStats, type Stats } from "../lib/read";
import { Dot, Ident, StateNote, Technical } from "./components/bits";
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

  const ok = stats.state === "ok";

  return (
    <main className="page">
      {/* The claim, and the protocol's live state beside it. The right half is
          data rather than decoration: a reader wants to know first whether
          anything is actually running. */}
      <section className="lede">
        <div className="stack">
          <div>
            <p className="eyebrow">parametric insurance verification</p>
            <h1 className="lede-claim" style={{ marginTop: 16 }}>
              The policy sets the rule.
              <br />
              Reality is investigated.
              <br />
              <em>Consensus settles it.</em>
            </h1>
          </div>
          <p className="lede-line">
            A panel of validators reads the agreed sources; deterministic code counts the
            publishers and moves the coverage.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/create" className="pill primary">
              Write a policy
            </Link>
            <Link href="/rules" className="pill">
              How it decides
            </Link>
          </div>
        </div>

        <div className="lede-live stack">
          <div className="card lifted">
            <div className="pairs two">
              <div className="pair">
                <span className="pair-label">Coverage in custody</span>
                <span className="pair-value lg">
                  {ok ? formatGen(stats.data.escrow_atto) : "—"}
                  <span className="unit">GEN</span>
                </span>
              </div>
              <div className="pair">
                <span className="pair-label">Paid on triggers</span>
                <span className="pair-value lg">
                  {ok ? formatGen(stats.data.paid_atto) : "—"}
                  <span className="unit">GEN</span>
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="pairs three tight">
              <div className="pair">
                <span className="pair-label">Policies</span>
                <span className="pair-value lg">{ok ? stats.data.policies : "—"}</span>
              </div>
              <div className="pair">
                <span className="pair-label">Investigations</span>
                <span className="pair-value lg">{ok ? stats.data.investigations : "—"}</span>
              </div>
              <div className="pair">
                <span className="pair-label">Triggers met</span>
                <span className="pair-value lg">{ok ? stats.data.satisfied : "—"}</span>
              </div>
            </div>
          </div>

          {/* A failed read must never render as an empty record. */}
          {stats.state === "down" ? (
            <StateNote kind="unreachable">
              The contract could not be reached — these figures are unread, not zero.
            </StateNote>
          ) : null}
        </div>
      </section>

      {/* The mechanism, drawn. One record, the readings placed against the
          threshold that decides them. The chart argues; the pairs under it
          state the derivation without a paragraph. */}
      <section className="card proof">
        <div className="card-head">
          <p className="card-title">How a determination is reached</p>
          <Link href="/rules" className="ghost">
            The full derivation
          </Link>
        </div>

        <div className="stack">
          <div className="pairs three tight">
            <div className="pair">
              <span className="pair-label">Trigger</span>
              <span className="pair-value">Rainfall 120 mm or more</span>
            </div>
            <div className="pair">
              <span className="pair-label">Publishers counted</span>
              <span className="pair-value">3</span>
              <span className="pair-note">independent, one voice each</span>
            </div>
            <div className="pair">
              <span className="pair-label">Policyholder&apos;s gauge</span>
              <span className="pair-value muted">Shown, never counted</span>
            </div>
          </div>

          {/* The publisher KIND is what the reader needs; the host string is
              plumbing and lives in the fold below. */}
          <div>
            <ThresholdScale
              operator="GTE"
              threshold={120}
              unit="mm"
              nodes={[
                { publisher: "State agency", reading: 96, contradicting: true },
                { publisher: "Weather service", reading: 101, contradicting: true },
                { publisher: "Satellite", reading: 318, qualifying: true },
                { publisher: "Policyholder", reading: 240, party: true },
              ]}
            />
          </div>

          {/* The counterfactual is the whole point of the picture: an average
              would pay here. The contract counts publishers, so it does not. */}
          <div className="pairs three tight">
            <div className="pair">
              <span className="pair-label">If averaged</span>
              <span className="pair-value muted">Would pay</span>
              <span className="pair-note">on one outlier and one interested party</span>
            </div>
            <div className="pair">
              <span className="pair-label">Counted by publisher</span>
              <span className="count">
                <span className="big-figure">1</span>
                <span className="of">of 3 past the line</span>
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">Determination</span>
              <span className="verdict">
                <Dot state="NOT_SATISFIED" />
                Not satisfied
              </span>
            </div>
          </div>
        </div>

        <Technical
          summary="The worked example"
          rows={[
            ["Trigger", "rainfall_mm GTE 120"],
            ["State agency", <Ident key="a" value="agency.example.gov" />],
            ["Weather service", <Ident key="b" value="weather.example.com" />],
            ["Satellite", <Ident key="c" value="satellite.example.org" />],
            ["Policyholder", <Ident key="d" value="holder.example.net" />],
          ]}
        />
      </section>

      {/* The record itself lives at /policies. The landing page makes the
          argument and points at it, rather than being two pages at once. */}
      <section className="closer">
        <div className="section-head">
          <p className="eyebrow">the record</p>
          <p className="subheading">
            Every policy, claim, reading and determination this contract has drawn.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
