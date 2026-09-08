"use client";

/**
 * HOW IT WORKS — the reference, not a pitch.
 *
 * The design brief puts "why a panel, not an oracle" here rather than on the
 * landing page, and asks for it DEMONSTRATED. So the middle of this page is a
 * worked example with numbers: a record where the average pays and the
 * publisher count does not.
 *
 * This is the one route allowed more than a single sentence, because it
 * explains the mechanism. It still says things with structure rather than
 * paragraphs: short titled blocks, label-over-value pairs, and tables that
 * are read down a column instead of along a sentence.
 *
 * Every claim here is a claim about contracts/triggera.py, written from the
 * code rather than from memory: the derivation rules are _derive_outcome, the
 * state transitions are the write methods' own guards, and the bond
 * arithmetic is _bond_for.
 *
 * The worked example names the KIND of each publisher. The hostnames those
 * kinds stand for are machine values, so they live in the technical fold at
 * the foot of that card and never on the page face.
 */

import Link from "next/link";
import { Status } from "../components/bits";


/** Text diagrams keep their own scroll rather than pushing the page sideways:
 *  at 375px the terminal window scrolls, the layout does not. */
const PRE: React.CSSProperties = {
  margin: 0,
  font: "inherit",
  whiteSpace: "pre",
  overflowX: "auto",
};

const DERIVATION = `record not sufficient
  -> undetermined, evidence insufficient

publishers with a usable reading < required
  -> undetermined, uncorroborated

a majority of publishers past the threshold
  -> trigger met

a majority short of it
  -> trigger not met

an exact split
  -> undetermined, split evidence`;


/** The determinations, and what each one moves. UNDETERMINED is a peer of the
 *  other two here, never a failure and never hidden. */
const OUTCOMES: Array<{
  state: string;
  label: string;
  means: string;
  moves: string;
}> = [
  {
    state: "satisfied",
    label: "trigger met",
    means:
      "A majority of the independent publishers that stated a usable reading read past the threshold, over a sufficient record.",
    moves:
      "Anyone may settle once the appeal window closes. The whole coverage is credited to the policyholder.",
  },
  {
    state: "not-satisfied",
    label: "trigger not met",
    means: "A majority of those publishers read short of the threshold, over a sufficient record.",
    moves:
      "Nothing moves. The policy returns to active for the rest of its period, and a later event may still be claimed.",
  },
  {
    state: "undetermined",
    label: "undetermined",
    means: "The record does not support a conclusive reading, and the protocol will not guess.",
    moves:
      "Nothing moves, and a hold is not a denial. A better claim may be filed inside the claim grace; after it, the insurer may reclaim the coverage.",
  },
];




export default function Rules() {
  return (
    <main className="page book">
      <section>
        <div className="pagehead">
          <h1 className="heading">How it works</h1>
          <p className="lede-line">
            A policy pays on what independent publishers state, counted one publisher at a time and
            never averaged.
          </p>
        </div>

        <div className="metricstrip">
          <span className="metric">
            <span className="metric-label">The panel returns</span>
            <span className="metric-value">readings</span>
          </span>
          <span className="metric">
            <span className="metric-label">The determination is derived by</span>
            <span className="metric-value">code</span>
          </span>
          <span className="metric">
            <span className="metric-label">One voice per</span>
            <span className="metric-value">publisher</span>
          </span>
          <span className="metric">
            <span className="metric-label">Value leaves through</span>
            <span className="metric-value">one method</span>
          </span>
        </div>
      </section>

      {/* ── what is asked, and what derives the answer ──────────────────── */}
      <section className="grid two">
        <div className="card">
          <div className="card-head">
            <span className="card-title">What the panel is asked</span>
            <span className="chip">Every validator fetches each source itself</span>
          </div>
          <dl className="factlist stacked">
            <div>
              <dt>Per source</dt>
              <dd className="sm">
                One whole-number reading for the insured area over a window of the agreed length, or
                nothing. Then three yes-or-no checks: the window, the area, and whether the page is
                what its agreed label says.
              </dd>
            </div>
            <div>
              <dt>For the record</dt>
              <dd className="sm">
                Whether it establishes what the metric did, which material contradictions it shows,
                and how confident the panel is.
              </dd>
            </div>
            <div>
              <dt>Never asked</dt>
              <dd className="sm">Whether the trigger was met, or what anyone is owed.</dd>
            </div>
            <div>
              <dt>Answer shape</dt>
              <dd className="sm">
                Fixed. Words of the panel&apos;s own are refused at the boundary, before they can
                become a record.
              </dd>
            </div>
          </dl>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">What derives the determination</span>
            <span className="chip">Deterministic code, in every validator</span>
          </div>
          <div className="window">
            <div className="window-bar">
              <i className="window-dot" style={{ background: "var(--iris)" }} />
              <span className="eyebrow">the derivation, in order</span>
            </div>
            <div className="window-body">
              <pre style={PRE}>{DERIVATION}</pre>
            </div>
          </div>
          <dl className="factlist stacked" style={{ marginTop: 28 }}>
            <div>
              <dt>Consensus is reached on this</dt>
              <dd className="sm">
                A validator that agrees with the leader about the readings but re-derives a
                different outcome refuses the round.
              </dd>
            </div>
            <div>
              <dt>A usable source</dt>
              <dd className="sm">
                Independent of both parties, readable this round, right window, right area, what its
                label says, and a sane number.
              </dd>
            </div>
            <div>
              <dt>A party&apos;s own source</dt>
              <dd className="sm">Never enters this arithmetic.</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── the three determinations ────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <span className="card-title">The three determinations</span>
        </div>
        <div className="tablewrap">
          <table className="rows">
            <thead>
              <tr>
                <th>Determination</th>
                <th>What it means</th>
                <th>What moves</th>
              </tr>
            </thead>
            <tbody>
              {OUTCOMES.map((o) => (
                <tr key={o.label}>
                  <td>
                    <Status state={o.state} label={o.label} />
                  </td>
                  <td className="body-sm">{o.means}</td>
                  <td className="body-sm muted">{o.moves}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── money and windows ───────────────────────────────────────────── */}
      <section>
        <div className="card">
          <div className="card-head">
            <span className="card-title">Where the money is</span>
          </div>
          <div className="pairs two">
            <div className="pair">
              <span className="pair-label">The coverage</span>
              <span className="pair-value">Held whole</span>
              <span className="pair-note">
                Deposited by the insurer in the signature that writes the policy. It leaves in two
                ways only: all of it to the policyholder on a finalized met trigger, or all of it
                back to the insurer on the expiry reclaim.
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">The premium</span>
              <span className="pair-value">Earned on activation</span>
              <span className="pair-note">
                It buys the cover, not the outcome, and no determination refunds it.
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">The appeal bond</span>
              <span className="pair-value lg">
                5%<span className="unit">of the coverage</span>
              </span>
              <span className="pair-note">
                Never below 0.05 GEN. It returns only if the second panel reaches a different
                outcome; where the outcome stands, it goes to the party that carried the delay.
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">Getting paid</span>
              <span className="pair-value">Pull, never push</span>
              <span className="pair-note">
                Every credit lands in a ledger balance, and one method moves value out of the
                contract, called by the party the balance belongs to.
              </span>
            </div>
          </div>
        </div>

      </section>

      <section className="card tight">
        <p className="body">
          The rules above are the contract&apos;s, and the record is where they are visible.{" "}
          <Link href="/policies" className="ghost">Read the policy book</Link>, or{" "}
          <Link href="/create" className="ghost">write a policy</Link>.
        </p>
      </section>
    </main>
  );
}
