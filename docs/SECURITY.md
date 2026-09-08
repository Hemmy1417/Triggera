# Triggera — Trust model and defences

An insurance protocol is only as good as the question "what happens when
somebody lies?" This document answers that question from the attacker's side.
It is not a summary of the mechanism — `SPEC.md` states the design and
`docs/ARCHITECTURE.md` explains how it works. What follows is what an attacker
could try, what stops it, where that defence lives, and what is left over when
the defences run out.

Two rules from the design carry most of the weight, and they are repeated
wherever they are relevant rather than stated once:

- **Readings are counted, never averaged.** One voice per publisher, at its
  least trigger-favourable page. No arithmetic mean is ever taken over sources.
- **`UNDETERMINED` is a first-class outcome, not a failure.** A record the
  panel cannot read produces a hold that pays nobody and moves nothing. Making
  evidence disappear is not an attack that wins; it is an attack that ends the
  round.

Every defence below names the symbol that implements it and the test that pins
it. Test names are from `tests/direct` and run under
`python -m pytest tests/direct -q`; contract symbols are in
`contracts/triggera.py`.

---

## 1. Scope

| | |
|---|---|
| Contract under review | `contracts/triggera.py`, class `Triggera` |
| Deployment of record | `0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` on GenLayer Studio Next, chain 61997 |
| Byte-verified | `gen_getContractCode` at that address returns 100,199 bytes, sha256 `18eaa323a0d3d156405e8584872a19aa5dc9476e55c9fd4f7a79e2bb9b371786`, identical to `contracts/triggera.py` in this checkout |
| Runner | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| Web layer | `web/`, Next.js App Router; the only server-side code is the read proxy at `web/app/api/rpc/route.ts` |

Studio Next is a development network. Nothing here has been deployed to a
production chain.

---

## 2. What is trusted with what

The whole design is an argument about this table. Nobody in it is trusted with
the outcome.

| Actor | Trusted with | Not trusted with |
|---|---|---|
| The insurer | drafting the trigger, the money, the period and the evidence basis; cancelling before anyone activates | the coverage after activation — it is locked in the contract, deposited in the same signature that drafted the policy; the outcome; the clock |
| The policyholder | naming the event window and the pages to read, both inside frozen bounds | the readings; the amount; whether its own sources count (they are `PARTY` class) |
| The model | reading pages and reporting, per source, a reading and three booleans, plus an evidence flag, conflict codes, a score and prose | the outcome, the amount, which rows count, and whether the trigger was met — `_derive_outcome` is pure code |
| A validator node | its own fetch of every source and its own re-derivation | relaying a page to any other node: nobody fetches on anyone's behalf |
| The panel leader | composing the record that gets stored | every field money reads — each is re-derived and compared by `validator_fn` |
| A fetched page | nothing | it is material under review; `_defang` strips both halves of the fence delimiter so no page can open or close a fence |
| The policy text | nothing beyond what it says inside its own fence | it is party-authored and fenced under its `terms_sha256` commitment |
| The clock | a consensus reading over public web witnesses | any party — no party supplies the current time to any method |

```text
              party-supplied                 contract-controlled
  ┌──────────────────────────────┐   ┌────────────────────────────────────┐
  │ terms · basis · claim window │   │ every node fetches every page      │
  │ claimed reading · page urls  │──▶│ itself  →  model returns READINGS  │
  └──────────────────────────────┘   │ →  _derive_outcome (pure code)     │
        frozen and hashed at         │ →  validator_fn re-derives         │
        assent; never re-opened      │ →  _credit  →  claim()             │
                                     └────────────────────────────────────┘
```

---

## 3. Attacks on the determination

Every row here is an attempt to make the record say something the panel did not
find. Each is refused inside `_panel_round`'s `validator_fn`, which re-runs the
whole judgment on its own node before comparing.

| Attack | What stops it | Pinned by |
|---|---|---|
| The leader reports `SATISFIED` over rows that do not support it | `validator_fn` compares `outcome`, `hold_reason` and `evidence_flag` exactly, and separately re-runs `_derive_outcome` over the leader's own rows | `test_validator_refuses_a_forged_outcome`, `test_validator_refuses_rows_that_do_not_produce_the_claimed_outcome` |
| A consistent lie: the leader rewrites a reading **and** recomposes the counts so its own arithmetic checks out | every validator has its own fetch and its own reading of the honest page; `INDEPENDENT` readings are compared exactly | `test_validator_refuses_a_consistent_lie_that_moves_money` |
| A fabricated reading that does not change the outcome | the per-row comparison is exact, not outcome-equivalent | `test_validator_refuses_a_forged_independent_reading_when_money_is_unchanged` |
| Flipping `window_ok`, `geo_ok` or `kind_matches` on an independent row | the same three fields are compared exactly; a false flag drops the row from `_usable_rows` | `test_validator_refuses_a_forged_independent_flag`, `test_a_false_flag_drops_the_row_from_the_count` |
| Dropping a row, forging its `url`, `kind`, `cls`, `basis` tag, `basis_round` or `readable` flag | the record comparison covers row count and each of those fields exactly | `test_validator_refuses_a_dropped_row`, `test_validator_refuses_a_forged_url`, `test_validator_refuses_a_forged_class_on_a_row`, `test_validator_refuses_a_forged_basis_tag`, `test_validator_refuses_a_forged_readable_flag` |
| Storing bytes that are not what the digest covers | `validator_fn` recomputes `_sha256_hex` over the excerpt the leader stored and refuses a digest that does not cover it | `test_validator_refuses_forged_bytes_behind_an_honest_digest` |
| Returning a packet that is not a determination at all | non-dict returns and non-`Return` leader results are refused; a VM-level leader failure is never endorsed | `test_validator_refuses_a_packet_that_is_not_a_dict`, `test_a_vm_level_leader_failure_is_never_endorsed` |
| Nudging the confidence score to change how the record reads | `score` is banded at `SCORE_BUCKET` = 10; more than one bucket apart is refused | `test_a_forged_score_two_buckets_away_is_refused` |
| Feeding the panel malformed or adversarial model output | structural validation inside `judge` raises `ERROR_LLM` before anything is derived, and `ERROR_LLM` is **never** endorsed by a validator | the `test_s16_*` family, `test_a_structurally_invalid_answer_never_reaches_the_record`, `test_an_llm_error_leader_failure_is_never_endorsed` |
| Claiming a reading for a page that could not be fetched | `judge` forces `reading = None` when `readable` is false, whatever the model said | `test_an_unreadable_independent_row_is_null_whatever_the_model_said` |
| A conclusive outcome standing over a record the panel did not call `SUFFICIENT`, however it got there | defence in depth: `promote` coerces such an outcome back to `UNDETERMINED`, and `settle` refuses a non-`SUFFICIENT` record again at the money boundary | `test_promote_coerces_a_conclusive_outcome_over_a_thin_record`, `test_settle_refuses_a_final_whose_outcome_was_forged_in_storage`, `test_settle_refuses_a_final_whose_evidence_flag_was_forged_in_storage` |

A validator that disagrees does not silently lose: the round writes nothing and
rotates.

---

## 4. Attacks on the evidence

### Stacking pages on one publisher

The cheapest attack on a "majority of independent publishers" rule is to bring
six pages from one friendly site. It does not work, because independence is
counted per **publisher**, not per page: `_registrable_domain` reduces every
host to its registrable domain, and `_publisher_readings` gives each publisher
exactly one voice — its **least trigger-favourable** usable reading (the lowest
for `GTE`/`GT`, the highest for `LTE`/`LT`).

| Attack | What stops it | Pinned by |
|---|---|---|
| Six pages from one site to manufacture a majority | one publisher, one voice | `test_stacking_pages_from_one_publisher_cannot_make_a_second_voice` |
| Adding a second page from the same publisher that reads higher | the publisher speaks with its least favourable page | `test_two_pages_on_one_publisher_speak_with_the_least_favourable_reading` |
| Two hostnames of one publisher | both reduce to the same registrable domain | `test_two_hosts_of_one_publisher_are_one_independent_voice` |
| The same trick on appeal | the rule runs identically in the second round | `test_a_second_page_from_one_publisher_is_still_one_voice_on_appeal` |

### A party's own source

Class is **inherited** from the basis entry the URL's host matches — the
submitter declares nothing. `_usable_rows` admits only `INDEPENDENT` rows, so a
`PARTY` source informs the panel's reading and can never establish the trigger.

| Attack | What stops it | Pinned by |
|---|---|---|
| Filing a claim on the policyholder's own instrument log | `_clean_rows` inherits `PARTY` from the basis; `file_claim` also requires at least one `INDEPENDENT` source | `test_a_party_source_alone_cannot_trigger_a_payout`, `test_a_package_of_party_rows_only_cannot_carry_a_payout` |
| Declaring a party source `INDEPENDENT` at claim time | a row cannot declare its own kind or class | `test_a_row_cannot_declare_its_own_kind_or_class` |
| Reaching a party origin through a subdomain to escape the class | `_clean_rows` matches the **longest** basis origin the host satisfies, and the class travels with it | `test_a_subdomain_of_a_party_origin_alone_cannot_carry_a_payout`, `test_under_a_nested_basis_the_inherited_class_decides_the_party_wall` |
| A forged `PARTY` reading from the leader | party readings are free between nodes and never enter the arithmetic, so forging one changes nothing | `test_a_party_reading_never_enters_the_arithmetic`, `test_a_forged_party_reading_is_tolerated_as_a_free_field` |

### Sources outside the agreed basis

The basis is frozen at drafting and hashed into `terms_sha256`. A claim may
only name pages inside it.

| Attack | What stops it | Pinned by |
|---|---|---|
| Naming a page on a host nobody agreed to | `_clean_rows` refuses a host that matches no basis origin | `test_an_off_basis_host_is_refused_and_nothing_is_written` |
| A host that merely *ends with* the origin text (`notagency.example.org`) | `_matches_origin` requires equality or a dot-boundary suffix | `test_a_host_that_merely_ends_with_the_origin_text_is_outside_the_basis` |
| Smuggling an off-basis host through userinfo or a query (`https://evil.io?x=@agency.example.org`) | `_split_url` ends the authority at the **first** of `/`, `?` or `#` and strips userinfo at the **last** `@`, so the parsed host is the host every node would actually fetch | `test_a_query_before_any_path_cannot_smuggle_an_off_basis_host`, `test_split_url_reports_the_host_every_node_would_actually_fetch`, `test_walls_hold` |
| Respelling one page to get two voices (trailing slash, default port, host case, fragment) | `_normalize_url` folds exactly those spellings — path and query case still distinguish pages — and duplicates are refused against both the new rows and the existing record | `test_a_second_spelling_of_a_page_already_in_the_package_is_refused`, `test_an_origin_root_with_and_without_its_slash_is_one_page` |
| Loading the basis with duplicate origins, or with a `min_independent` no basis could satisfy | `_clean_basis` refuses a duplicate origin, requires at least one `INDEPENDENT` entry, and caps `min_independent` at the count of **distinct independent publishers** | `test_basis_refuses_a_duplicate_origin_however_it_is_cased`, `test_basis_without_an_independent_origin_is_refused`, `test_min_independent_cannot_exceed_the_distinct_independent_publishers` |

### Prompt injection

A page is fetched from the open web and pasted into a prompt. It is treated as
hostile by construction.

| Attack | What stops it | Pinned by |
|---|---|---|
| A page that opens or closes a source fence and then issues instructions | `_defang` replaces **both** `<<<` and `>>>` in every fetched page and every party string, so every intact fence in the prompt was emitted by the contract | `test_a_page_cannot_open_or_close_a_source_fence` |
| A source label or policy text carrying a fence delimiter | the same `_defang` runs over labels, terms, titles and grounds | `test_a_source_label_cannot_forge_a_fence`, `test_party_terms_cannot_close_the_terms_fence` |
| A URL crafted to forge the pipe-delimited fence header | `_valid_url` admits printable ASCII only and refuses ``| < > " ' ` `` and backslash | `test_valid_url`, `test_url_spellings_the_intake_refuses` |
| A page claiming to be a later section of the prompt, or to speak for Triggera | the prompt's guardrails state that everything inside a fence is material under review, that a fence found inside a fence is that source's own fabrication, and that a mislabelled page counts against whoever chose the label | `test_the_prompt_says_the_labels_are_labels_and_not_verified_facts`, `test_the_prompt_opens_one_source_fence_per_row` |

Sanitization and the URL grammar are code. The guardrail paragraph is
instruction to a model, and is counted as depth, not as a wall.

### An unreadable or missing source

This is the case the live deployment has actually exercised, and it is not a
denial-of-service against the protocol — it is the protocol's answer.

An unreachable page yields `readable = false`, `reading = None`, and drops out
of `_usable_rows`. If that leaves fewer publishers than `min_independent`, the
outcome is `UNDETERMINED · UNCORROBORATED`; if the model calls the record less
than `SUFFICIENT`, it is `UNDETERMINED · EVIDENCE_INSUFFICIENT`. Either way no
coverage moves, the policy returns to `ACTIVE` on promotion, and the claim can
be refiled inside the grace.

Pinned by `test_no_usable_independent_reading_at_all_is_uncorroborated`,
`test_fewer_publishers_than_the_policy_requires_is_uncorroborated`,
`test_a_blank_page_is_unreadable`,
`test_an_insufficient_record_holds_and_the_insurer_expires_after_grace`.

---

## 5. Attacks on the process

### A stalled counterparty

Every state past `DRAFT` has a permissionless exit, so no party can hold the
money hostage by going quiet.

| State | Exit | Who may call it | Pinned by |
|---|---|---|---|
| `INVESTIGATING` | `investigate` | anyone | `test_walls_hold` (a stranger runs the round) |
| `PENDING_FINALITY` | `promote`, after the finality window | anyone | `test_promote_waits_for_the_finality_window_and_makes_the_decision_state` |
| `FINAL` | `settle`, after the appeal window | anyone | `test_settle_is_permissionless` |
| appeal open | `re_investigate` | anyone | `test_re_investigation_may_be_run_by_either_party_or_a_stranger` |
| appeal open and stuck | `lapse_appeal`, after `STALE_APPEAL_SECONDS` | anyone; restores the snapshot taken at filing and returns the bond | `test_lapse_opens_only_after_the_stale_window`, `test_lapse_restores_the_snapshot_exactly_and_frees_the_bond` |
| `ACTIVE` past the grace | `expire` | anyone; the coverage credits the insurer only | `test_expire_is_permissionless_and_credits_only_the_insurer` |

An uninvestigated claim gets a full finality window of patience before `expire`
can reclaim the coverage over it
(`test_expire_waits_for_an_uninvestigated_claim_to_have_its_finality_window`).
A panel that disagrees writes nothing and leaves the round available for a
retry (`test_a_disagreeing_panel_writes_nothing_and_the_appeal_survives_for_a_retry`).

### A griefing appeal

| Attack | What stops it | Pinned by |
|---|---|---|
| Appealing every loss for free | `appeal` is payable and takes exactly `_bond_for(p)` — `max(APPEAL_BOND_FLOOR_ATTO, coverage × APPEAL_BOND_BPS / 10,000)`, a 0.05 GEN floor over 5% of the coverage | `test_appeal_bond_is_exact_under_over_zero_and_double`, `test_appeal_bond_rests_on_its_floor_at_the_default_coverage` |
| Appealing to delay a payout | an appeal that does not change the outcome forfeits the bond to the counterparty; a successful one is returned | `test_unchanged_outcome_pays_the_bond_to_the_insurer_when_the_policyholder_appeals`, `test_unchanged_outcome_pays_the_bond_to_the_policyholder_when_the_insurer_appeals`, `test_a_flip_to_satisfied_returns_the_bond_and_the_second_ruling_pays` |
| Stacking appeals | one appeal may be open at a time, and the record holds at most `MAX_VERSIONS` = 6 versions, so the chain is bounded and each link costs a bond | `test_appeal_refuses_a_second_filing_while_one_is_open`, `test_appeal_stops_at_the_version_cap` |
| A stranger appealing | only the insurer or the policyholder may file, inside the appeal window, on a `FINAL` decision | `test_appeal_refuses_a_stranger`, `test_appeal_refuses_anything_but_a_final_decision`, `test_appeal_window_is_inclusive_at_its_last_second_and_closed_after` |
| Appealing to force a refetch of a page that has since changed | the second panel reads the **recorded bytes** of the appealed round — compared byte-identical and epoch-identical between nodes — and fetches live only the source the appellant added; `_dossier_intact` re-checks every digest before the round begins | `test_a_page_that_changes_after_round_one_never_changes_the_record`, `test_a_pure_re_read_makes_no_fetches_and_reads_the_recorded_bytes`, `test_re_investigate_refuses_a_recorded_snapshot_that_fails_its_digests` |
| Re-rolling a losing round | one decision per version; `investigate` refuses a decided version, and a refile is a whole new package | `test_investigate_refuses_a_version_that_was_already_decided` |

### The clock

Timed rules need a clock no party controls, so `_utc_now` runs its own
`gl.vm.run_nondet`: three `cdn-cgi/trace` witnesses with the **minimum** taken
and a mutual divergence over `MAX_CLOCK_DIVERGENCE` (300 s) refused, an
execution-layer block timestamp as a floor that fails **open**, and two beacon
heads bounding the reading in both directions that fail **closed**. The
leader/validator comparison is integer arithmetic, never prose put to a model.
`_require_clock` raises `ERROR_TRANSIENT` on a zero reading, so every timed
method fails closed and leaves state exactly as it was.

| Attack | What stops it | Pinned by |
|---|---|---|
| Skewing one edge network forward to close a window early | the minimum is taken across three candidates, and the beacon ceiling bounds it | `test_the_clock_is_the_minimum_candidate_never_the_mean_or_the_maximum`, `test_a_forward_skewed_wall_clock_hits_the_beacon_ceiling` |
| Skewing backward to keep a window open | the beacon floor catches it even with the explorer unavailable | `test_a_backward_skewed_wall_clock_hits_the_beacon_floor_without_the_explorer` |
| Killing the clock sources to freeze the protocol | writes refuse as transient and change nothing; the state is exactly recoverable | `test_a_dead_clock_refuses_the_round_as_transient_and_writes_nothing`, `test_dead_clock_refuses_settle_and_writes_nothing`, `test_create_policy_without_a_clock_locks_nothing_and_recovers` |
| Feeding an insane epoch from one witness | candidates below `MIN_SANE_EPOCH` are dropped like dead sources | `test_an_insane_trace_epoch_is_dropped_like_a_dead_source`, `test_an_insane_beacon_head_is_dropped_like_a_dead_one` |

### The money

The coverage is deposited in the same signature that drafts the policy, so a
policy never promises more than it holds. `_credit` is the only allocation path
and `claim()` is the only external value path; the ledger entry is zeroed
before the transfer is emitted.

| Attack | What stops it | Pinned by |
|---|---|---|
| Settling one policy against another's coverage | each policy credits from its own locked coverage | `test_settling_one_policy_never_reaches_another_insurers_coverage` |
| Claiming twice | the ledger is zeroed before the transfer, and a second `claim()` is refused | `test_claim_zeroes_the_ledger_emits_the_transfer_and_refuses_a_second_time` |
| Settling or expiring twice | both refuse and allocate nothing a second time | `test_second_settle_is_refused_and_allocates_nothing_twice`, `test_double_expire_is_refused_and_refunds_nothing_twice` |
| Draining a balance that is not yours | `claim()` pays the sender's own ledger entry only | `test_a_stranger_cannot_claim_the_policyholders_balance` |
| Activating with the wrong value, or the insurer insuring itself | `activate` takes exactly the premium and refuses the insurer | `test_activation_is_exactly_the_premium_and_never_the_insurer` |
| Acting on a terminal policy | every post-terminal write is refused, while the ledger still drains | `test_post_terminal_actions_on_a_paid_policy_are_all_refused`, `test_a_terminal_policy_still_lets_the_ledger_drain` |
| Changing the terms after assent | `terms_sha256` is a canonical, key-sorted commitment over the trigger, the money, the period **and** the evidence basis | `test_terms_hash_is_the_canonical_commitment_over_trigger_money_period_and_basis`, `test_terms_hash_commits_to_the_basis` |

The invariant — escrow equals locked coverage plus every unpulled ledger
balance plus open bonds — is asserted throughout the suite
(`test_escrow_tracks_deposits_minus_claims_exactly_across_an_appeal`,
`test_both_parties_claims_drain_escrow_to_exactly_zero`) and reconciled on
chain by `node scripts/reconcile.mjs`, which also checks that the contract's
real GEN balance covers what it owes.

---

## 6. The web layer

The app has no backend, no database and no auth vendor. Its one piece of
server-side code is the read proxy at `web/app/api/rpc/route.ts`, and it is
written as an allowlist rather than a relay:

- it forwards exactly two methods — a `gen_call` of `type: "read"` against the
  **one** configured contract address, and `eth_getTransactionByHash` with
  exactly one `0x`-prefixed 32-byte hash;
- everything else is refused with a JSON-RPC error, so it cannot submit a
  transaction, read another contract, or reach any other RPC method;
- request bodies over 8 KB are refused before they are parsed or forwarded;
- the pacing queue has both a wait cap and a depth cap, so a burst is refused
  rather than queued indefinitely.

Writes never pass through it: fee estimation and signing go from the connected
EIP-6963 provider to the chain directly.

Nothing in the browser decides anything. `web/lib/urls.ts` mirrors the
contract's URL, origin and publisher rules in TypeScript so the composer can
refuse locally what the contract would refuse on chain, but the contract re-runs
every rule at intake and its answer is the only one that counts.

---

## 7. Residual risks

These are real, and none of them is closed by a defence above.

**The excerpt on a live-fetched row is not corroborated between nodes.** On a
`FETCHED` or `NEW` row, `validator_fn` checks that the digest covers the bytes
the leader stored — against the leader's own bytes — and does not compare the
bytes to its own fetch. This is deliberate: two honest nodes fetching a live
page at the same instant can receive different bytes, and requiring equality
would fail the panel on correctness rather than on disagreement. The
consequence is stated rather than hidden, and pinned in both directions:
`test_a_forged_excerpt_behind_its_own_digest_is_tolerated_on_a_fetched_row`
(a leader can substitute an excerpt if it recomputes the digest) and
`test_validator_refuses_forged_bytes_behind_an_honest_digest` (it cannot leave
a digest that fails to cover what it stored). What **is** agreed exactly is the
reading that decides money, the three flags, the row's identity and its
readability — so a substituted excerpt cannot move a payout, but the stored
excerpt on a live-fetched row is the leader's record, not a corroborated one.
`RECORDED` rows are a different object and are compared verbatim, which is why
an appeal re-reads the record rather than the web.

**The clock is fetched from the open web by consensus, not read from a block.**
`_utc_now` reads public HTTP endpoints — Cloudflare-style trace endpoints, a
block explorer, beacon heads — and bounds them against each other. It is a
consensus reading of public infrastructure with a 300-second tolerance, not a
trusted timestamp: an adversary who could skew every witness the panel consults,
in the same direction, within tolerance, would move the protocol's clock. The
beacon bound fails closed and the explorer floor fails open, which narrows that
surface without eliminating it.

**The model can be wrong inside the bounds the code enforces.** Code fixes the
shape of the answer, the class of every row, the count of publishers and all of
the arithmetic. It does not fix the reading. If the panel genuinely misreads a
page — and every validator's own model misreads it the same way — the
determination is wrong and consensus will hold. The remedy is the bonded
appeal, which is a cost, not a guarantee. The `SATISFIED` and `NOT_SATISFIED`
branches have been exercised in the direct suite; on chain, the one panel round
that has run read nothing at all (see section 8).

**Two structural guards cannot be individually pinned.** `EQUIVALENT_NOT_RUN`
in `tests/mutation_sweep.py` lists two mutants inside `judge`'s structural
validation of the model's answer that are not run and are **not** counted among
the 83 killed. Removing either — or both together — still refuses the round and
still writes nothing, and `run_nondet` reports a leader failure as a generic
consensus error, so no test can match the specific guard. What is pinned, by
`test_s16_sources_not_an_array_is_refused` and
`test_s16_a_missing_reading_for_a_row_is_refused`: malformed model output is
refused and nothing is written. What is not pinned: which guard refuses it.

The sweep's reach is bounded in one more way worth saying here: it disables
single-line `if` statements that immediately protect a `raise`, so multi-line
conditions and guards that raise further away are outside it, and rules
expressed as arithmetic are covered only by the five mutants written by hand —
the majority test, the contradicting count, the bond floor, the payout and the
premium.

**`_registrable_domain` is a stated heuristic, not the public suffix list.** It
folds a host to its last two labels, or three when the last label is two
characters and the one before it is in a short list of second-level names. It
errs toward folding hosts together — treating two hosts as one voice — which is
the conservative direction for a majority rule. It does not, and cannot, detect
that two genuinely different registrable domains belong to the same
organization: such a publisher would speak twice.

**The basis is only as good as the parties' judgment at signing.** The contract
enforces that a basis has at least one `INDEPENDENT` origin, no duplicate
origins, and a `min_independent` no larger than its distinct independent
publishers, and it hashes the whole basis into `terms_sha256` so neither party
can change it afterward. It does not and cannot verify that an origin labelled
`INDEPENDENT` actually is independent of the parties. The prompt tells the
panel that kind and class are labels the parties agreed and that a mislabelled
page counts against whoever chose the label — that is a model judgment, not a
wall.

**The read proxy's protection is per instance.** Its cache and its pacer live in
process memory, so a deployment running several serverless instances has an
effective upstream rate per instance rather than a global one. That is a
mitigation for the read budget, not a guarantee of it; it is recorded in the
route's own header comment.

**The direct suite runs against a strict stub, not the GenVM.** `tests/direct`
executes the real contract module against a `genlayer` stub that runs validator
functions for real and surfaces a `False` as a failed round, with the web and
the model under test control. That is what makes the tampered-leader cases
above testable at all, but it means the consensus behaviour they pin is
modelled by the harness. What has run on real validators is the deployment
itself and the live acts in section 8.

---

## 8. What has not been demonstrated on chain

**The payout arc has not run.** `web/scripts/arc-payout.mjs` is written and
reviewed, and it is scheduled — `file_claim` needs the event window to be over
while the claim grace is still open, a narrow window. Until it runs, on this
deployment:

- no payout has been made;
- no appeal has been filed;
- no bond has been returned or forfeited;
- no settlement has occurred.

Everything this document says about `settle`, `appeal`, `re_investigate` and
`lapse_appeal` is what the contract **does** — pinned by the direct suite and
the mutation sweep, and deployed byte-for-byte at the address in section 1.
None of it is a claim about a transaction that has happened.

What **has** run against the deployment, with transcripts in `web/`: a draft
taking its full coverage into custody and a cancellation returning it through
the ledger (acts 1–2); refusals, each asserted on the contract's own sentence
(act 3); a filed claim and a real panel round, in which every evidence URL
pointed at a commit that had not been published, so nothing was readable, the
contract returned `UNDETERMINED`, and custody did not move (acts 5–6); and the
promotion of that hold back to `ACTIVE` (act 7). Acts 5–6 are the design
working: when the panel cannot read, it does not pay.

---

## 9. How these claims are checked

| Claim | Command |
|---|---|
| the contract behaves as specified | `python -m pytest tests/direct -q` — 576 tests, all passing |
| every guard the sweep derives from the source, and the arithmetic mutated by hand, is killed by the suite | `python tests/mutation_sweep.py` — 83 mutants, 83 killed, 0 anchor-missing, CONTROL green (two further mutants are listed in `EQUIVALENT_NOT_RUN` and not counted; see section 7) |
| the deployed bytes are this source | `gen_getContractCode` against the address in section 1, compared by sha256 |
| every surface names the same contract | `npm run verify` in `web/` |
| custody reconciles on chain | `node scripts/reconcile.mjs` in `web/` |
| the frontend's logic holds | `npm run test` in `web/` — 59 tests; `npm run typecheck` and `npx eslint .` clean |

CI runs both jobs — **contract** (direct suite, `genvm-lint`, mutation sweep
gate) and **web** (`npm ci`, typecheck, lint, tests, build) — on every push, and
is green at commit `2650cfd4`, both jobs, every step, confirmed through the
public GitHub Actions API rather than inferred from a badge.

Security reports belong in the repository's issues:
<https://github.com/Hemmy1417/Triggera>. This is a build on a development
network, and it has had no external security audit.
