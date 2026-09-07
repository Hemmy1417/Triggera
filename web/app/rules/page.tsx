"use client";

/**
 * HOW IT WORKS — the reference, not a pitch.
 *
 * The design brief puts "why a panel, not an oracle" here rather than on the
 * landing page, and asks for it DEMONSTRATED. So the middle of this page is a
 * worked example with numbers: a record where the average pays and the
 * publisher count does not. Everything else is the protocol's own tables —
 * what the panel is asked, what each determination moves, who may move each
 * state on, and what happens when nobody does.
 *
 * Every claim on this page is a claim about contracts/triggera.py, and each
 * one is written from the code rather than from memory: the derivation rules
 * are _derive_outcome, the state transitions are the write methods' own
 * guards, and the bond arithmetic is _bond_for.
 */

import Link from "next/link";
import { Status, Technical } from "../components/bits";

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

/** The determinations, and what each one moves. */
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
      "A majority of the independent publishers that stated a usable reading read past the threshold, over a record the panel called sufficient.",
    moves:
      "Once the appeal window closes, anyone may settle and the whole coverage is credited to the policyholder. The policy is paid and closed.",
  },
  {
    state: "not-satisfied",
    label: "trigger not met",
    means:
      "A majority of those publishers read short of the threshold, again over a sufficient record.",
    moves:
      "Nothing moves. The coverage stays in custody and the policy returns to active for the rest of its period; a later event may still be claimed.",
  },
  {
    state: "undetermined",
    label: "undetermined",
    means:
      "The record does not support a conclusive reading. The protocol will not guess, and a hold is not a denial.",
    moves:
      "Nothing moves. The policy returns to active, the policyholder may file a better claim inside the claim grace, and after it the insurer may reclaim the coverage.",
  },
];

/** The three holds, in the same words the policy record uses. */
const HOLDS: Array<[string, string]> = [
  [
    "the record does not establish what the metric did in the insured area",
    "The panel judged the evidence less than sufficient. No count is run at all: an outcome derived over an insufficient record cannot become state, and cannot settle even if it somehow did.",
  ],
  [
    "fewer independent publishers than the policy requires stated a usable reading",
    "The publishers who spoke were too few. Unreachable pages, readings for the wrong window or the wrong place, and pages that are not what their agreed label says all leave a publisher silent rather than counted.",
  ],
  [
    "the publishers divided exactly, and the protocol will not break a tie by guessing",
    "An even split. Neither side has a majority, so neither side wins; the claim can be refiled with a better record while the grace runs.",
  ],
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
    who: "The insurer wrote it and deposited the coverage. Anyone may become the policyholder by paying exactly the premium; the insurer alone may cancel it.",
    ifNobody:
      "It stays a draft. The coverage is the insurer's to withdraw at any time until someone pays the premium.",
  },
  {
    state: "active",
    label: "active",
    who: "The policyholder files a claim: an event window that is over and inside the cover, their own claimed reading, and the pages to read — all from the frozen basis.",
    ifNobody:
      "When the cover and its claim grace have both passed, anyone may expire the policy and the whole coverage returns to the insurer.",
  },
  {
    state: "investigating",
    label: "investigating",
    who: "Anyone may run the investigation. It is never hostage to one party's availability, and it runs at most once per claim version.",
    ifNobody:
      "The claim grace still runs out. Anyone may then expire the policy, once an uninvestigated claim has had a full finality window to be read.",
  },
  {
    state: "pending-finality",
    label: "pending finality",
    who: "Nobody. The decision is recorded and assigns nothing; it waits out the finality window the policy set.",
    ifNobody:
      "It waits. After the window, anyone may promote it — that is the call that turns a record into the policy's state.",
  },
  {
    state: "final",
    label: "final",
    who: "Either party may appeal inside the appeal window, with a bond and at most one new source from inside the agreed basis.",
    ifNobody:
      "After the appeal window, anyone may settle: a met trigger pays the coverage, an unmet one returns the policy to active.",
  },
  {
    state: "investigating",
    label: "appeal open",
    who: "Anyone may run the re-investigation. The second panel re-reads the recorded bytes of the appealed round and fetches live only what the appellant added.",
    ifNobody:
      "One hour after filing, anyone may lapse the appeal: the snapshot taken at filing is restored exactly and the bond returns to the appellant.",
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
      <section className="metricstrip">
        <span className="metric">
          <span className="metric-label">What the panel returns</span>
          <span className="metric-value">readings</span>
        </span>
        <span className="metric">
          <span className="metric-label">What derives the determination</span>
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
      </section>

      {/* ── what the panel is asked ─────────────────────────────────────── */}
      <section className="grid two">
        <div className="card">
          <span className="eyebrow">What the panel is asked</span>
          <p className="body" style={{ marginTop: 12 }}>
            Every validator fetches each named source itself, under consensus, and is asked four
            things about it and two about the record as a whole. It is asked for none of them in
            words of its own: the answers are a fixed shape, and anything else is refused at the
            boundary before it can become a record.
          </p>
          <dl className="factlist">
            <div>
              <dt>Per source</dt>
              <dd>
                The whole-number reading the page itself states for the insured area over a window
                of the agreed length — or nothing, where the page states no such value. Then three
                yes-or-no questions: does the window fit, does the area fit, and is the page what
                its agreed label says it is.
              </dd>
            </div>
            <div>
              <dt>For the record</dt>
              <dd>
                Whether it establishes what the metric did at all, which material contradictions it
                shows, and how confident the panel is that it tells the event&apos;s true story.
              </dd>
            </div>
            <div>
              <dt>Never asked</dt>
              <dd>
                Whether the trigger was met, and what anyone is owed. The panel does not decide and
                does not compute an amount.
              </dd>
            </div>
          </dl>
        </div>

        <div className="card">
          <span className="eyebrow">What derives the determination</span>
          <p className="body" style={{ marginTop: 12 }}>
            Deterministic code, run identically inside every validator&apos;s own judgment, turns
            those readings into the fields money reads. A validator that agrees with the leader
            about the readings but re-derives a different outcome from them refuses the round — so
            the arithmetic below is not a description of what happens, it is the thing consensus is
            reached on.
          </p>
          <div className="window" style={{ marginTop: 20 }}>
            <div className="window-bar">
              <i className="window-dot" style={{ background: "var(--iris)" }} />
              <span className="eyebrow">the derivation, in order</span>
            </div>
            <div className="window-body">
              <pre style={PRE}>{DERIVATION}</pre>
            </div>
          </div>
          <p className="caption muted" style={{ marginTop: 16 }}>
            A source is usable only if it is independent of both parties, was readable this round,
            fits the window and the area, is what its label says, and states a sane number. Party
            sources never enter this arithmetic.
          </p>
        </div>
      </section>

      {/* ── the determination table ─────────────────────────────────────── */}
      <section className="card">
        <span className="eyebrow">The three determinations</span>
        <div className="tablewrap" style={{ marginTop: 20 }}>
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
                  <td className="body-sm">{o.moves}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="body" style={{ marginTop: 28 }}>
          A hold names its reason, and there are exactly three of them.
        </p>
        <div className="tablewrap" style={{ marginTop: 16 }}>
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
        <span className="eyebrow">Why a panel, and not an oracle</span>
        <p className="body measure" style={{ marginTop: 12 }}>
          A policy pays on what independent publishers state, counted one publisher at a time. That
          is not a stylistic choice, and the difference is easiest to see on a record where the two
          approaches disagree. Take a trigger of{" "}
          <span className="figure">rainfall at or above 120 mm</span> and five pages the parties
          agreed to read.
        </p>

        <div className="tablewrap" style={{ marginTop: 24 }}>
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
              <tr>
                <td>district gauge summary</td>
                <td>
                  <span className="ident">agency.example.gov</span>
                </td>
                <td className="num">96 mm</td>
                <td className="body-sm">
                  <Status state="contradicting" label="short of it" />
                </td>
              </tr>
              <tr>
                <td>seasonal bulletin</td>
                <td>
                  <span className="ident">agency.example.gov</span>
                </td>
                <td className="num">104 mm</td>
                <td className="body-sm muted">
                  the same publisher, so not a second voice — and 96 is its least
                  trigger-favourable page, so 96 is what it says
                </td>
              </tr>
              <tr>
                <td>station observation</td>
                <td>
                  <span className="ident">weather.example.com</span>
                </td>
                <td className="num">101 mm</td>
                <td className="body-sm">
                  <Status state="contradicting" label="short of it" />
                </td>
              </tr>
              <tr>
                <td>catchment report</td>
                <td>
                  <span className="ident">satellite.example.org</span>
                </td>
                <td className="num">318 mm</td>
                <td className="body-sm">
                  <Status state="qualifying" label="meets it" />
                </td>
              </tr>
              <tr>
                <td>the policyholder&apos;s own rain log</td>
                <td>
                  <span className="ident">holder.example.net</span>
                </td>
                <td className="num">240 mm</td>
                <td className="body-sm muted">a party&apos;s own source: informs only, never counts</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid two" style={{ marginTop: 28 }}>
          <div>
            <p className="eyebrow">If the readings were averaged</p>
            <p className="body" style={{ marginTop: 10 }}>
              <span className="figure">171.8 mm</span> across the five pages, or{" "}
              <span className="figure">154.75 mm</span> across the four independent ones. Either
              average clears 120, so the policy pays{" "}
              <Status state="satisfied" label="trigger met" /> — on the strength of one outlier and
              one interested party.
            </p>
          </div>
          <div>
            <p className="eyebrow">Counted one publisher at a time</p>
            <p className="body" style={{ marginTop: 10 }}>
              Three independent publishers speak: 96, 101 and 318 mm. One of the three meets the
              threshold, two are short of it, so the majority is short and the determination is{" "}
              <Status state="not-satisfied" label="trigger not met" />. Nothing moves, and the
              policy stays live.
            </p>
          </div>
        </div>

        <p className="body measure" style={{ marginTop: 24 }}>
          The publisher count does not decide it either. Adding four more pages from{" "}
          <span className="ident">agency.example.gov</span> changes nothing at all: they are the
          same voice, and stacking pages from one publisher can neither manufacture a second
          opinion nor improve the number that publisher is heard with. That is the property an
          oracle reporting a single number cannot give you, and it is why the record is a panel of
          named publishers rather than a feed.
        </p>
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
          <span className="eyebrow">Nothing is anyone&apos;s to stall</span>
          <p className="body" style={{ marginTop: 12 }}>
            The two parties can start things and the two parties can appeal. They cannot stop
            anything: every state past the draft can be moved on by a stranger, and every state has
            an exit that does not need the party it would inconvenience.
          </p>
          <p className="body-sm muted" style={{ marginTop: 16 }}>
            Wall-clock windows are read from a consensus clock the contract fetches itself, from
            several witnesses that must agree with each other. No clock, no write: every timed
            method fails closed rather than guessing the time.
          </p>
        </div>
      </section>

      <section className="card">
        <span className="eyebrow">Who may move each state on</span>
        <div className="tablewrap" style={{ marginTop: 20 }}>
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
          <span className="eyebrow">Where the money is, at every moment</span>
          <dl className="factlist">
            <div>
              <dt>The coverage</dt>
              <dd>
                Deposited by the insurer in the same signature that writes the policy: a policy that
                could pay more than it holds is not an instrument. It leaves in exactly two ways —
                the whole of it to the policyholder on a finalized met trigger, or the whole of it
                back to the insurer on the expiry reclaim. Nothing pays part of it.
              </dd>
            </div>
            <div>
              <dt>The premium</dt>
              <dd>
                Paid by whoever activates the policy, and earned by the insurer at that moment. It
                buys the cover, not the outcome, and it is not refunded by a determination going
                either way.
              </dd>
            </div>
            <div>
              <dt>The appeal bond</dt>
              <dd>
                5% of the coverage, never below 0.05 GEN, posted with the appeal. It returns to the
                appellant only if the second panel reaches a different outcome; where the outcome
                stands, the bond goes to the other party, who carried the delay. An appeal that
                never concludes is lapsed by anyone after an hour and the bond returns.
              </dd>
            </div>
            <div>
              <dt>Getting paid</dt>
              <dd>
                Every credit lands in a ledger balance and one method moves value out of the
                contract, called by the party the balance belongs to. Nothing is pushed anywhere,
                and a settlement cannot fail on a recipient that will not accept a transfer.
              </dd>
            </div>
          </dl>
        </div>

        <div className="card">
          <span className="eyebrow">Fees, and what &ldquo;finalized&rdquo; means here</span>
          <dl className="factlist">
            <div>
              <dt>Every write is sized before it is signed</dt>
              <dd>
                The app simulates the call first, which is what produces the fee deposit the wallet
                shows you. The simulation also runs the method, so a write the contract would refuse
                fails there, in the contract&apos;s own words, before the wallet ever opens.
              </dd>
            </div>
            <div>
              <dt>The deposit is not the price</dt>
              <dd>
                It sizes the round and is largely refunded; the cost of a write settles far below
                what the wallet quotes. The quote is a ceiling, not a charge.
              </dd>
            </div>
            <div>
              <dt>Accepted is not finalized</dt>
              <dd>
                A read proving the new state is live means the write was accepted, which the chain
                can still walk back. This app says finalized only when the transaction itself
                reports finalized with a successful deciding execution — and where it cannot prove
                that yet, it says so rather than rounding up.
              </dd>
            </div>
          </dl>
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
          <Link href="/" className="ghost">Read the policy book</Link>, or{" "}
          <Link href="/create" className="ghost">write a policy</Link>.
        </p>
      </section>
    </main>
  );
}
