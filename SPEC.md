# Agent Instructions — Build Triggera on GenLayer Studio Next

> Filled from the build template. `[FIXED]` sections carry the judge standards
> (S1–S38) and are not re-derived here; `[PER-BUILD]` sections are Triggera's.

---

## Mission — [PER-BUILD]

Build **Triggera**, a GenLayer Studio Next dApp where an insurer deposits the full
coverage of a parametric policy in GEN, a policyholder binds it by paying the
premium, and — after a candidate real-world event — a GenLayer Intelligent
Contract has its validators fetch the agreed evidence themselves, read it, and
derive in pure code whether the policy's trigger was satisfied.

This must be a real GenLayer-native project.

```text
policy trigger + frozen evidence basis + claim (event window, pages) →
  validators fetch and read the pages themselves →
  code derives SATISFIED / NOT_SATISFIED / UNDETERMINED from independent publishers →
  finality window → bonded appeal on the recorded bytes → settlement in GEN
```

The single sentence the product must communicate: **the policy defines the rules,
the real world provides the evidence, GenLayer investigates the evidence,
validators reach consensus, the protocol settles the outcome.**

---

## Mandatory Stack — [FIXED]

Next.js App Router (16), TypeScript, plain CSS, genlayer-js 2.0.0-rc.1, GenLayer
Studio Next (chain 61997), Vercel-ready `web/`, Python Intelligent Contract on the
GenVM v0.6 runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`.
No backend, no database, no auth vendor, no other chain. Writes go through the
connected EIP-6963 provider with a fee estimate (`estimateTransactionFeesForWrite`)
before every send; reads go through the same-origin `/api/rpc` proxy.

## Network Configuration — [FIXED]

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio-next.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61997
NEXT_PUBLIC_GENLAYER_EXPLORER_URL=https://explorer-studio-dev.genlayer.com
```

---

## Product Name — [PER-BUILD]

```text
Triggera
```

Tagline:

```text
The policy defines the rules. Reality is investigated. Consensus settles the outcome.
```

---

## Core Product — [PER-BUILD]

1. **Write a parametric policy and fund it.** The insurer defines the trigger
   (event type, metric, unit, operator, threshold, measurement window, insured
   area), the coverage period, the premium, the policy text and the evidence
   basis, and deposits the whole coverage in the same signature. The policyholder
   activates by paying exactly the premium; the premium is earned at once.
2. **File a claim and let the panel investigate.** After an event, the
   policyholder names the event window and the pages to read (inside the frozen
   basis). Anyone puts the claim to the panel. Every validator fetches every page
   itself and returns readings, never a verdict. Code derives the determination.
3. **Appeal, finalize, settle.** A determination assigns nothing until its
   finality window lapses; either party may appeal with a bond and one new
   source, re-judged on the recorded bytes. After the appeal window, anyone
   settles: SATISFIED pays the whole coverage to the policyholder, NOT_SATISFIED
   moves nothing and the policy stays active, UNDETERMINED holds and can be
   refiled. Expired coverage returns to the insurer.

Terminal outcome: a policy is `PAID`, `EXPIRED` or `CANCELLED`; every atto that
entered the contract leaves through `claim()`.

---

## Pages To Build — [PER-BUILD]

```text
/                    dashboard: live stats (coverage in custody, active policies,
                     investigations, finalized decisions, settled payouts), WHY
                     GENLAYER section (oracle vs Triggera), latest policies
/policies            the policy book: row-cards with human titles, trigger, coverage,
                     status, latest determination
/policies/[id]       policy detail: trigger card, event state, evidence versions,
                     decision records (each round, RECORDED vs NEW rows), appeal
                     status, settlement, sticky action rail with the one legal verb
/policies/[id]/investigation/[v]
                     the investigation as a timeline: event detected → policy loaded →
                     evidence collected → cross-checked → validators review → consensus
                     → decision → appeal window; the evidence explorer (WHY WAS THE
                     TRIGGER SATISFIED?) with per-publisher readings vs threshold
/create              policy builder (stepped: cover · trigger · area · money · basis ·
                     terms · review)
/rules               lean: outcome table, lifecycle, who moves what, fees, finality
```

---

## Required UI Style — [PER-BUILD]

Institutional, minimal, technical, data-driven; a reinsurer's terminal, not a
DeFi dashboard. No neon, no gradients, no decorative imagery. Hierarchy: Policy →
Trigger → Evidence → Decision → Settlement. Global by design: currencies as
labels, coordinates and radius, UTC dates, metric units by default. The visual
system (fonts, palette, components) is supplied by the user as a style reference
before the pages phase; layout rules from the template apply.

Custom components: `TriggerCard`, `EventStateStrip`, `ReadingsTable` (per
publisher, against the threshold, qualifying / contradicting), `DecisionRecord`,
`InvestigationTimeline`, `WhyGenLayer`, `ActionRail`, `Seal`.

### Layout rules — [FIXED]
Comparable rows are tables; numbers outweigh labels; colour is categorical only;
one primary action per view; whitespace before borders; addresses whole in the
DOM with copy; `min-width: 0` on grid children; price before the control; every
deadline with its consequence; review step before every bonded/irreversible write;
loading / empty / unreachable are three states. No raw output: nulls, enums,
hashes, URLs, epochs and ids only inside copy-button technical folds.

---

## Contract Requirements — [PER-BUILD]

One contract, `contracts/triggera.py`, class `Triggera`.

```text
create_policy (payable: the coverage)   cancel_policy      activate (payable: the premium)
file_claim      investigate   promote   appeal (payable: the bond)   re_investigate
lapse_appeal    settle        expire    claim
get_policy  get_policies  get_policies_for  get_package  get_decision  get_claimable
get_stats   get_config
```

## Required Contract States — [PER-BUILD]

Statuses: `DRAFT, ACTIVE, INVESTIGATING, PENDING_FINALITY, FINAL, PAID, EXPIRED, CANCELLED`
(+ `appeal_open`).

Outcomes: `SATISFIED, NOT_SATISFIED, UNDETERMINED` with hold reasons
`EVIDENCE_INSUFFICIENT, UNCORROBORATED, SPLIT_EVIDENCE`.

Every non-terminal state has a permissionless exit: `promote` after finality,
`settle` after the appeal window, `expire` after coverage end + claim grace (with a
finality window of patience for an uninvestigated claim), `lapse_appeal` after the
stale window. Nothing is hostage to a party or a model.

## Data Structures — [PER-BUILD]

`Policy` (typed storage): identity, trigger (event_type, metric, unit, operator,
threshold, measurement_hours, duration_hours, country, region, lat_e6, lon_e6,
radius_km), money (coverage, premium, min_independent), period and windows,
claim record (evidence_version, evidence_root, event window, claimed_reading),
decision lifecycle (judged/pending versions, outcome, hold_reason, evidence_flag,
score, publishers, qualifying, contradicting), appeal (snapshot restored on lapse),
settlement epochs and amounts. Packages and decision records are canonical JSON
under `"policy|version"`; every decision row stores the excerpt read, its sha256
and fetch epoch, and its basis tag `FETCHED | RECORDED | NEW`.

---

## Trigger engine — [PER-BUILD]

```text
TriggerDefinition = event_type ∈ {RAINFALL, WIND, EARTHQUAKE, TEMPERATURE, FLOOD, WILDFIRE, OTHER}
                  + metric text + unit text
                  + operator ∈ {GTE, GT, LTE, LT} + integer threshold
                  + measurement_hours (1–720) + duration_hours (0–720)
                  + insured area: country, region, optional lat/lon (µ°) + radius_km
```

The derivation reads only `operator`, `threshold` and the readings; event type,
metric and unit shape the prompt. Adding an event type is adding a name to
`EVENT_TYPES`.

## Non-Deterministic Review — [PER-BUILD prompt, FIXED rules]

`investigate` / `re_investigate` are the heart. Every validator, independently:
reads the frozen policy and basis, FETCHES every source itself (an appeal re-reads
the recorded bytes and fetches only the appellant's new source), and asks the
model for READINGS:

```json
{"sources": [{"id": "EV-001", "reading": 157, "window_ok": true, "geo_ok": true, "kind_matches": true}],
 "evidence": "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT",
 "conflicts": ["READING_CONTRADICTION"], "score": 86, "reason": "…"}
```

Then pure code derives the outcome (`_derive_outcome`):

```text
evidence != SUFFICIENT                                → UNDETERMINED · EVIDENCE_INSUFFICIENT
usable = INDEPENDENT ∧ readable ∧ window_ok ∧ geo_ok ∧ kind_matches ∧ sane reading
one voice per publisher (registrable domain), at its LEAST trigger-favourable page
publishers < min_independent                          → UNDETERMINED · UNCORROBORATED
majority of publishers meet the condition            → SATISFIED
majority fall short                                  → NOT_SATISFIED
exact split                                          → UNDETERMINED · SPLIT_EVIDENCE
```

Sources are never averaged. Party-class rows never enter the arithmetic.

### Equivalence — [FIXED]
Pinned exactly: outcome, hold_reason, evidence_flag, publishers / qualifying /
contradicting, the leader's own arithmetic (re-derived from the leader's rows),
every INDEPENDENT row's reading / window_ok / geo_ok / kind_matches, every row's
id / url / host / domain / kind / class / basis tag / basis round / readability,
each digest covering the stored excerpt, RECORDED rows byte-identical with their
fetch epoch. Banded: score (±1 bucket of 10). Free: reason prose, soft conflicts,
readings on PARTY rows, excerpt bytes of live-fetched rows.

### Fail-safe — [FIXED]
A malformed model answer raises `[LLM_ERROR]` inside the judged block; validators
disagree and the round rotates. A non-SUFFICIENT record derives UNDETERMINED in
code, `promote` coerces any conclusive outcome over an insufficient record, and
`settle` refuses it again.

---

## Money — [PER-BUILD]

The insurer's deposit IS the coverage (S23) — a policy never promises more than it
holds. The premium is credited to the insurer at activation. SATISFIED, final,
past the appeal window: the whole coverage to the policyholder's ledger, policy
PAID. NOT_SATISFIED: nothing moves, policy back to ACTIVE. Expiry: coverage back to
the insurer. Appeal bond = max(0.05 GEN, 5% of coverage), returned if the outcome
changed, otherwise to the other party. `claim()` is the only external value path.
Invariant: `escrow == Σ locked coverage (DRAFT…FINAL) + Σ ledger + Σ open bonds`.

## Validation Rules — [PER-BUILD]

Refuse: unknown event type or operator; threshold outside 1–1e9; measurement
window outside 1–720 h; coordinates outside ±90/±180 µ°; plotted coordinates
without a radius; premium ≥ coverage; coverage outside 0.01–10,000 GEN; coverage
period shorter than 900 s or longer than a year, or starting in the past; a basis
without an INDEPENDENT origin, with a duplicate origin, or with `min_independent`
above its distinct independent publishers; a claim by anyone but the policyholder,
outside ACTIVE, after the claim grace, with an event window outside the coverage
period, longer than 30 days, or not yet over; a URL outside the basis, a
normalized duplicate, non-ASCII or containing `| < > " ' \` \`; a package with no
INDEPENDENT source; investigation of a decided version; promotion inside finality;
appeal by a stranger, outside FINAL, after the window, with the wrong bond, or
twice; settlement inside the appeal window, with an appeal open, or over a
non-SUFFICIENT record; expiry before the grace or with an uninvestigated claim
inside its patience window; `claim()` with nothing claimable.

---

## Demo scenario — [PER-BUILD]

**StormGuard Property Protection**: WIND, maximum sustained wind speed ≥ 150 km/h
over 24 h, Eastern Samar, Philippines (11.5°N 125.5°E, 50 km), coverage 0.1 GEN
(notional USD 100,000), premium 0.01 GEN, basis: a meteorological agency, a
weather provider, a press publisher (independent) and the premises station log
(party). Sources read 157 / 149 / 161 km/h plus the station's 153: two of three
independent publishers past the threshold → SATISFIED with one contradicting
publisher, the record visibly NOT averaged. Live fixtures are commit-pinned pages
on three CDN origins; the arc also drives NOT_SATISFIED (nothing moves, policy
stays active), an UNDETERMINED hold refiled, a bonded appeal whose new source
changes the outcome (bond returned), one that does not (bond forfeited), and
expiry — ending at custody zero.

## Testing, honesty, checklist, README — [FIXED]

Direct-mode pytest against the strict stub (every wall, every derivation branch,
structural validation, tampered-leader white-box, appeal on recorded bytes,
snapshot restore on lapse, S30 concurrency and post-terminal invariants,
wei conservation), the mutation sweep with dual-layer mutants, genvm-lint,
web vitest (URL/publisher parity with the contract, wallet, tx ladder), `npm run
verify` (S37), byte-verified deployment, the live arc claiming only what its
`expect()` calls assert (S38), README in the ShipBond structure with a Verified
end-to-end block and Honest limitations.
