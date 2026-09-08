# Triggera — Standards

This portfolio carries a running list of review standards, accumulated from
reviewer letters across earlier builds and numbered S1–S38. They are not
Triggera's inventions; they are the bar Triggera was held to before a line of it
was written. This document answers the ones that bear on a parametric insurance
protocol with a panel, a bond and an escrow; the index at the end lists exactly
which.

Each entry says three things: what the standard demands, what in **this**
repository satisfies it, and the command whose failure would expose it if the
answer were untrue.

The architecture is in [ARCHITECTURE.md](ARCHITECTURE.md), the trust model in
[SECURITY.md](SECURITY.md), the build brief in [../SPEC.md](../SPEC.md). This
file does not restate them; it points at symbols in them.

---

## How to read this

- **Anchored by symbol, never by line number.** Every reference names a function
  or class in `contracts/triggera.py` (`_derive_outcome`, `settle`,
  `lapse_appeal`) or a test by its full name. Line numbers drift; symbols do
  not.
- **The proof column names a command.** "Verified" without a command that would
  have failed is an assertion about the author's confidence, not about the code.
- **One standard — S38 — is answered by a section, not an entry.** It is
  [Where this document is hardest on itself](#where-this-document-is-hardest-on-itself),
  and it is the point of the document, not an appendix to it.

Two facts recur below and are stated once here:

- **UNDETERMINED is a first-class outcome, not a failure.** A panel that cannot
  establish the trigger returns a hold that pays nobody and leaves the coverage
  where it is. `promote` returns the policy to ACTIVE so the claim can be
  refiled; `expire` returns the coverage to the insurer once the grace passes.
  Nothing is stranded and nothing is invented.
- **Readings are counted, never averaged.** `_publisher_readings` gives one
  voice per publisher; `_derive_outcome` counts voices past the threshold
  against voices short of it. There is no mean, no median and no weighting
  anywhere in the money path.

---

## The commands this document leans on

| command | what it asserts | result |
|---|---|---|
| `python -m pytest tests/direct -q` | 576 direct tests against the real contract under a strict `genlayer` stub | 576 passed — re-run while writing this file |
| `python tests/mutation_sweep.py` | 83 mutants, each a disabled rule; the suite must fail for every one | 83 killed, 0 survived, 0 anchor-missing, CONTROL green, 777 s — the recorded run |
| `cd web && npm test` | 59 vitest tests over the read/write/tx layer | 59 tests — the recorded run |
| `cd web && npm run typecheck` / `npx eslint .` | types and lint | clean — the recorded run |
| `cd web && npm run verify` | every surface naming the contract names the same address | exits 0 here, all four surfaces `0xF83CB718…8c42` — re-run while writing this file |
| `node web/scripts/deploy.mjs verify 0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` | the deployed bytes are this checkout's bytes | 100,199 bytes, sha256 `18eaa323…b371786`, identical to `contracts/triggera.py` |
| `.github/workflows/tests.yml` | both jobs, every step | green at `2650cfd`, confirmed job by job through the public GitHub Actions API rather than read off a badge |

The deployment of record is `0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` on
GenLayer Studio Next (chain 61997), runner
`py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`.

---

## 1. Money: reserved at acceptance, finalized atomically

### S23 — reserve the full obligation at acceptance, not at settlement

**Demands:** the full exposure is debited into a reserved balance the moment the
obligation is accepted. A solvency check that does not also subtract is
meaningless, because N concurrent acceptances all pass it against the same
unreserved pool.

**Here:** there is no pool to check against, because there is nothing to promise.
`create_policy` is `@gl.public.write.payable` and its first act on money is
`coverage = self._value()` — the deposit **is** the coverage, bounded by
`MIN_COVERAGE_ATTO`/`MAX_COVERAGE_ATTO`, written into `Policy.coverage`, and
added to `escrow_atto` in the same call. The insurer holds no separate promise
field that settlement could later read: `settle` credits `int(p.coverage)`, and
that integer arrived with the transaction that created the policy. The deposit
happens at **drafting** — before there is a policyholder at all — so a draft that
is never activated still has its whole coverage in custody, and `cancel_policy`
returns it through the ledger. The premium is a second exact payment
(`activate`, `self._value() != premium` refused) and is credited to the insurer
at once; it is never a source of coverage.

Because each policy carries its own reserved amount, two policies cannot reach
each other's money: there is no shared balance for a race to drain.

**Proved by:**
`tests/direct/test_policies.py::test_the_deposit_is_locked_at_drafting`,
`::test_the_deposit_is_the_coverage_and_must_be_inside_its_bounds`,
`::test_draft_refuses_a_premium_at_or_above_the_coverage`;
`tests/direct/test_settlement.py::test_settling_one_policy_never_reaches_another_insurers_coverage`,
`::test_two_policies_settle_independently_with_their_own_ledgers`;
mutation sweep entries `settle: the policyholder is paid half the coverage` and
`activate: the premium never reaches the insurer`.

### S24 — finalization is atomic

**Demands:** a settlement either finalizes wholly or not at all. Partial
finalization leaves a case in a state no rule describes.

**Here:** `settle` runs every guard first — status is FINAL, no appeal open, the
appeal window closed, the outcome conclusive, the record SUFFICIENT — and only
then moves. On SATISFIED it credits the whole coverage, sets `payout_atto`,
sets status PAID and moves the counters in one call; on NOT_SATISFIED it moves
nothing and returns the policy to ACTIVE with its coverage intact. There is no
branch that credits without setting the status, and none that pays part of a
coverage: `_credit(p.policyholder, coverage)` takes the whole integer. A second
`settle` finds a status that is no longer FINAL and is refused, so a decision
cannot be spent twice.

One distinction a reviewer should not have to guess at: **allocation and
withdrawal are deliberately two steps, and that is not partial finalization.**
`settle` finalizes by crediting the pull-payment ledger; `claim()` is the party's
own later withdrawal, zeroing the ledger entry before it emits the transfer.
Every atto that enters the contract leaves through `claim()` and nowhere else.

**Proved by:**
`tests/direct/test_settlement.py::test_settlement_allocates_and_nothing_has_left_the_contract_yet`,
`::test_second_settle_is_refused_and_allocates_nothing_twice`,
`::test_a_second_satisfied_pays_the_coverage_exactly_once`,
`::test_the_coverage_is_paid_whole_with_no_rounding`,
`::test_both_parties_claims_drain_escrow_to_exactly_zero`,
`::test_stats_and_the_ledger_reconcile_at_every_step_of_a_full_arc`.

### S17 / S26 — every hold has a recoverable exit, and funds never strand

**Demands:** a bonded appeal needs a unilateral recovery path for when it never
resolves; every non-terminal state needs a defined transition out, callable by
someone who exists.

**Here:** every state past `DRAFT` has a permissionless exit on a wall-clock
deadline. `promote` after the finality window, `settle` after the appeal window,
`lapse_appeal` after `STALE_APPEAL_SECONDS`, `expire` after the coverage period
and its claim grace (with one finality window of patience for a claim nobody
investigated). None of them takes an owner, and `__init__` sets counters and
nothing else — there is no owner to take.

**Proved by:** `tests/direct/test_settlement.py::test_settle_is_permissionless`,
`::test_settle_refused_after_an_undetermined_hold_returns_the_policy_to_active`;
`tests/direct/test_appeal.py::test_lapse_opens_only_after_the_stale_window`,
`::test_lapse_returns_the_bond_to_the_appellant_whichever_party_filed`;
`tests/direct/test_smoke.py::test_an_insufficient_record_holds_and_the_insurer_expires_after_grace`;
sweep entries `expire: now <= grace_end`, `expire: now <= patience_end`,
`lapse_appeal: now <= int(p.appeal_filed_epoch) + STALE_APPEAL_SECONDS`.

### S30 — invariant tests for concurrency and post-terminal actions

**Demands:** tests for racing actors and for actions after a terminal state,
written as invariants rather than as scripted happy paths.

**Here:** conservation is asserted as an invariant across whole arcs, not at a
single step: `escrow_atto` equals locked coverage plus ledger plus open bonds at
every point of a full lifecycle, including across an appeal. Concurrency inside
a single-threaded VM shows up as a second actor arriving at a state that has
already moved — a second activation, a second settlement, a second payout — and
those are the tests; each asserts not only the refusal but that the refusal
allocated nothing.

**Proved by:**
`tests/direct/test_settlement.py::test_stats_and_the_ledger_reconcile_at_every_step_of_a_full_arc`,
`::test_escrow_tracks_deposits_minus_claims_exactly_across_an_appeal`,
`::test_second_settle_is_refused_and_allocates_nothing_twice`;
`tests/direct/test_policies.py::test_second_activation_is_refused_and_the_first_policyholder_stays_s30`.

---

## 2. Evidence: independence, and a snapshot bound to the commitment

### S35 — source-kind diversity is not source independence

**Demands:** kind diversity and independence are two rules, enforced separately.
Normalized-URL deduplication at minimum; distinct registrable domains ideally. A
build that conflates them will be read as enforcing neither.

**Here:** independence is counted **per publisher**, not per origin and not per
row. `_registrable_domain` folds a host to the publisher behind it
(`data.example.org` → `example.org`, `a.example.co.uk` → `example.co.uk`, with
the second-level suffix list stated in the source rather than hidden).
`_publisher_readings` collapses every usable row to one voice per publisher, at
that publisher's **least trigger-favourable** reading — so stacking pages from
one publisher can neither manufacture a second voice nor improve the number.
`_derive_outcome` compares `len(voices)` against `min_independent` and returns
UNDETERMINED · UNCORROBORATED when it falls short.

The two rules are separate in code at three points. `_clean_basis` refuses a
basis with no INDEPENDENT origin, refuses a duplicate origin, and refuses a
`min_independent` above the count of distinct independent publishers.
`_clean_rows` refuses a normalized-URL duplicate (`_normalize_url`: lowercased
scheme and host, default port dropped, fragment dropped, trailing slash dropped)
against both the new rows and anything already in the record. And **kind and
class are inherited from the matched basis entry, never declared by the
submitter** — a filer cannot label a page into a kind it does not have, because
a filer supplies only a URL and a label.

**Proved by:**
`tests/direct/test_claims.py::test_two_hosts_of_one_publisher_share_a_registrable_domain`,
`::test_the_publisher_of_a_co_uk_origin_keeps_its_second_level`,
`::test_an_origin_root_with_and_without_its_slash_is_one_page`,
`::test_two_different_pages_on_one_origin_are_two_rows_with_one_publisher`;
`tests/direct/test_policies.py::test_two_hosts_of_one_publisher_are_one_independent_voice`,
`::test_min_independent_cannot_exceed_the_distinct_independent_publishers`,
`::test_basis_without_an_independent_origin_is_refused`;
`tests/direct/test_investigation.py::test_stacking_pages_from_one_publisher_cannot_make_a_second_voice`,
`::test_two_pages_on_one_publisher_speak_with_the_least_favourable_reading`;
`tests/direct/test_smoke.py::test_derivation_never_averages_and_one_publisher_speaks_once`;
`tests/direct/test_appeal.py::test_a_second_page_from_one_publisher_is_still_one_voice_on_appeal`;
sweep entries `_clean_basis: origin in seen`,
`_clean_basis: min_independent > len(independent_domains)`,
`_clean_rows: norm in seen`, `derivation: contradicting voices stop being counted`.

### S36 — commitment-bind the adjudication-time snapshot; name historical vs new

**Demands:** freezing source *references* does not freeze *content*. Record, at
each judged round, a commitment to what was actually read — fetch timestamp and
content digest per source — so an appeal is explicit about which evidence is
reconsidered and which is new.

**Here:** two commitments, at two levels.

| commitment | written by | covers |
|---|---|---|
| `terms_sha256` | `create_policy` | the canonical JSON of the trigger, the money, the period, the hash of the policy text **and the evidence basis**, hashed at drafting and counter-signed by the premium |
| `evidence_root` | `_store_package` | the canonical JSON of the claim package — every row's url, host, publisher, kind, class and label, plus the event window and the claimed reading — recomputed for every version |

Per round, each row in the decision record carries its provenance in the record
itself: `basis` (`FETCHED` on a first round, `RECORDED` for bytes carried from
the appealed round, `NEW` for the appellant's addition), `basis_round`,
`fetch_epoch`, the stored `excerpt`, and `digest` over exactly the bytes stored.
`validator_fn` refuses any leader whose digest does not cover its own excerpt,
and for `RECORDED` rows requires the excerpt to be byte-identical and the
`fetch_epoch` to match — so a later panel cannot silently re-judge different
bytes under the same citation. `_dossier_intact` re-checks every digest before a
re-hearing reads the snapshot at all.

**Proved by:**
`tests/direct/test_policies.py::test_terms_hash_is_the_canonical_commitment_over_trigger_money_period_and_basis`,
`::test_terms_hash_commits_to_the_basis`,
`::test_terms_hash_changes_with_every_trigger_money_and_period_field`,
`::test_same_inputs_give_the_same_hash_under_different_ids_and_a_different_insurer_differs`;
`tests/direct/test_claims.py::test_the_root_is_the_canonical_package_and_moves_with_a_label_or_a_reading`;
`tests/direct/test_investigation.py::test_the_decision_record_carries_the_round_and_the_snapshot`;
`tests/direct/test_appeal.py::test_re_investigate_refuses_a_recorded_snapshot_that_fails_its_digests`;
sweep entry `re_investigate: not _dossier_intact(recorded.get("rows", []))`.

### S8 / S18 / S27 — the parties choose the basis at assent, and nobody edits it after

**Demands:** evidence a ruling depends on must be independent and integrity-bound,
bound at mutual assent, and the subject of a judgment must not control its
sources.

**Here:** the basis — a list of origins, each with an agreed kind and a class of
INDEPENDENT or PARTY — is fixed in `create_policy`, hashed into `terms_sha256`,
and stored in `basis_store`. There is no method that edits it. Every later URL,
in `file_claim` and in `appeal`, must match an origin already in that basis
(`_matches_origin`, longest-origin wins) or it is refused; the policyholder's
own claimed reading is stored as a **claim**, never as a reading that enters the
arithmetic. Rows whose class is PARTY are read and recorded but excluded by
`_usable_rows` from the derivation entirely, so a party's own station log can
inform the record and can never carry a payout.

**Proved by:**
`tests/direct/test_claims.py::test_a_subdomain_of_an_origin_is_inside_it_and_inherits_kind_and_class`,
`::test_a_subdomain_of_a_party_origin_alone_cannot_carry_a_payout`;
`tests/direct/test_policies.py::test_basis_refuses_a_class_outside_independent_or_party`;
sweep entries `_clean_rows: matched is None`,
`file_claim: not any(r["cls"] == "INDEPENDENT" for r in rows)`.

---

## 3. The determination: insufficiency, and consensus over the record

### S22 — an insufficiency flag must gate every conclusive verdict

**Demands:** the sufficiency flag must gate the negative verdict as well as the
positive one, coerced inside the block validators compare, plus a
defence-in-depth refusal at the settlement boundary.

**Here:** three layers, each independently sufficient.

| layer | symbol | what it does |
|---|---|---|
| derivation | `_derive_outcome` | `evidence_flag != "SUFFICIENT"` returns UNDETERMINED · EVIDENCE_INSUFFICIENT **before** any counting. This runs inside `judge`, whose output every validator re-derives, so every node coerces identically |
| promotion | `promote` | a recorded conclusive outcome over a non-SUFFICIENT record is coerced to UNDETERMINED before it can become policy state |
| settlement | `settle` | refuses outright: *a decision over an insufficient record cannot settle* |

The third layer is what catches a record whose flag was forged in storage rather
than produced by a round — the tests reach into storage to do exactly that.

**Proved by:**
`tests/direct/test_settlement.py::test_settle_refuses_a_final_whose_evidence_flag_was_forged_in_storage`,
`::test_settle_refuses_a_final_whose_outcome_was_forged_in_storage`;
`tests/direct/test_smoke.py::test_an_insufficient_record_holds_and_the_insurer_expires_after_grace`;
sweep entries `settle: p.evidence_flag != "SUFFICIENT"`,
`settle: p.outcome not in ("SATISFIED", "NOT_SATISFIED")`,
`judge: evidence_flag not in EVIDENCE_FLAGS`.

### S34 — an uncorroborated finding must not move money

**Demands:** derive a corroboration class in pure code and hold any money-moving
outcome when the class is the floor.

**Here:** the corroboration requirement is `min_independent`, chosen by the
insurer at drafting, bounded 1–3, and refused if it exceeds the number of
distinct independent publishers the basis actually contains. At derivation,
`publishers < min_independent` returns UNDETERMINED · UNCORROBORATED before any
majority is computed — a hold, not a verdict. A row is only usable at all if it
is INDEPENDENT, readable this round, inside the agreed window and area, of the
kind its basis entry claims, and carrying a sane integer reading
(`_usable_rows`).

**Proved by:**
`tests/direct/test_investigation.py::test_fewer_publishers_than_the_policy_requires_is_uncorroborated`,
`::test_no_usable_independent_reading_at_all_is_uncorroborated`,
`::test_an_unreadable_independent_row_is_null_whatever_the_model_said`;
`tests/direct/test_policies.py::test_draft_refuses_min_independent_outside_1_to_3`.

### S7 / S21 / S28 — consensus binds the record, not only the verdict

**Demands:** every economically decisive field is inside the equivalence rule,
and validators compare the persisted record, not just the judgment.

**Here:** the model never returns an outcome and never touches an amount. It
returns readings; `_derive_outcome` — pure code, run identically inside every
validator — composes the fields money reads. `validator_fn` therefore compares
three things: the derived fields exactly (`outcome`, `hold_reason`,
`evidence_flag`, `publishers`, `qualifying`, `contradicting`); the leader's own
arithmetic, **re-derived from the leader's own rows**, so a leader whose stored
readings do not produce its claimed counts is refused whatever else agrees; and
the record itself — row count, each row's `id`, `url`, `host`, `domain`, `kind`,
`cls`, `basis`, `basis_round` and readability, each digest covering its own
stored excerpt, `RECORDED` rows byte-identical with their fetch epoch, and every
INDEPENDENT row's `reading`, `window_ok`, `geo_ok` and `kind_matches`. Score is
banded to one bucket of 10; reason prose and PARTY-row readings are free,
because neither reaches the arithmetic.

**Proved by:**
`tests/direct/test_investigation.py::test_validator_refuses_a_forged_independent_reading_when_money_is_unchanged`,
`::test_validator_refuses_a_forged_independent_flag`,
`::test_validators_refuse_a_different_independent_reading_when_money_agrees`,
`::test_validators_refuse_a_different_independent_flag_when_money_agrees`.
The last two are the sharp ones: the money fields agree and the round is still
refused, which is the difference between binding a verdict and binding a record.

### S16 / S5 — structural validation before state, and fail-safe on failure

**Demands:** every ruling field is well-formed before it can touch state, and an
infrastructure or model failure is never written as an adverse finding.

**Here:** `judge` validates the model's answer structurally — the sources array,
each row's presence, reading range, boolean flags, the evidence enum, the score
— and raises `[LLM_ERROR]` inside the judged block when it does not hold.
Validators disagree with that failure and the round rotates; nothing is written.
An unreadable source is recorded as unreadable and drops out of `_usable_rows`
whatever the model claimed about it, which produces a hold rather than a denial.
`_require_clock` fails closed: no clock witness, no timed method.

**Proved by:** the `test_s16_*` family in
`tests/direct/test_investigation.py` (sources not an array, a missing reading, a
reading out of range or not a number, a non-boolean flag, a score that is not a
number, an evidence value outside the enum, and an out-of-range reading on a
PARTY row); `::test_an_unreadable_independent_row_is_null_whatever_the_model_said`;
`tests/direct/test_clock.py` for the clock's floor, ceiling and fail-closed
behaviour; sweep entries `judge: not (0 <= reading <= MAX_READING)`,
`judge: not isinstance(v, bool)`, `validator_fn: not isinstance(out, dict)`,
`_require_clock: now == 0`.

---

## 4. The appeal: recorded bytes, and the state that was appealed

### S14 / S28 — the appeal judges the recorded snapshot

**Here:** `re_investigate` reads the appealed round's stored rows and passes them
into `_panel_round` as `recorded`. Those rows are tagged `RECORDED`, their
excerpts and fetch epochs carried forward unchanged, and only the appellant's one
added source is fetched live and tagged `NEW`. Before any of it is read,
`_dossier_intact` re-hashes every stored excerpt against its digest and refuses
a snapshot that no longer matches.

### S29 — reversal restores the appealed state, not the latest one

**Demands:** snapshot the appealed state at filing and restore *that*, so the
appellant gets the remedy they argued for rather than a correction applied on top
of whatever the state has since become.

**Here:** `appeal` writes `p.appeal_snapshot` **at filing** — status, outcome,
hold reason, evidence flag, score, publishers, qualifying, contradicting, judged
version, final epoch, appeal deadline, evidence version and evidence root — as
canonical JSON. `lapse_appeal` restores exactly those fields and credits the bond
back to the appellant. It reads nothing from current state: the comment in
`appeal` says the snapshot taken now is what a lapse restores, never whatever the
state has drifted to since, and the code does that literally.

The bond itself is deterministic. `_bond_for` is `max(APPEAL_BOND_FLOOR_ATTO,
5% of coverage)`. A re-hearing that changes the outcome returns the bond to the
appellant; one that does not credits it to the counterparty, who carried the
delay.

**Proved by:**
`tests/direct/test_appeal.py::test_appeal_freezes_the_snapshot_and_holds_the_bond_in_escrow`,
`::test_lapse_restores_the_snapshot_exactly_and_frees_the_bond`,
`::test_lapse_returns_the_bond_to_the_appellant_whichever_party_filed`,
`::test_after_a_lapse_the_restored_appeal_window_still_governs_settle`,
`::test_settlement_after_a_lapse_follows_the_restored_ruling`,
`::test_a_lapsed_appeal_can_be_refiled_inside_the_window`,
`::test_appeal_bond_is_five_percent_of_a_coverage_above_the_floor`,
`::test_appeal_bond_rests_on_its_floor_at_the_default_coverage`,
`::test_a_new_source_that_splits_the_publishers_changes_the_outcome_and_returns_the_bond`;
sweep entry `bond: the floor becomes a ceiling`.

---

## 5. Release gates: a clean checkout, and proofs that claim only what they assert

### S37 — a clean checkout reproduces the judged deployment

**Demands:** every config surface naming the current contract agrees on one
address. Judges clone and run; a cutover story belongs in prose, not in
contradictory defaults.

**Here:** `web/scripts/verify.mjs` is that check, made runnable. It reads four
surfaces — the row marked **current** in `docs/DEPLOYMENT.md`,
`NEXT_PUBLIC_CONTRACT_ADDRESS` in `web/.env.example`, the build env in
`.github/workflows/tests.yml`, and the **Contract** line in `README.md` — and
requires all four to name the same address. It then re-reads the two config
files for *any* other address and fails if a superseded one appears as a
default, which is the specific way the standard was broken when it was written.
It prints every surface either way and exits non-zero on the first disagreement.

**Proved by:** `cd web && npm run verify`. In this checkout it exits 0, with all
four surfaces naming `0xf83cb718eb3eb09bcc8b24cec902687116d68c42`. The bytes
behind that address are checked separately by
`node web/scripts/deploy.mjs verify 0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42`,
which reports 100,199 bytes with sha256 `18eaa323…b371786`, identical to
`contracts/triggera.py`.

### S38 — a proof claims only what its script asserts

**Demands:** if a behaviour was observed rather than hard-asserted, the write-up
must say so in exactly those terms. For every claim, point at the assertion that
would have failed.

**Here:** this is the standard that governs the next section, and the honest
answer to it is not a table row. See below.

---

## Where this document is hardest on itself

Three places where a larger claim was available and is not made, and a list of
smaller ones.

### The two mutants that are not counted as killed

The mutation sweep reports **83 mutants, 83 killed**. That number could have been
85. Two mutations are listed in `EQUIVALENT_NOT_RUN` at the top of
`tests/mutation_sweep.py` and are excluded from the count rather than folded into
it:

```
EQUIVALENT_NOT_RUN = [
    "judge: not isinstance(readings, list)",
    "judge: s is None",
]
```

Both sit in `judge`'s structural validation of the model's answer. Removing
either one — or both together, which the sweep's own note records as tried —
leaves the round still refused
and still writing nothing: a non-list falls through to the per-row lookup, and a
missing row entry reaches `s.get("reading")` and dies there. The panel's own
sentence never surfaces either, because `run_nondet` reports a leader failure as
a generic consensus error, so no test can match on the specific guard.

The distinction this forces is exact, and it is the reason the entry exists:

- **Pinned:** malformed model output is refused and nothing is written —
  `tests/direct/test_investigation.py::test_s16_sources_not_an_array_is_refused`
  and `::test_s16_a_missing_reading_for_a_row_is_refused`.
- **Not pinned:** *which* guard refuses it.

That is a limit of the harness, not a hole in the contract, and it is written
into the sweep beside the list rather than resolved by quietly counting two more
kills. A sweep that reports a kill it did not earn is worse than a smaller sweep.

### What the sweep does not reach

Stated so the 83 is not read as "every rule in the contract".

The guard mutants are **derived from the source**, not hand-listed: a generator
disables in turn every *unique* single-line `if` that immediately protects a
`raise gl.vm.UserError`. That makes every anchor exact by construction — an
anchor cannot drift from the contract because it was read out of it — and it
means a guard added later is swept the next time the sweep runs. `_apply`
refuses to mutate when its anchor does not appear exactly once, so a mistyped
anchor is reported as `ANCHOR MISSING` rather than silently skipped, and CI
greps for `anchor-missing 0`.

The cost of "unique" is that a guard whose exact source line repeats is not in
the list. `if p.appeal_open == "yes":` occurs six times — in `file_claim`,
`investigate`, `promote`, `appeal`, `settle` and `expire` — so no mutant
disables it; it is pinned by the direct suite instead
(`tests/direct/test_settlement.py::test_settle_refused_while_an_appeal_is_open_however_late`,
`tests/direct/test_settlement.py::test_expire_refuses_while_an_appeal_is_open`,
`tests/direct/test_investigation.py::test_investigate_refuses_while_an_appeal_is_open`). Multi-line conditions and
guards that raise more than two lines away are likewise out of the generator's
reach. Rules expressed as arithmetic have no `if`/`raise` shape at all, so five
mutants are written by hand for the ones that decide money and outcomes: the
majority test, the contradicting count, the bond floor, the payout, and the
premium.

One operational wrinkle, also stated rather than hidden: the sweep copies the
repository from an absolute `SRC` path, and CI rewrites that line to the
checkout root before running it. A clone anywhere else needs the same one-line
change.

### The payout arc is written and has not been run

`web/scripts/arc-payout.mjs` exists, is complete, and was reviewed before any
run. It has **not been executed against the deployment**.

Therefore, and without qualification: **no payout, no appeal, no bond
forfeiture and no settlement has happened on
`0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42`.** Everything section 1 and section
4 say about the payout path, the bond and the restored snapshot describes what
the contract *does*, proved by the direct suite and the mutation sweep — not
something a transcript shows happening on chain.

What *has* run against the deployment, with transcripts under `web/`:

| act | script | what it showed |
|---|---|---|
| 1–2 | `arc-custody.mjs` | a draft takes its full coverage into custody; cancelling returns it through the ledger and the insurer pulls it with `claim()` |
| 3 | `arc-refusals.mjs` | refusals, each asserted against the contract's own sentence |
| 5–6 | `arc-panel.mjs` | a claim filed and a real panel round. Every evidence URL pointed at a commit that had not been published, so nothing was readable, and the contract returned UNDETERMINED with custody unmoved |
| 7 | `arc-promote.mjs` | the UNDETERMINED hold promoted the policy back to ACTIVE; nothing paid, the coverage still in custody |

Acts 5–6 are worth reading twice. The panel could not read a single page and the
contract did not pay — which is the behaviour the whole design exists to
guarantee, obtained by accident rather than by staging. It is also the reason
the payout arc is a separate run: `file_claim` refuses an event window that is
not yet over and refuses a claim after the coverage period's grace has passed, so
the payout path can only be driven inside the window between those two
deadlines.

### Smaller things not claimed

- **`genvm-lint` runs as AST validation only** in CI. The contract targets the
  GenVM v0.6 runner Studio Next ships, and the linter's semantic `check` can only
  load the SDK of the releases it knows. Semantic validation happens where it
  can: on the deployment, byte-verified.
- **`_registrable_domain` is a suffix heuristic**, not a public-suffix-list
  implementation. Its second-level list is ten entries, written in the source and
  tested; a publisher under a suffix outside that list would fold to the wrong
  domain. Stated rather than implied.
- **CI green is claimed at commit `2650cfd`**, both jobs, confirmed through the
  public GitHub Actions API. It is not claimed for any later commit that has not
  been checked the same way.
- **The mutation sweep figure (83/83, 777 s) is a recorded run**, not one re-run
  while writing this file. The direct suite (576 passed) and `npm run verify`
  (exit 0) were re-run.

---

## Standard by standard, at a glance

| standard | where it is answered |
|---|---|
| S5 fail-safe on infrastructure or model failure | §3, `judge` / `_require_clock` |
| S7 equivalence covers every decisive field | §3, `validator_fn` |
| S8 / S18 evidence independent and bound at assent | §2, `_clean_basis` / `terms_sha256` |
| S13 windows are wall-clock | §1 and §3 — `_require_clock` gates every timed method |
| S14 the appeal judges the recorded snapshot | §4, `re_investigate` |
| S16 structural validation before state | §3, `judge` |
| S17 unilateral recovery for a bonded appeal | §1, `lapse_appeal` |
| S20 the clock needs an independent-mechanism ceiling | §3, `_utc_now`'s beacon ceiling and `tests/direct/test_clock.py` |
| S21 consensus binds the record | §3, `validator_fn` |
| S22 insufficiency gates every conclusive verdict | §3, three layers |
| S23 reserve the full obligation at acceptance | §1, `create_policy` |
| S24 finalization is atomic | §1, `settle` |
| S26 every hold has a recoverable exit | §1, the permissionless exits |
| S27 the subject controls neither identity nor sources | §2, the frozen basis |
| S28 consensus compares the exact persisted bytes | §2 and §4, `_dossier_intact` |
| S29 reversal restores the appealed state | §4, `appeal` / `lapse_appeal` |
| S30 concurrency and post-terminal invariants | §1, the conservation tests |
| S34 an uncorroborated finding moves no money | §3, `min_independent` |
| S35 independence, not kind diversity | §2, `_registrable_domain` |
| S36 commitment-bind the adjudication-time snapshot | §2, `evidence_root` and row provenance |
| S37 a clean checkout reproduces the deployment | §5, `npm run verify` |
| S38 a proof claims only what its script asserts | the section above |
