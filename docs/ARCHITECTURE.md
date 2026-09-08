# Triggera — Architecture

How the system is built, and why each part is shaped the way it is.

`SPEC.md` states what was to be built; `docs/DESIGN.md` states the visual
system. This document states the mechanism. It anchors everything by symbol —
function or class name — because line numbers drift and a drifted reference is
a quiet falsehood.

---

## 1. What the contract is

A parametric insurance policy names a **measurable trigger** — an event type, a
metric and unit, an operator and an integer threshold, a measurement window, an
insured area — and an **evidence basis**: which web origins the panel may read,
what kind of source each is, and whether both parties regard it as
`INDEPENDENT` or `PARTY`. Both are frozen at drafting and hashed into
`terms_sha256`.

The insurer deposits the **whole coverage** in the same signature that drafts
the policy. A policyholder binds it by paying exactly the premium. After a
candidate event the policyholder files a claim naming pages from the agreed
origins; a validator panel fetches and reads them independently; deterministic
code derives the outcome; the coverage moves only after a finality window and
an appeal window, and only through a pull-payment ledger.

Two properties are load-bearing and are stated plainly everywhere they matter:

- **`UNDETERMINED` is a first-class outcome, not a failure.** A panel that
  cannot establish what happened says so, pays nobody, and returns the policy
  to `ACTIVE` for a refiled claim.
- **Readings are counted, never averaged.** Each independent publisher speaks
  once. A majority decides. No arithmetic mean is taken anywhere in the
  contract.

| | |
|---|---|
| Contract | `contracts/triggera.py`, class `Triggera` — one file |
| Address | `0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` |
| Network | GenLayer Studio Next, chain 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Explorer | `https://explorer-studio-dev.genlayer.com` (`/address/<a>`, `/tx/<h>`) |
| Runner | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| Version | `get_config()` reports `"0.1.0"` |

`gen_getContractCode` for that address returns 100,199 bytes,
sha256 `18eaa323a0d3d156405e8584872a19aa5dc9476e55c9fd4f7a79e2bb9b371786`,
identical to `contracts/triggera.py` in this checkout.

Line 1 of the contract reads `# v0.3.0`. That is the GenVM **calldata format
header**, byte-identical in other shipped GenLayer contracts. It is not a
version of Triggera.

---

## 2. Repository shape

```text
contracts/triggera.py          the whole contract: storage, lifecycle, panel, views
tests/direct/                  conftest.py (strict genlayer stub) + 7 test modules
tests/mutation_sweep.py        the mutation gate
web/                           Next.js 16 app — 6 routes
  app/                         /, /policies, /policies/[id],
                               /policies/[id]/investigation/[v], /create, /rules
  lib/                         chain, config, read, tx, types, urls, useNow, wallet
  scripts/                     deploy · verify · reconcile · state · arc-*
  tests/                       vitest: chain, read, signed-write, tx
evidence/                      commit-pinned fixture pages, served by four CDN origins
docs/DESIGN.md                 the visual system
SPEC.md                        the build brief
```

There is **no owner**. `Triggera.__init__` sets counters and nothing else:
nobody — including whoever paid the deployment fee — can move a locked atto,
alter a decision record, or authorize a payout.

---

## 3. The policy lifecycle as a state machine

Eight statuses, in `STATUSES`. Three are terminal.

```text
   create_policy                 cancel_policy (insurer)
   (payable: coverage)   ┌───────┐ ─────────────────────▶ ┌───────────┐
   ────────────────────▶ │ DRAFT │                        │ CANCELLED │  terminal
                         └───┬───┘                        └───────────┘
                             │ activate (payable: exactly the premium)
                             ▼
     ┌─────────────────▶ ┌────────┐ ─expire ●─▶ ┌─────────┐  terminal
     │   ┌─────────────▶ │ ACTIVE │             │ EXPIRED │
     │   │               └───┬────┘             └─────────┘
     │   │                   │ file_claim (policyholder)
     │   │                   ▼
     │   │           ┌───────────────┐ ─expire ●─▶ EXPIRED
     │   │           │ INVESTIGATING │
     │   │           └───────┬───────┘
     │   │                   │ investigate ●
     │   │                   ▼
     │   │          ┌───────────────────┐
     │   │          │ PENDING_FINALITY  │
     │   │          └─────────┬─────────┘
     │   │                    │ promote ●
     │   └──── UNDETERMINED ──┤
     │                        │ SATISFIED / NOT_SATISFIED
     │                        ▼
     │                    ┌───────┐        appeal (either party, exact bond,
     │                    │ FINAL │◀────── inside the window) sets appeal_open
     │                    └───┬───┘                      │
     │        settle ●        │                          ├─ re_investigate ●
     │   ┌────────────────────┤                          │   ─▶ PENDING_FINALITY
     │   │                    │                          └─ lapse_appeal ●
     │   │ SATISFIED          │ NOT_SATISFIED                ─▶ snapshot restored
     │   ▼                    │
     │ ┌──────┐  terminal     │
     │ │ PAID │               │
     │ └──────┘               │
     └────────────────────────┘

   any credited address ──claim()──▶ the only external value path
```

`●` marks an edge anyone may move.

`appeal_open` is a flag beside the status, not a status of its own: an appeal is
filed against a `FINAL` decision, the policy stays `FINAL`, and every other
write on it is blocked until `re_investigate` or `lapse_appeal` concludes.

### Who may move each edge

| Edge | Symbol | Who | Value | Gate |
|---|---|---|---|---|
| → `DRAFT` | `create_policy` | any wallet; it becomes the insurer | payable, the whole coverage | the trigger, money and period bounds enforced inline and reported by `get_config`, plus every basis rule in `_clean_basis` |
| `DRAFT` → `CANCELLED` | `cancel_policy` | insurer only | — | status is `DRAFT` |
| `DRAFT` → `ACTIVE` | `activate` | anyone except the insurer; the caller becomes the policyholder | payable, **exactly** the premium | coverage period not already over |
| `ACTIVE` → `INVESTIGATING` | `file_claim` | policyholder only | — | inside the claim grace; the event window lies inside the coverage period, is over, spans ≤ 30 days; ≥ 1 `INDEPENDENT` row; version cap `MAX_VERSIONS` |
| `INVESTIGATING` → `PENDING_FINALITY` | `investigate` | **anyone** | — | one round per claim version, ever |
| `PENDING_FINALITY` → `FINAL` | `promote` | **anyone** | — | the finality window has lapsed; the outcome is conclusive |
| `PENDING_FINALITY` → `ACTIVE` | `promote` | **anyone** | — | same window; the outcome is `UNDETERMINED` |
| `FINAL` → appeal open | `appeal` | insurer or policyholder | payable, **exactly** `_bond_for(p)` | inside the appeal window; one appeal at a time |
| appeal open → `PENDING_FINALITY` | `re_investigate` | **anyone** | — | the recorded snapshot passes `_dossier_intact` |
| appeal open → restored | `lapse_appeal` | **anyone** | — | `STALE_APPEAL_SECONDS` since filing |
| `FINAL` → `PAID` | `settle` | **anyone** | — | appeal window closed, no appeal open, outcome `SATISFIED`, record `SUFFICIENT` |
| `FINAL` → `ACTIVE` | `settle` | **anyone** | — | same, outcome `NOT_SATISFIED`; nothing moves |
| `ACTIVE`/`INVESTIGATING` → `EXPIRED` | `expire` | **anyone** | — | coverage end + claim grace passed, and an uninvestigated claim has had a full finality window of patience |
| ledger → wallet | `claim` | the credited address itself | — | a non-zero balance |

Six functions — `investigate`, `promote`, `re_investigate`, `lapse_appeal`,
`settle`, `expire` — may be called by anyone. That is the design rule stated
once: **every non-terminal state has an exit no single party can block.** A
determination is never hostage to one party's availability, a decision is never
hostage to a model that will not answer, and money is never stranded because
somebody stopped calling.

`expire` carries the one subtlety worth naming: if a claim was filed and never
investigated (`evidence_version > judged_version`), expiry additionally waits
`last_claim_epoch + finality_window`, so an insurer cannot outrun a live claim
to the exit.

---

## 4. The split: what the model returns, what code derives

This is the centre of the design.

| The model returns (`gl.nondet.exec_prompt`, `response_format="json"`) | The model never returns |
|---|---|
| per source: `reading` (an integer or null) | the outcome |
| per source: `window_ok` — does the stated value cover a measurement window of the agreed length, inside the claimed event window | the hold reason |
| per source: `geo_ok` — is the stated value for the insured area | any amount |
| per source: `kind_matches` — is the page what its agreed kind label says | who is paid |
| `evidence` — `SUFFICIENT` / `PARTIAL` / `INSUFFICIENT` | the publisher counts |
| `conflicts` (codes from `CONFLICT_CODES`), `score` 0–100, a prose `reason` | anything a second node cannot re-derive |

Deterministic code then derives everything money reads, in `_derive_outcome`,
called from `judge` and again from `validator_fn`.

**Why the split exists.** Three reasons, each of which shows up as a concrete
mechanism elsewhere in the contract:

1. **Reproducibility.** A reading is an observation a second validator can
   independently reproduce from the same page: the page either states 157 km/h
   for that place and window or it does not. A verdict is a judgment whose only
   witness is the model that produced it. Consensus over the first is a
   comparison of facts; consensus over the second is agreement about a mood.
2. **Every validator composes the money fields itself.** Because
   `_derive_outcome` is pure code run identically inside every node's `judge`,
   `outcome`, `hold_reason`, `publishers`, `qualifying` and `contradicting` are
   *derived*, not *asserted*. `validator_fn` compares its own derivation to the
   leader's — and then re-runs `_derive_outcome` over the **leader's own rows**
   and refuses a leader whose stored readings do not produce its claimed
   outcome and counts. A consistent lie that moves money has to survive both.
3. **Structural refusal, not tolerance.** Consensus will happily agree on
   garbage, so garbage never leaves the non-deterministic block. Inside `judge`,
   a missing row, a non-numeric reading, a reading outside `0..MAX_READING`, a
   non-boolean flag, an `evidence` value outside `EVIDENCE_FLAGS`, or a
   non-numeric score each raise `ERROR_LLM`. An `[LLM_ERROR]` from the leader
   is never endorsed by `validator_fn`, so a misbehaving leader rotates the
   round and nothing is written.

Supporting rules, in the same block:

- An unreadable page states nothing: `judge` forces `reading = None` on any row
  whose `readable` is false, whatever the model said about it.
- Every party-authored string and every fetched page passes through `_defang`
  before it reaches the prompt, and `_valid_url` forbids the `|` that separates
  fence header fields. A fence delimiter inside a fence is therefore that
  source's own forgery, and the prompt says so.
- The prompt tells the panel that the agreed `kind` and `class` are **labels
  both wallets signed, checked against nothing**, and asks it to judge each page
  as what it shows itself to be.

---

## 5. The derivation

`_derive_outcome(operator, threshold, min_independent, evidence_flag, rows)`
returns `(outcome, hold_reason, publishers, qualifying, contradicting)`. It is
the only place an outcome is decided, and it is pure.

```text
evidence_flag != "SUFFICIENT"          → UNDETERMINED · EVIDENCE_INSUFFICIENT

usable        = _usable_rows(rows)
voices        = _publisher_readings(operator, usable)   # publisher → one reading
publishers    = len(voices)
publishers < min_independent           → UNDETERMINED · UNCORROBORATED

qualifying    = count of voices where _condition_met(operator, v, threshold)
contradicting = publishers - qualifying
qualifying    * 2 > publishers         → SATISFIED
contradicting * 2 > publishers         → NOT_SATISFIED
otherwise (an exact split)             → UNDETERMINED · SPLIT_EVIDENCE
```

**`_usable_rows` — what may carry an outcome at all.** A row survives only if
it is `INDEPENDENT` class, `readable` this round, `window_ok`, `geo_ok`,
`kind_matches`, and carries an integer reading in `0..MAX_READING`. Booleans are
rejected as readings explicitly (`isinstance(val, bool)`), and the function is
total over malformed input because `validator_fn` also runs it over the
leader's claimed rows before trusting anything about them.

**`_publisher_readings` — one voice per publisher.** Rows are grouped by
`_registrable_domain(host)`, so `data.example.org` and `www.example.org` are one
publisher. Where a publisher has several usable pages it speaks with its
**least trigger-favourable** reading: the lowest for `GTE`/`GT`, the highest for
`LTE`/`LT`. Two consequences, both intended — stacking pages from one publisher
cannot manufacture a second voice, and it cannot manufacture a better number.

**`_condition_met`** evaluates `GTE`/`GT`/`LTE`/`LT` against the threshold. It
is the only place the trigger condition is evaluated anywhere in the system,
and the model never runs it. Adding an event type is adding a name to
`EVENT_TYPES`: the derivation reads only the operator, the threshold and the
readings, while the event type, metric and unit shape the prompt.

**The three holds.** `EVIDENCE_INSUFFICIENT` — the record itself does not
establish what the metric did. `UNCORROBORATED` — fewer independent publishers
produced a usable reading than the policy requires (`min_independent`, bounded
`1..3`). `SPLIT_EVIDENCE` — the publishers divided exactly. None of the three
pays anybody, all three return the policy to `ACTIVE` on `promote`, and all
three can be answered by a refiled claim inside the grace.

`PARTY`-class rows never enter this function's arithmetic. A policyholder's own
station log may inform the panel's reading of the record and can never
establish the trigger.

Defence in depth on the same rule: `promote` coerces any conclusive outcome
recorded over a non-`SUFFICIENT` record back to `UNDETERMINED`, and coerces an
outcome outside `OUTCOMES` the same way; `settle` refuses a non-`SUFFICIENT`
record again at the money boundary.

---

## 6. The panel round

`_panel_round(p, version, now, recorded)` runs one determination over one claim
version. Storage is read into locals **before** the non-deterministic block —
locals cross the boundary, storage handles do not — and then two closures are
handed to `gl.vm.run_nondet`:

- **`judge`** builds the rows, fetches or reads the bytes, renders the prompt,
  calls the model, validates the answer structurally, and derives the outcome.
- **`validator_fn`** re-runs `judge` on this node and compares.

### Row provenance

Every row carries a `basis` tag from `BASIS_TAGS`:

| Tag | Where the bytes come from | Set when |
|---|---|---|
| `FETCHED` | this node's own `gl.nondet.web.render` | a first investigation |
| `RECORDED` | the stored excerpt of the appealed round | a re-investigation, for a row the appealed round already read at the same URL |
| `NEW` | this node's own fetch | a re-investigation, for the source the appellant added |

Every row's `digest` is `_sha256_hex(row["excerpt"])` — the digest covers the
bytes actually **stored**, so the record can be re-checked forever, and
`_dossier_intact` re-checks exactly that before any later round reads a
snapshot.

### What `validator_fn` compares, and what it does not

| Field | Treatment |
|---|---|
| `outcome`, `hold_reason`, `evidence_flag` | exact |
| `publishers`, `qualifying`, `contradicting` | exact |
| the leader's rows re-run through `_derive_outcome` | must reproduce the leader's own outcome, hold reason and counts |
| row count | exact |
| per row: `id`, `url`, `host`, `domain`, `kind`, `cls`, `basis`, `basis_round` | exact |
| per row: `readable` | exact |
| per row: `digest` | must cover the excerpt the leader stored |
| `RECORDED` rows: `excerpt`, `fetch_epoch` | byte-identical and epoch-identical |
| `INDEPENDENT` rows: `reading`, `window_ok`, `geo_ok`, `kind_matches` | exact |
| `score` | banded — refused at more than one bucket of `SCORE_BUCKET` = 10 apart |
| `reason`, `conflicts` | free |
| `PARTY` rows: `reading`, `window_ok`, `geo_ok`, `kind_matches` | free |
| `FETCHED` / `NEW` rows: `excerpt` bytes | **not compared** |
| `origin`, `label`, `added_version`, and `fetch_epoch` on a live-fetched row | not compared — each is copied from the frozen package or is the round's consensus clock reading, so it is the same local on every node |

The last line is the deliberate one, and it is worth stating rather than
hiding. Two honest nodes fetching a live page at the same instant can receive
different bytes — a rotating banner, a different edge cache, a re-rendered
template. Requiring byte equality on a live fetch would make the panel fail on
correctness rather than on disagreement. So:

> On a live-fetched row the **excerpt is the leader's record**: sealed by a
> digest that must cover it, agreed on every field derived from it, but not
> corroborated byte-for-byte by a second node. What the validators do agree
> exactly is the row's identity, its readability, and — for `INDEPENDENT` rows
> — the four fields the derivation actually reads. A `RECORDED` row is a
> different object: both nodes are reading the same stored bytes, so it is
> compared verbatim.

That asymmetry is why an appeal re-reads the record rather than the web. The
first round's bytes are pinned and digest-sealed at the moment they are
written; the second round compares them verbatim; a page that changes after
round one can never change the record.

### Leader failures

`validator_fn` distinguishes error classes rather than treating every failure
alike:

| Class | Meaning | Endorsement rule |
|---|---|---|
| `ERROR_EXPECTED` | business logic | endorsed only on an identical message |
| `ERROR_EXTERNAL` | a source answered 4xx | endorsed only on an identical message |
| `ERROR_TRANSIENT` | network noise | endorsed if both nodes saw a transient failure |
| `ERROR_LLM` | the model misbehaved | never endorsed |

A VM-level leader failure that is not a `UserError` at all — out of memory, a
timeout — is never endorsed either: it carries no business message worth
comparing. A validator whose own re-run throws returns `False`, because a node
that learned nothing about the leader has no honest answer but disagreement,
and disagreement rotates the round.

---

## 7. Appeal, re-hearing, snapshot

`appeal` is payable and takes exactly `_bond_for(p)` —
`max(APPEAL_BOND_FLOOR_ATTO, coverage * APPEAL_BOND_BPS // 10_000)`, a 0.05 GEN
floor over 5% of the coverage. Either party may file, once, inside the appeal
window, on a `FINAL` decision, with grounds of `MIN_GROUNDS_CHARS..MAX_REASON_CHARS`
and optionally **one** new source that must itself sit inside the frozen basis
and must not respell a URL already in the record.

Filing does four things:

1. **Freezes `appeal_snapshot`** — status, outcome, hold reason, evidence flag,
   score, the three counts, `judged_version`, `final_epoch`,
   `appeal_until_epoch`, `evidence_version`, `evidence_root` — taken *now*, so
   a lapse restores what was appealed and never what the state has drifted to.
2. Copies the appealed package's rows, appends the appellant's source labelled
   `[APPELLANT] …` with kind and class **inherited** from the basis entry its
   host matches, and stores the whole thing as the next version through
   `_store_package`. The appellant declares no labels of their own.
3. Sets `appeal_open = "yes"`, which blocks every other write on the policy.
4. Adds the bond to `escrow_atto`.

`re_investigate` verifies `_dossier_intact` over the appealed decision's rows,
then runs `_panel_round` with `recorded` set. The panel is told, in the prompt,
that this is a re-investigation; it is given the first round's **outcome only**
— its reasoning is withheld so a second panel is not anchored on one leader's
prose — and the appellant's grounds are fenced and named as advocacy from
someone who profits if the panel agrees.

Bond allocation is deterministic and needs no judgment:

```text
changed = recorded["outcome"] != record["outcome"]
changed  → _credit(appellant, bond)          the appeal was right; made whole
else     → _credit(the other party, bond)    the noise is paid for by whoever made it
```

The new decision then arms **its own finality window** and walks the same
`promote` path as a first investigation. An appeal does not shortcut finality.

`lapse_appeal` is the unilateral exit: after `STALE_APPEAL_SECONDS` with no
concluded re-investigation, anyone restores the snapshot field by field and
returns the bond to the appellant. The restored appeal window still governs
`settle` afterwards, and the appeal may be refiled if that window is still open.

---

## 8. Money

Two choke points, and nothing else touches value.

**`_credit(addr, amount)`** is the only place an allocation becomes a balance.
Every path — premium at `activate`, cancellation refund, coverage at a
`SATISFIED` `settle`, refund at `expire`, either side of a bond — goes through
it. Nothing pays out inline.

**`claim()`** is the only external value path. It reads the caller's balance,
**zeroes it and reduces `escrow_atto` before** emitting the transfer through the
`_Payee` proxy — a bare `@gl.evm.contract_interface` whose `View` and `Write`
classes are empty, because the payee is a wallet and there is no schema to bind
against. The v0.6 proxy takes the value alone, so the transfer is emitted as
part of this transaction and moves with its finality.

| Event | Credit |
|---|---|
| `activate` | premium → insurer, earned at once |
| `cancel_policy` | coverage → insurer |
| `settle`, `SATISFIED` | the **whole** coverage → policyholder; policy `PAID` |
| `settle`, `NOT_SATISFIED` | nothing; policy returns to `ACTIVE` with its coverage intact |
| `expire` | coverage → insurer |
| `re_investigate` | bond → appellant if the outcome changed, else the counterparty |
| `lapse_appeal` | bond → appellant |

The custody invariant, checked by `web/scripts/reconcile.mjs` against the live
contract and by the direct suite at every step of a full arc:

```text
escrow_atto == Σ coverage+premium still locked in live policies
             + Σ every unpulled ledger balance
             + Σ open bonds
```

A policy never promises more than it holds, because the coverage is deposited
in the same signature that drafts it. There is no rounding: the coverage is
paid whole.

---

## 9. The clock

Timed rules need a clock no party controls. `_utc_now` runs its own
`gl.vm.run_nondet`:

- Three `cdn-cgi/trace` candidates (`WALL_CLOCK_SOURCES`); the **minimum** is
  taken, and a mutual divergence over `MAX_CLOCK_DIVERGENCE` (300 s) refuses.
- An execution-layer block timestamp (`CHAIN_FLOOR_SOURCE`) as corroboration.
  It fails **open** by construction — an unreachable explorer leaves the floor
  at 0 — so it may tighten the envelope but is never load-bearing.
- Two beacon heads (`BEACON_CEILING_SOURCES`), converted through
  `BEACON_GENESIS_EPOCH + 12 * slot`, bounding the reading in **both**
  directions and failing closed when unreachable. A common forward skew of the
  edge network would otherwise close windows early for whoever benefits from
  expiry.

The leader/validator comparison is integer arithmetic against
`MAX_CLOCK_DIVERGENCE` — never prose put to a model. `_require_clock` raises
`ERROR_TRANSIENT` when the reading is 0, so **every timed method fails closed**
and a refused clock leaves state exactly as it was.

---

## 10. Evidence identity: origins, URLs, publishers

Three layers, applied at three different moments.

| Layer | Symbol | Rule |
|---|---|---|
| basis intake, at drafting | `_clean_basis` | 1–`MAX_BASIS_ENTRIES` entries; kind in `SOURCE_KINDS`; class in `SOURCE_CLASSES`; origin a valid lowercase hostname; no duplicate origin; at least one `INDEPENDENT`; `min_independent` never above the count of **distinct independent publishers**, so a trigger that could never be verified cannot be written |
| claim intake, at filing | `_clean_rows` | the URL's host must match a basis origin via `_matches_origin`, longest match winning; kind and class are **inherited** from that entry and never declared by the submitter; a `_normalize_url` duplicate is refused against the new rows and against everything already in the record |
| derivation, at the round | `_registrable_domain` | independence is counted per publisher, not per page |

Underneath sit the pure functions. `_split_url` ends the authority at the first
of `/`, `?` or `#` (RFC 3986) and strips userinfo at the **last** `@` — cutting
at `/` alone let `https://evil.io?x=@agency.example.org` strip its userinfo
inside the query and report a basis host while every node fetched `evil.io`.
`_valid_url` admits printable ASCII only and refuses the seven characters that
could forge a prompt fence: angle brackets, double and single quote, backtick,
pipe and backslash. The pipe matters most: the URL is interpolated into the
contract's own pipe-delimited fence header.

`web/lib/urls.ts` mirrors those pure rules in TypeScript so the composer can
refuse locally, before a wallet opens, exactly what the contract would refuse.
Nothing there decides anything: the contract re-runs every rule at intake and
its answer is the only one that counts.

The fixtures in `evidence/` are committed so their bytes are pinned to a commit
and served by **four CDN origins** mirroring this repository at that commit —
`raw.githubusercontent.com`, `cdn.jsdelivr.net`, `rawcdn.githack.com`,
`raw.githack.com`. Validators fetch from those origins, never from a checkout.
The two githack hosts share the publisher `githack.com`; that is only
acceptable because the row served from one of them is `PARTY` class and never
enters the count, leaving three distinct independent publishers.

---

## 11. The web layer

Next.js 16 App Router, TypeScript, plain CSS, `genlayer-js` 2.0.0-rc.1. No
database and no auth vendor; the only server-side code is the read proxy below,
and the only server-side state is its per-instance cache.

| Route | Shows |
|---|---|
| `/` | the claim, with the protocol's live state (`get_stats`) beside it |
| `/policies` | the policy book — every policy the contract holds |
| `/policies/[id]` | the policy: trigger, evidence, determination, settlement |
| `/policies/[id]/investigation/[v]` | one round: per-publisher readings against the threshold, `RECORDED` vs `NEW` provenance, the panel's own reason |
| `/create` | the policy builder |
| `/rules` | the outcome table, the lifecycle, who moves what, finality |

Reads go through the same-origin `/api/rpc` proxy, whose allowlist forwards
exactly two things: a read against the one configured contract, and a
transaction-status lookup by hash. It cannot submit a transaction, read another
contract, or reach any other RPC method. The proxy exists for a measured
reason — the upstream ceiling is 30 requests per minute per IP, and a page that
talks to it directly is not slow but broken — and it coalesces and paces reads.
Its honest limitation is recorded in the route itself: the cache and pacer are
per serverless instance, so the effective rate is per instance, not global.

`lib/read.ts` raises a typed `ReadError` carrying a `transient` flag, because
Studio Next answers a rate limit with `-32029` and `lib/tx.ts`'s confirmation
poll must not read that as a failed transaction. Writes go through the
connected EIP-6963 provider and are sized with a fee estimate before they are
signed. Confirmation is a **contract read**, not a receipt — but a view
predicate turning true only proves the write was `ACCEPTED`, a state the chain
can still walk back, so `lib/tx.ts` follows it by polling the transaction until
the chain reports `FINALIZED`. Finality is tracked, not presumed.

`web/scripts/` holds the operational tools: `deploy.mjs`, `verify.mjs`,
`reconcile.mjs`, `state.mjs`, and the live arc scripts `arc-custody.mjs`,
`arc-refusals.mjs`, `arc-panel.mjs`, `arc-promote.mjs`, `arc-payout.mjs`.

---

## 12. What is checked, and by which command

| Claim | Command | Result |
|---|---|---|
| the contract behaves as specified | `python -m pytest tests/direct -q` | 576 tests, all passing |
| no protective rule is untested | `python tests/mutation_sweep.py` | 83 mutants, 83 killed, 0 anchor-missing, CONTROL green, 777 s |
| the contract passes the GenVM linter | `genvm-lint lint contracts/triggera.py --json` | AST lint only — see the note below |
| the frontend's logic holds | `npm run test` in `web/` | 59 vitest tests; `npm run typecheck` and `npx eslint .` clean |
| a clean checkout reproduces the judged deployment | `npm run verify` in `web/` | see below |
| custody reconciles on chain | `node scripts/reconcile.mjs` | escrow equals what is owed |

CI runs both jobs on every push (`.github/workflows/tests.yml`): **contract**
(direct suite, `genvm-lint`, mutation sweep gate) and **web** (`npm ci`,
typecheck, lint, tests, build). CI is **green at commit `2650cfd4`, both jobs,
every step**, confirmed through the public GitHub Actions API rather than
inferred from a badge.

`genvm-lint` runs in `check`-free AST mode by deliberate choice: its semantic
`check` can only load the SDK of the GenVM releases it knows (v0.3.0-rc7), and
this contract targets the v0.6 runner Studio Next ships. Semantic validation of
that runner happens where it can — on the deployment itself, byte-verified.

### The mutation sweep, precisely

The guard mutants are **derived from the source, not hand-listed**: a generator
disables in turn every unique single-line `if` that immediately protects a
`raise gl.vm.UserError`, so each anchor is exact by construction and a guard
added later is swept automatically. `_apply` refuses an anchor that does not
appear exactly once, and CI greps for `survived 0` and `anchor-missing 0` and
fails on a red CONTROL.

It does **not** cover multi-line conditions, guards that raise further than two
lines away, or rules expressed as arithmetic. The arithmetic that decides money
and outcomes is therefore mutated by hand: the majority test, the contradicting
count, the bond floor, the payout, the premium.

Two mutants are listed in `EQUIVALENT_NOT_RUN` and are **not counted as
killed** — both sit in `judge`'s structural validation of the model's answer.
Removing either, or both together, still refuses the round and still writes
nothing, and `run_nondet` reports a leader failure as a generic consensus
error, so no test can match the specific guard. What **is** pinned, by
`test_s16_sources_not_an_array_is_refused` and
`test_s16_a_missing_reading_for_a_row_is_refused`: malformed model output is
refused and nothing is written. What is **not** pinned: which guard refuses it.
That is a limit of the harness, written down rather than papered over.

### `npm run verify` and the surfaces it reads

`web/scripts/verify.mjs` asserts that every surface naming the contract names
the **same** address: `docs/DEPLOYMENT.md` (the row marked **current**),
`web/.env.example`, `.github/workflows/tests.yml`, `README.md`. It also refuses
a superseded address appearing as a default in the env example or the CI
workflow. This is S37 made checkable — a reviewer who clones the repo gets the
deployment that was judged.

**It passes at HEAD.** It failed until `README.md` and
`docs/DEPLOYMENT.md` existed, because nothing anchored the address -- which
is the point of the check: the documents are not commentary beside the code,
they are one of the four surfaces that must agree.

---

## 13. What has been exercised against the live deployment

Each arc script states its claims through a `check(cond, what)` helper and
exits on the count of failures, so the transcript claims exactly what a check
asserted and nothing more (S38). The transcripts are `web/arc.act12.transcript.json`,
`web/arc.act3.transcript.json`, `web/arc.act56.transcript.json` and
`web/arc.act7.transcript.json`, with logs beside them.

| Act | Script | What it established |
|---|---|---|
| 1–2 | `arc-custody.mjs` | a draft takes its **full** coverage into custody, and cancelling returns it through the ledger to a clear balance |
| 3 | `arc-refusals.mjs` | refusals, each asserted on the contract's own sentence rather than on a status code |
| 5–6 | `arc-panel.mjs` | a claim filed and a real panel round. Every evidence URL pointed at a commit that was not published, so nothing was readable; the contract returned **`UNDETERMINED`** and custody did not move |
| 7 | `arc-promote.mjs` | the `UNDETERMINED` hold promoted the policy back to `ACTIVE` |

Acts 5–6 are the design working, not a failed run. When the panel cannot read,
it does not pay — and it says so in an outcome that is first-class rather than
an error.

### Demonstrated on chain

The payout arc ran on 9th September 2026 against `trg-000001`, in eight
transactions. `settle`, `appeal`, `re_investigate` and the pull-payment `claim`
are no longer only what the contract *does* in the direct suite: they are
transactions with hashes.

| act | call | transaction |
|---|---|---|
| 8 | `file_claim` (v2) | `0xbc152aeb9606a7a8ec9b564a8c3486d6c1545c0d7393d5bbc23a4c02bcdd3619` |
| 9 | `investigate` | `0x6b675da1ea04116fbf1d4d85be7da485bbd359a413c702efdda2bd31cbf02137` |
| 9 | `promote` | `0xf864697454dbe00e30e1c543102654e67b59d2ec9bac837ec146c02e16e8e6ab` |
| 10 | `appeal` (0.05 GEN bond) | `0xa6b9ccdff6eb6f02dfd199a0879f15ade37eca8869556d63ea6037c21095b738` |
| 10 | `re_investigate` | `0x6e7f2ec6a8d998259cd53fa4213d37adff64acc1b9880df1fc98df63de0831ef` |
| 10 | `promote` (second) | `0x684d4ac6a1bd1187fdc927309a8d027f90b5808d2e55ca0462c8c24379b14c39` |
| 11 | `settle` | `0x6e7baafb6036bdf13501644d63a7aa9b46ab2b40b402f5dde37135a8aeec5abf` |
| 12 | `claim` | `0x774703402fae77f5c65833b8980b330260110120cdfb825bdc0c8598a796ef20` |

The derivation each round turned on, read from `get_decision`:

| round | publishers | qualifying | contradicting | outcome |
|---|---|---|---|---|
| v2, the claim | 2 | 2 | 0 | SATISFIED |
| v3, the re-hearing | 3 | 2 | **1** | **SATISFIED** |

The readings are named, not merely counted: the agency at 157 km/h and the
press at 161 both past the 150 threshold, and the weather provider — the row
the *insurer* added — at 149, short of it. Adding a source that disagreed moved
the count from 2 of 2 to 2 of 3 and did not flip the majority, so the appeal
failed and its bond went to the policyholder. Final state on chain:
`paid_atto` 100000000000000000, `escrow_atto` 0, `satisfied` 1, `active` 0.

What remains undemonstrated is narrower: the `lapse_appeal` path (an appeal
abandoned rather than heard) and the NOT_SATISFIED and UNDETERMINED-then-
refiled scenarios in `evidence/`. Those are pinned by the direct suite and the
mutation sweep only.
