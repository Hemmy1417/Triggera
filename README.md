<img src="web/app/icon.svg" width="56" alt="Triggera">

# Triggera

**The policy defines the rules. Reality is investigated. Consensus settles the outcome.**

Triggera is parametric insurance on GenLayer: an insurer deposits a policy's
full coverage against a measurable trigger and an evidence basis frozen at
signing, and after an event a validator panel fetches the agreed pages itself
and reports only what each page states. Deterministic contract code — never the
model — counts one voice per independent publisher and derives SATISFIED,
NOT_SATISFIED or UNDETERMINED, and the coverage moves only after a finality
window and an appeal window, through a pull-payment ledger.

---

## Deployment

| | |
|---|---|
| **Contract** | `0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` |
| **Network** | GenLayer Studio Next, chain 61997 |
| **RPC** | `https://studio-next.genlayer.com/api` |
| **Runner** | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| **Explorer** | [`/address/0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42`](https://explorer-studio-dev.genlayer.com/address/0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42) |
| **Source** | `contracts/triggera.py`, class `Triggera` |
| **App** | [triggera.vercel.app](https://triggera.vercel.app) |

The deployed bytes are the bytes in this checkout. `gen_getContractCode` for
that address returns 100,199 bytes, sha256
`18eaa323a0d3d156405e8584872a19aa5dc9476e55c9fd4f7a79e2bb9b371786`, identical to
`contracts/triggera.py`. The deployment carries CRLF endings and `.gitattributes`
checks the file out as LF, so a clone holds the same source at sha256
`b7a67dba…9b3c4cc0`; the command normalizes both and prints each digest, and
[DEPLOYMENT.md](docs/DEPLOYMENT.md) sets out why there are two:

```bash
node web/scripts/deploy.mjs verify 0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42
```

`get_config` reports `"version": "0.1.0"`. Line 1 of the contract reads
`# v0.3.0`: that is the GenVM calldata-format header, not a contract version.

---

## Lifecycle

```text
  insurer                                                    policyholder
     |
     | create_policy  (payable: the FULL coverage)
     |   trigger . insured area . period . premium . terms . evidence basis
     |   -> DRAFT, the whole coverage in custody
     |                              activate  (payable: exactly the premium)
     |                                -> ACTIVE, the premium credited to the insurer
     |
     |                     ...the world happens...
     |
     |                              file_claim (event window + pages, all
     |                                inside the frozen basis)
     |                                -> INVESTIGATING
     v                                                                v

                       investigate            (anyone)
     every validator FETCHES every page itself and returns READINGS ONLY;
     deterministic code derives the outcome  (_derive_outcome)
                       -> PENDING_FINALITY

                       promote                (anyone, after the finality window)
          +--------------------------+----------------------------+
   SATISFIED / NOT_SATISFIED                              UNDETERMINED
   -> FINAL, the appeal window opens              -> back to ACTIVE; a claim
                                                     can be refiled inside
                                                     the claim grace
          |
          | appeal      (a party, bond = max(0.05 GEN, 5% of coverage),
          |              optionally ONE new source from the basis)
          | re_investigate (anyone) re-reads the RECORDED bytes and fetches
          |              only what the appellant added; the bond returns if
          |              the outcome changed, otherwise it goes to the
          |              counterparty
          | lapse_appeal (anyone, if a round never lands: snapshot restored,
          |              bond back to the appellant)
          v
   settle                (anyone, after the appeal window)
     SATISFIED     -> the whole coverage credited to the policyholder, PAID
     NOT_SATISFIED -> nothing moves, the policy returns to ACTIVE

   expire                (anyone, after the coverage period and its claim
                          grace) -> the coverage credited back to the insurer

   claim()   the only external value path: the contract credits, a party pulls
```

Every state past `DRAFT` has a permissionless exit. Nothing is hostage to a
party or to the model.

### How the outcome is derived

`_derive_outcome` is pure code, run identically inside every validator:

| record | outcome |
|---|---|
| the evidence record is not `SUFFICIENT` | UNDETERMINED · EVIDENCE_INSUFFICIENT |
| fewer independent publishers with a usable reading than `min_independent` | UNDETERMINED · UNCORROBORATED |
| a majority of publishers read past the threshold | SATISFIED |
| a majority read short of it | NOT_SATISFIED |
| an exact split | UNDETERMINED · SPLIT_EVIDENCE |

Three properties, stated plainly because they are the point:

- **Readings are counted, never averaged.** One voice per publisher —
  registrable domain, `_registrable_domain` — and a publisher with several
  usable pages speaks with its *least trigger-favourable* reading
  (`_publisher_readings`). Stacking pages on one domain cannot manufacture a
  second voice or a better number. Party-class rows never enter the arithmetic
  (`_usable_rows`).
- **UNDETERMINED is a first-class outcome, not a failure.** It pays nobody,
  moves nothing, returns the policy to ACTIVE and can be refiled inside the
  claim grace. `settle` refuses a record that is not `SUFFICIENT`, and
  `promote` coerces any conclusive outcome recorded over one.
- **The model never returns an outcome and never touches an amount.** It
  returns per-source readings and window / area / kind checks; the contract
  composes every field money reads.

---

## What is verified

| check | result | reproduce |
|---|---|---|
| Direct suite | 576 tests pass | `python -m pytest tests/direct -q` |
| Mutation sweep | 83 mutants, 83 killed, 0 survived, 0 anchor-missing, CONTROL green (777 s) | `python tests/mutation_sweep.py` |
| Web suite | 59 tests pass | `cd web && npm test` |
| Types | clean | `cd web && npm run typecheck` |
| Web lint | clean | `cd web && npx eslint .` |
| Deployed bytes | sha256 `18eaa323…b371786` (100,199 bytes, CRLF) — the same source a clone checks out as LF, sha256 `b7a67dba…9b3c4cc0`. The command normalizes line endings and prints both, so it holds from any checkout; [DEPLOYMENT.md](docs/DEPLOYMENT.md) carries the reasoning | `node web/scripts/deploy.mjs verify 0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` |
| Surfaces agree | checks that all four surfaces naming the contract name one address | `cd web && npm run verify` |
| CI | both jobs green at `2650cfd` | `.github/workflows/tests.yml` |

CI runs two jobs: **contract** (the direct suite, `genvm-lint` AST validation,
and the mutation sweep gate, which greps for `survived 0`, `anchor-missing 0`
and no failed CONTROL) and **web** (`npm ci`, typecheck, lint, tests, build).
Green at commit `2650cfd` was confirmed job by job and step by step through the
GitHub Actions API, not read off a badge.

`npm run verify` (`web/scripts/verify.mjs`) is the clean-checkout check: every
surface that names the contract — the deployment ledger, `web/.env.example`,
the CI build env, and this README — must name the *same* address, and a
superseded address may never appear as a default. It exits non-zero on the
first disagreement.

### The mutation sweep, precisely

The guard mutants are **derived from the source**, not hand-listed: a generator
disables in turn every unique single-line `if` that immediately protects a
`raise gl.vm.UserError`, so each anchor is exact by construction and a guard
added later is swept the next time it runs. Five more are hand-written for the
arithmetic no `if`/`raise` shape covers: the majority test, the contradicting
count, the bond floor, the payout, and the premium.

Two mutants are listed in `EQUIVALENT_NOT_RUN` and are **not** counted as
killed. See the limitations below.

One wrinkle worth stating: the sweep copies the repository from an absolute
`SRC` path. CI rewrites that line to the checkout root before running it (see
the sweep step in `.github/workflows/tests.yml`); a clone anywhere else needs
the same one-line change.

### On chain so far

Each act is a script under `web/scripts/`; each prints every check and writes a
transcript beside itself (untracked).

| act | script | what it showed |
|---|---|---|
| 1–2 | `arc-custody.mjs` | a draft takes its FULL coverage into custody; cancelling returns it through the ledger, and the insurer pulls it with `claim()` |
| 3 | `arc-refusals.mjs` | fifteen refusals, each asserted against the contract's own sentence |
| 5–6 | `arc-panel.mjs` | a claim filed (four sources recorded: three INDEPENDENT, one PARTY) and a real panel round. Every evidence URL pointed at a commit that had not been published, so nothing was readable — the contract returned UNDETERMINED · EVIDENCE_INSUFFICIENT with custody unmoved. When the panel cannot read, it does not pay |
| 7 | `arc-promote.mjs` | the UNDETERMINED hold promoted the policy back to ACTIVE; nothing paid, the coverage still in custody |

| 8–12 | `arc-payout.mjs` | the payout path, end to end. A second claim citing the agency and the press only; the panel read both live and returned SATISFIED on 2 of 2. The insurer then appealed with a 0.05 GEN bond and **added the source that disagreed** — the weather provider at 149 km/h. The re-hearing counted three publishers, two past the trigger and one short: **SATISFIED stood**, the appeal failed and its bond was forfeited to the policyholder. Settlement moved the whole 0.1 GEN coverage, and one `claim()` withdrew coverage and bond together. Custody ended at zero |

Every act above has run on this deployment. The eight transactions of the
payout arc are listed in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Quickstart

```bash
# contract tests — Python 3.12, pytest only. No chain, no network:
# conftest.py runs the real contract against a strict `genlayer` stub.
pip install pytest
python -m pytest tests/direct -q

# the mutation sweep — runs the whole suite once per mutant (~13 minutes)
python tests/mutation_sweep.py

# the web app
cd web
npm ci
cp .env.example .env.local          # already points at the deployment above
npm run dev                         # http://localhost:3000

# the web gates
npm test && npm run typecheck && npx eslint . && npm run verify
```

---

## Repository

| path | what it is |
|---|---|
| `contracts/triggera.py` | the contract: class `Triggera`, 100,199 bytes |
| `tests/direct/` | the strict-stub harness (`conftest.py`) and seven test modules |
| `tests/mutation_sweep.py` | the sweep, its equivalence list, and its gate |
| `web/app/` | Next.js 16 App Router: `/`, `/policies`, `/policies/[id]`, `/policies/[id]/investigation/[v]`, `/create`, `/rules`, and the `/api/rpc` read proxy |
| `web/scripts/` | `deploy.mjs`, `verify.mjs`, `reconcile.mjs`, `state.mjs`, `arc-*.mjs` |
| `web/tests/` | vitest: chain config, reads, signed writes, the tx ladder |
| `evidence/` | the fixture pages, and `evidence/README.md` describing the origins and scenarios |
| `SPEC.md` | the build brief |
| `docs/DESIGN.md` | the visual system |

Repo: <https://github.com/Hemmy1417/Triggera>

---

## Honest limitations

**Two refusals were demonstrated but not attributed.** Re-running `settle` on
a PAID policy and `claim` with an empty balance were both refused, which is the
property that matters. Studio Next returned a bare `InvalidInputRpcError` at
fee estimation rather than the contract's own sentence, so that run does not
prove *which* rule refused them. The arc records these separately from its
passing checks rather than counting them as proofs; the sentences themselves
are pinned in the direct suite.

**One policy, one storm.** The payout arc ran against `trg-000001` with the
`storm-07` fixtures. The `storm-12` (NOT_SATISFIED, expiry) and `storm-07b`
(UNDETERMINED, then refiled) scenarios in `evidence/` are written and have not
been run on chain; the contract's behaviour for them is covered by the direct
suite only.

**The one panel round that ran on chain read nothing.** Its evidence URLs
resolved to a commit that had not been published, so every page 404'd and the
outcome was UNDETERMINED · EVIDENCE_INSUFFICIENT with zero publishers. That is
the correct behaviour and worth having on the record, but it means the
SATISFIED and NOT_SATISFIED branches have been exercised in the direct suite
only, never yet by validators reading real pages.

**Studio Next is a development network.** Chain 61997 is where this contract
lives; it is not a production chain, and nothing here has been deployed to one.

**The evidence is fixtures, not feeds.** The pages under `evidence/` are
committed test documents, served to validators from four CDN origins that
mirror this repository at a pinned commit
(`raw.githubusercontent.com`, `cdn.jsdelivr.net`, `rawcdn.githack.com`,
`raw.githack.com`). No meteorological API is read. The pages identify the event
by storm number rather than by calendar date.

**Two guards are not distinguishable through the public surface.**
`EQUIVALENT_NOT_RUN` in `tests/mutation_sweep.py` lists two mutants inside the
panel's structural validation of the model's answer that are not run and not
counted among the 83 killed. Removing either — or both together — still refuses
the round and still writes nothing, and `run_nondet` reports a leader failure
as a generic consensus error, so no test can match on the specific guard. What
is pinned: malformed model output is refused and nothing is written. What is
not pinned: which guard refuses it.
