# Triggera — Intelligent Contract Submission Notes

```text
Category:
Standalone Intelligent Contracts

Title:
Triggera — Parametric Insurance Verification and Settlement

One-line thesis:
A parametric insurance protocol where the policy freezes its trigger and its
evidence perimeter before any event, a validator panel independently reads
the named publishers when a claim is filed, and deterministic code counts
publishers — never averages them — to derive SATISFIED, NOT_SATISFIED or
UNDETERMINED and move the coverage accordingly.

Repository:
https://github.com/Hemmy1417/Triggera

Live application:
https://triggera.vercel.app

Canonical Studio Next address:
0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42

Explorer:
https://explorer-studio-dev.genlayer.com/address/0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42
(transactions open at https://explorer-studio-dev.genlayer.com/tx/<hash>)

Chain / runner:
GenLayer Studio Next, chain 61997
py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng

Byte verification:
100,199 bytes at the address, sha256
18eaa323a0d3d156405e8584872a19aa5dc9476e55c9fd4f7a79e2bb9b371786,
identical to contracts/triggera.py. A clean clone checks the file out with LF
endings and hashes to
b7a67dbadb95ae6aaffc2febe55f5ff7f0d705ee90051a9a235678019b3c4cc0 — the same
source, different line endings. docs/DEPLOYMENT.md states both digests and the
command that reproduces them, because a check that only passes on the author's
machine is not a check.
```

## Why GenLayer

Parametric insurance already knows how to write a trigger: *sustained wind at
or above 150 km/h over a 24-hour window, in this area*. What it has never
solved is who reads the world and says whether that happened.

Today that is an oracle operator or the insurer's own adjuster, and both are
the same failure: one party decides whether the other gets paid. The threshold
comparison is arithmetic and belongs in code. Reading a meteorological
bulletin and extracting the sustained wind speed it states, for the right
place and the right window, is a judgment over prose — and it is the judgment
the money turns on.

GenLayer lets one leader propose a reading per source and every validator
independently fetch the same page and judge it themselves. On an INDEPENDENT
row the reading, and the window, geography and kind checks, must match the
validator's own fetch exactly or the round is refused. Nothing that moves an
atto is taken on the leader's word.

## Consensus

One `gl.vm.run_nondet` round per evidence package. The leader fetches every
cited page and states, per source, a whole-number reading and three booleans:
is it for the claimed window, the insured area, and the kind of source the
policy agreed it is. Every validator does the same work independently and
compares field by field.

What is compared exactly on an INDEPENDENT row: `reading`, `window_ok`,
`geo_ok`, `kind_matches`, `readable`, and the row's identity. A PARTY row —
the policyholder's own instrument — is shown and never counted, so its
reading is free. Excerpt text is digest-sealed to the leader's own bytes and
is not itself corroborated; the application says so on the page rather than
implying the panel agreed on it.

## The derivation, in code

The model returns readings. It never returns an outcome and never touches an
amount. `_derive_outcome` then runs in pure Python:

- one voice per publisher, keyed by **registrable domain** — two pages from
  the same publisher are one voice, at its least trigger-favourable reading,
  so stacking pages cannot manufacture a majority;
- a publisher counts only if its row is readable, in-window, in-area and the
  kind it was agreed to be;
- fewer counted publishers than the policy's `min_independent` is
  UNDETERMINED · UNCORROBORATED, not a refusal to pay;
- an exact split is UNDETERMINED · SPLIT_EVIDENCE — the protocol will not
  break a tie by guessing;
- otherwise a strict majority past the threshold is SATISFIED, and a majority
  short of it is NOT_SATISFIED.

**Conflicting sources are never averaged.** Averaging is how a parametric
product quietly turns a disagreement into a payout nobody agreed to. Triggera
counts publishers, and the interface draws that count rather than a mean.

## UNDETERMINED is a first-class outcome

A hold is not a failure state. It returns the policy to ACTIVE, moves nothing,
and lets the policyholder file a better claim inside the grace. Only after the
grace closes may the insurer reclaim. The contract cannot be pushed into
paying by an unreadable record, and it cannot strand the coverage either.

## What has run on chain

| what | outcome |
|---|---|
| Custody at drafting, and cancellation | the draft locks the **full coverage**; cancelling returns it through the ledger |
| Refusals | each asserted against the contract's own sentence |
| A panel round with unreachable evidence | UNDETERMINED · EVIDENCE_INSUFFICIENT, custody unmoved — when the panel cannot read, it does not pay |
| **The payout arc, 8 transactions** | claim on 2 publishers (157, 161 past a 150 trigger) → SATISFIED; the **insurer appealed with a bond and added the source that disagreed** (provider 151→149 short); the re-hearing counted 3 publishers, 2 past and 1 short; **SATISFIED stood**, the appeal failed, the bond was forfeited to the policyholder; settlement moved the whole coverage; one `claim()` withdrew coverage and bond together; custody reconciled to **zero** |

The appeal is the part worth reviewing. It is an attack made with *true*
evidence — a real reading, from a publisher the policy itself named, that
genuinely fell short of the trigger. It moved the count from 2 of 2 to 2 of 3
and did not flip the majority. Attacking the record cost the attacker its bond
and changed nothing.

Transaction hashes are listed in `docs/DEPLOYMENT.md`.

## Tests

| suite | count | command |
|---|---|---|
| Direct mode | 576 | `python -m pytest tests/direct -q` |
| Mutation sweep | 83 mutants, **83 killed, 0 survived, 0 anchor-missing**, CONTROL green | `python tests/mutation_sweep.py` |
| Web | 59 | `cd web && npm test` |

The sweep disables one protective rule at a time in a scratch copy and proves
the suite fails. A mutant that survives is a rule nothing pins. Five survived
on the first run and each was pinned rather than excused — including two at
the LLM boundary, where the contract's own comment cites a standard for
validating model output that no test had exercised.

## Honest limitations

- `lapse_appeal` and its snapshot restore have not run on chain.
- Two refusals were demonstrated without attribution: re-running `settle` on a
  PAID policy and `claim` on an empty balance were both refused, but the node
  returned a bare RPC error rather than the contract's sentence, so that run
  does not prove *which* rule refused them. The arc records this as its own
  result rather than counting it as a proof.
- The evidence fixtures are committed to this repository and served by four
  CDN origins pinned to a commit. They are real pages fetched over the real
  web by every validator, but they are ours; a production deployment would name
  publishers it does not control.

---

## Portal description

```text
Parametric insurance pays on a measurable trigger, but someone still has to
read the world and say whether it happened. Today that is an oracle operator
or the insurer's own adjuster: one party deciding whether the other is paid.

Triggera freezes the trigger and the evidence perimeter when the policy is
written. On a claim, every validator independently fetches the named
publishers and judges them itself: on an independent source, the reading and
its window, area and kind checks must match that validator's own fetch, or the
round is refused. Code then counts publishers, one voice per registrable
domain, and derives SATISFIED, NOT_SATISFIED or UNDETERMINED. Sources are
never averaged. UNDETERMINED is first-class: it moves nothing and invites a
better claim before the insurer may reclaim.

Byte-verified on Studio Next, with the payout arc on chain: the insurer
appealed with a bond, adding a source that disagreed; the majority held at two
of three and the bond was forfeited.
```
