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
import { Ident, Status, Technical } from "../components/bits";

const DOCS = "https://github.com/Hemmy1417/Triggera/blob/main/docs";

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

const LIFECYCLE_DIAGRAM = `draft
  | the premium is paid
  v
active <--------------------+
  | a claim is filed        |
  v                         |
investigating               |
  | the panel round runs    |
  v                         |
pending finality            | undetermined,
  | the finality window     | or trigger not met
  | passes, anyone promotes |
  +-------------------------+
  |
  v
final
  | the appeal window runs
  |   +-- appealed --> re-investigated --> pending finality
  |   +-- lapsed after an hour --> the snapshot is restored
  v it closes, anyone settles
paid

active -- the cover and its claim grace pass --> expired`;

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

/** The three holds, in the same words the policy record uses. */
const HOLDS: Array<[string, string]> = [
  [
    "the record does not establish what the metric did in the insured area",
    "The evidence was judged less than sufficient, so no count is run at all — and an outcome derived over an insufficient record cannot settle.",
  ],
  [
    "fewer independent publishers than the policy requires stated a usable reading",
    "Too few publishers spoke. An unreachable page, the wrong window, the wrong place, or a page that is not what its agreed label says all leave a publisher silent rather than counted.",
  ],
  [
    "the publishers divided exactly, and the protocol will not break a tie by guessing",
    "An even split. Neither side has a majority, so neither side wins; the claim can be refiled while the grace runs.",
  ],
];

/** The worked example. The KIND is what the page shows; the host is a machine
 *  value and belongs in the fold beneath the table. */
const EXAMPLE: Array<{
  page: string;
  kind: string;
  host: string;
  reading: string;
  verdict?: { state: string; label: string };
  note?: string;
}> = [
  {
    page: "district gauge summary",
    kind: "Meteorological agency",
    host: "agency.example.gov",
    reading: "96 mm",
    verdict: { state: "contradicting", label: "short of it" },
  },
  {
    page: "seasonal bulletin",
    kind: "Meteorological agency",
    host: "agency.example.gov",
    reading: "104 mm",
    note: "the same voice, not a second one — heard at 96 mm, its least trigger-favourable page",
  },
  {
    page: "station observation",
    kind: "Weather service",
    host: "weather.example.com",
    reading: "101 mm",
    verdict: { state: "contradicting", label: "short of it" },
  },
  {
    page: "catchment report",
    kind: "Satellite observatory",
    host: "satellite.example.org",
    reading: "318 mm",
    verdict: { state: "qualifying", label: "meets it" },
  },
  {
    page: "the policyholder's own rain log",
    kind: "The policyholder",
    host: "holder.example.net",
    reading: "240 mm",
    note: "a party's own source — informs only, never counts",
  },
];

/** The lifecycle: who may move each state on, and what happens if nobody
 *  does. Every state has a permissionless exit — that is the property the
 *  table exists to show. */
const LIFECYCLE: Array<{
  state: string;
  label: string;
  who: string;
  ifNobody: string;
}> = [
  {
    state: "draft",
    label: "draft",
    who: "Anyone may become the policyholder by paying exactly the premium. Only the insurer may cancel.",
    ifNobody: "It stays a draft, and the coverage is the insurer's to withdraw until someone pays.",
  },
  {
    state: "active",
    label: "active",
    who: "The policyholder files a claim: a finished event window inside the cover, their claimed reading, and pages from the frozen basis.",
    ifNobody:
      "After the cover and its claim grace, anyone may expire the policy and the whole coverage returns to the insurer.",
  },
  {
    state: "investigating",
    label: "investigating",
    who: "Anyone may run the investigation, at most once per claim version. It is never hostage to one party's availability.",
    ifNobody:
      "The claim grace still runs out, once an uninvestigated claim has had a full finality window to be read.",
  },
  {
    state: "pending-finality",
    label: "pending finality",
    who: "Nobody. The decision is recorded, assigns nothing, and waits out the finality window.",
    ifNobody: "After the window, anyone may promote it — the call that turns a record into state.",
  },
  {
    state: "final",
    label: "final",
    who: "Either party may appeal inside the appeal window, with a bond and at most one new source from the agreed basis.",
    ifNobody:
      "After the appeal window, anyone may settle: a met trigger pays, an unmet one returns the policy to active.",
  },
  {
    state: "investigating",
    label: "appeal open",
    who: "Anyone may run the re-investigation. It re-reads the recorded bytes of the appealed round and fetches live only what the appellant added.",
    ifNobody:
      "An hour after filing, anyone may lapse the appeal: the snapshot taken at filing is restored exactly and the bond returns.",
  },
  {
    state: "paid",
    label: "paid",
    who: "The policyholder withdraws from their own ledger balance.",
    ifNobody: "The balance waits. It is theirs, and nothing expires it.",
  },
  {
    state: "expired",
    label: "expired",
    who: "The insurer withdraws the returned coverage from their own ledger balance.",
    ifNobody: "The same: the balance waits, and nothing expires it.",
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

        <div className="card-head" style={{ marginTop: 48 }}>
          <span className="card-title">A hold names its reason, and there are three</span>
        </div>
        <div className="tablewrap">
          <table className="rows">
            <thead>
              <tr>
                <th>The reason, as the record states it</th>
                <th>What produced it</th>
              </tr>
            </thead>
            <tbody>
              {HOLDS.map(([reason, why]) => (
                <tr key={reason}>
                  <td className="body-sm">{reason}</td>
                  <td className="body-sm muted">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── one voice per publisher, demonstrated ───────────────────────── */}
      <section className="card">
        <div className="card-head">
          <span className="card-title">Why a panel, and not an oracle</span>
        </div>

        <div className="pairs three">
          <div className="pair">
            <span className="pair-label">Trigger</span>
            <span className="pair-value lg">
              120<span className="unit">mm</span>
            </span>
            <span className="pair-note">rainfall, at or above</span>
          </div>
          <div className="pair">
            <span className="pair-label">Pages the parties agreed to read</span>
            <span className="pair-value lg">5</span>
            <span className="pair-note">one of them a party&apos;s own</span>
          </div>
          <div className="pair">
            <span className="pair-label">Independent publishers</span>
            <div className="count">
              <span className="big-figure">3</span>
              <span className="of">across 4 independent pages</span>
            </div>
            <span className="pair-note">two pages, one voice</span>
          </div>
        </div>

        <div className="tablewrap" style={{ marginTop: 48 }}>
          <table className="rows">
            <thead>
              <tr>
                <th>Page</th>
                <th>Publisher</th>
                <th className="num">Reading</th>
                <th>How it counts</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLE.map((r) => (
                <tr key={r.page}>
                  <td className="body-sm">{r.page}</td>
                  <td>
                    <span className="chip">{r.kind}</span>
                  </td>
                  <td className="num">{r.reading}</td>
                  <td className="body-sm">
                    {r.verdict ? (
                      <Status state={r.verdict.state} label={r.verdict.label} />
                    ) : (
                      <span className="muted">{r.note}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid two" style={{ marginTop: 48 }}>
          <div className="tile quiet">
            <div className="pair">
              <span className="pair-label">If the readings were averaged</span>
              <span className="pair-value lg">
                171.8<span className="unit">mm</span>
              </span>
              <span className="pair-note">
                154.75 mm across the four independent pages alone. Either average clears 120, on the
                strength of one outlier and one interested party.
              </span>
              <Status state="satisfied" label="trigger met" />
            </div>
          </div>
          <div className="tile">
            <div className="pair">
              <span className="pair-label">Counted one publisher at a time</span>
              <div className="count">
                <span className="big-figure">1</span>
                <span className="of">of 3 publishers past the threshold</span>
              </div>
              <span className="pair-note">
                96, 101 and 318 mm. The majority is short, so nothing moves and the policy stays
                live.
              </span>
              <Status state="not-satisfied" label="trigger not met" />
            </div>
          </div>
        </div>

        <p className="body-sm muted measure" style={{ marginTop: 28 }}>
          Four more pages from the same agency would change nothing: they are the same voice, and
          stacking pages can neither manufacture a second opinion nor improve the number a publisher
          is heard with.
        </p>

        <Technical
          summary="The example's sources"
          rows={EXAMPLE.map((r): [string, React.ReactNode] => [
            r.page,
            <Ident key={r.page} value={r.host} label="Copy host" />,
          ])}
        />
      </section>

      {/* ── the lifecycle ───────────────────────────────────────────────── */}
      <section className="grid two">
        <div className="window">
          <div className="window-bar">
            <i className="window-dot" style={{ background: "var(--iris)" }} />
            <span className="eyebrow">a policy&apos;s whole life</span>
          </div>
          <div className="window-body">
            <pre style={PRE}>{LIFECYCLE_DIAGRAM}</pre>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Nothing is anyone&apos;s to stall</span>
          </div>
          <dl className="factlist stacked">
            <div>
              <dt>A party may</dt>
              <dd className="sm">Start things, and appeal.</dd>
            </div>
            <div>
              <dt>A party may not</dt>
              <dd className="sm">
                Stop anything. Every state past the draft has an exit a stranger can take.
              </dd>
            </div>
            <div>
              <dt>The clock</dt>
              <dd className="sm">
                Read from several witnesses that must agree with each other. No clock, no write:
                every timed method fails closed rather than guessing the time.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Who may move each state on</span>
        </div>
        <div className="tablewrap">
          <table className="rows">
            <thead>
              <tr>
                <th>State</th>
                <th>Who moves it on</th>
                <th>If nobody does</th>
              </tr>
            </thead>
            <tbody>
              {LIFECYCLE.map((s) => (
                <tr key={s.label}>
                  <td>
                    <Status state={s.state} label={s.label} />
                  </td>
                  <td className="body-sm">{s.who}</td>
                  <td className="body-sm muted">{s.ifNobody}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── money and windows ───────────────────────────────────────────── */}
      <section className="grid two">
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

        <div className="card">
          <div className="card-head">
            <span className="card-title">Fees, and what &ldquo;finalized&rdquo; means here</span>
          </div>
          <div className="pairs two">
            <div className="pair">
              <span className="pair-label">Before the wallet opens</span>
              <span className="pair-value">Simulated</span>
              <span className="pair-note">
                The simulation sizes the fee and runs the method, so a write the contract would
                refuse fails there, in the contract&apos;s own words.
              </span>
            </div>
            <div className="pair">
              <span className="pair-label">The wallet&apos;s quote</span>
              <span className="pair-value">A ceiling</span>
              <span className="pair-note">
                The deposit sizes the round and is largely refunded; the cost settles far below it.
              </span>
            </div>
            <div className="pair wide">
              <span className="pair-label">Accepted is not finalized</span>
              <span className="pair-value">Said only when proven</span>
              <span className="pair-note">
                A read proving the new state is live means the write was accepted, which the chain
                can still walk back. This app says finalized only when the transaction itself
                reports finalized with a successful deciding execution, and says so plainly where it
                cannot prove that yet.
              </span>
            </div>
          </div>
          <Technical
            summary="Where to read the rest"
            rows={[
              [
                "architecture",
                <a key="a" href={`${DOCS}/ARCHITECTURE.md`} target="_blank" rel="noreferrer">
                  docs/ARCHITECTURE.md
                </a>,
              ],
              [
                "security",
                <a key="s" href={`${DOCS}/SECURITY.md`} target="_blank" rel="noreferrer">
                  docs/SECURITY.md
                </a>,
              ],
              [
                "deployment",
                <a key="d" href={`${DOCS}/DEPLOYMENT.md`} target="_blank" rel="noreferrer">
                  docs/DEPLOYMENT.md
                </a>,
              ],
            ]}
          />
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
