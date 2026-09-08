# Triggera — Deployment Ledger

This file is the record of which contract is the deployment of record, and the
surface every other surface is checked against. `web/scripts/verify.mjs` reads
the row marked **current** below and requires `web/.env.example`,
`.github/workflows/tests.yml` and `README.md` to name the same address. If this
file and the chain disagree, this file is wrong and must be corrected — not the
other way round.

---

## Deployment of record

| Version | Address | Status | Network |
|---|---|---|---|
| v0.1.0 | `0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` | **current** | GenLayer Studio Next, chain 61997 |

| | |
|---|---|
| **Chain id** | `61997` |
| **RPC** | `https://studio-next.genlayer.com/api` |
| **Explorer** | [`/address/0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42`](https://explorer-studio-dev.genlayer.com/address/0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42) |
| **Runner** | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| **Source** | `contracts/triggera.py`, class `Triggera` |
| **Signing key** | `web/scripts/deploy.mjs` signs with the `CREATOR` key in `web/.data/keys.json` (gitignored, not in the repository) |

The explorer serves `/address/<addr>` and `/tx/<hash>`; both are also the
routes `GENLAYER_EXPLORER_URL` in `web/lib/config.ts` builds links from.

### Which version, exactly

`get_config` returns `"version": "0.1.0"`. That is the contract's own version
and the one this ledger records.

Line 1 of `contracts/triggera.py` reads `# v0.3.0`. That is the GenVM
**calldata-format header**, not a version of this contract. Line 2 is the
`Depends` comment naming the runner above.

---

## Byte verification

The bytes at that address are the bytes of `contracts/triggera.py` in this
working tree.

| | |
|---|---|
| **Method** | `gen_getContractCode` against `0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` on the RPC above, decoded and compared with the file in this checkout |
| **Size** | 100,199 bytes |
| **sha256** | `18eaa323a0d3d156405e8584872a19aa5dc9476e55c9fd4f7a79e2bb9b371786` |
| **Result** | byte-for-byte identical |

Reproduce it:

```bash
node web/scripts/deploy.mjs verify 0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42
```

`deploy.mjs` fetches the deployed source, prints the digest and length of both
sides, and exits non-zero on any difference — printing the first line that
differs, so a mismatch names itself instead of being a bare failure.

### One source, two digests: line endings

This matters, because a reviewer who clones the repository and runs the command
above can get a mismatch from a source that is in fact the same text.

| Bytes | sha256 | What it is |
|---|---|---|
| 100,199 | `18eaa323a0d3d156405e8584872a19aa5dc9476e55c9fd4f7a79e2bb9b371786` | the deployed source, and `contracts/triggera.py` in this working tree — **CRLF** endings, 1,973 CR bytes |
| 98,226 | `b7a67dbadb95ae6aaffc2febe55f5ff7f0d705ee90051a9a235678019b3c4cc0` | the same file as the git blob at `HEAD`, and as a fresh clone checks it out — **LF**, no CR bytes |

`.gitattributes` declares `*.py text eol=lf`, so the committed blob is LF and a
clean checkout is LF. The deployed contract carries CRLF. The two digests are
the same source under two line-ending conventions, and only the first one is
the deployment of record.

To reproduce the deployed digest from any checkout, hash the file with CRLF
endings:

```bash
python -c "import hashlib,pathlib; d=pathlib.Path('contracts/triggera.py').read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'); print(len(d), hashlib.sha256(d).hexdigest())"
# 100199 18eaa323a0d3d156405e8584872a19aa5dc9476e55c9fd4f7a79e2bb9b371786
```

Two consequences, both real:

- `node web/scripts/deploy.mjs verify …` compares the live string to the file
  on disk exactly. On an LF checkout it reports a difference at line 1 even
  though the text is identical. The digest command above is the check that
  survives a clone.
- `deploy.mjs` **refuses to deploy** source carrying CR bytes — it throws
  `contracts/triggera.py carries CR bytes — normalize to LF before deploying`.
  A redeploy therefore always publishes the LF bytes, whose digest is the
  second row above, and this ledger must be rewritten with the new address,
  size and digest when that happens.

---

## Superseded deployments

| Address | Size | sha256 | Where it was named |
|---|---|---|---|
| `0x64f36CabFfd110d29eb7E8a96b1D0E68C2CDB4Da` | 97,808 bytes | `fd9665b7ccca2f1ec01c88f4589c4323c4f546c6b5810a4b47e14f6f79d2281b` | `web/.env.example` from commit `55f3484` until `4d76e0f` |

It is a Triggera contract on the same chain and the same runner — its first
lines are this contract's header — but an earlier revision of the source, and
it does not match `contracts/triggera.py` today. It is recorded here so the
address is accounted for rather than merely absent. `verify.mjs` refuses a
superseded address that appears as a default in `web/.env.example` or
`.github/workflows/tests.yml`; a ledger row is the one place it belongs.

Nothing in this repository points at that address any more, and no claim in any
document rests on it.

---

## Redeploying

```bash
cd web
npm ci                          # deploy.mjs imports genlayer-js from web/node_modules
node scripts/deploy.mjs         # deploy, wait for finality, print the address
node scripts/deploy.mjs verify 0x…   # then prove the bytes
```

What the script does, in order: reads the `CREATOR` key from `web/.data/keys.json`,
refuses source carrying CR bytes, takes a fee estimate explicitly and floors it
at `10^15` atto (Studio Next refuses a transaction with no fee distribution and
a zero deposit), sends the deployment, then polls `eth_getTransactionByHash` for
up to six minutes. On `FINALIZED` it prints the leader's `execution_result` and
the contract address; on a non-`SUCCESS` leader it prints the tail of the
GenVM stderr and exits non-zero.

`web/.data/keys.json` is gitignored, so a redeploy needs a key file of its own
with a funded `CREATOR` account on chain 61997.

### After a redeploy, update all of these

A deployment that is not recorded everywhere is a deployment a reviewer cannot
reproduce. In one commit:

| Surface | What changes |
|---|---|
| `docs/DEPLOYMENT.md` | the **current** row, the byte-verification table (size and digest both change), and the old address moved to **Superseded deployments** |
| `web/.env.example` | `NEXT_PUBLIC_CONTRACT_ADDRESS` |
| `.github/workflows/tests.yml` | `NEXT_PUBLIC_CONTRACT_ADDRESS` in the **web** job's build step |
| `README.md` | the `**Contract**` row and its explorer link |
| the Vercel project | `NEXT_PUBLIC_CONTRACT_ADDRESS`, **before** the next build — `web/lib/config.ts` reads it at build time, so the address compiles into the bundle and an env change without a rebuild serves the old contract |

Then `cd web && npm run verify` must pass, and the live-acts section below is
stale: it describes transactions against the previous address, and none of it
carries over.

---

## The web app's environment

`web/.env.example` holds the deployment of record. `cp .env.example .env.local`
is enough to run against it.

| Variable | Value in `.env.example` | Read by | If unset |
|---|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | `0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` | `web/lib/config.ts`, `web/app/api/rpc/route.ts` | `CONTRACT_CONFIGURED` is false: reads in `web/lib/read.ts` throw `no contract configured`, and the shell and `/create` block rather than read a blank address |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio-next.genlayer.com/api` | `web/lib/config.ts` | defaults to the same URL |
| `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61997` | `web/lib/config.ts` | defaults to `61997` |
| `NEXT_PUBLIC_GENLAYER_EXPLORER_URL` | `https://explorer-studio-dev.genlayer.com` | `web/lib/config.ts` | defaults to the same URL; trailing slashes are trimmed |
| `GENLAYER_RPC_URL` | not set | `web/app/api/rpc/route.ts` only | server-side override for the read proxy's upstream; falls back to the public RPC variable |

The proxy at `/api/rpc` exists because the Studio RPC enforces a per-IP read
ceiling — measured at 30 requests a minute, with the measurement and its
caveats recorded at the top of `web/app/api/rpc/route.ts`. It coalesces and
paces reads and answers same-origin JSON. Fee estimation and signing never pass
through it: the SDK sends those to the chain URL in `web/lib/chain.ts`, and the
proxy's allowlist refuses them.

---

## Re-verifying

| Claim | Command | What it asserts |
|---|---|---|
| the deployed bytes are this source | `node web/scripts/deploy.mjs verify 0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42` | `gen_getContractCode` equals `contracts/triggera.py` exactly; prints both digests and the first differing line |
| every surface names one address | `cd web && npm run verify` | this ledger's **current** row, `web/.env.example`, `.github/workflows/tests.yml` and `README.md` agree, and no superseded address is a default in the env example or CI |
| custody reconciles on chain | `cd web && node scripts/reconcile.mjs` | `escrow_atto` equals what live policies hold plus every unpulled ledger balance, and the contract's GEN balance is at least that; exits non-zero otherwise (needs `web/.data/keys.json`) |
| the live policy reads as recorded | `cd web && node scripts/state.mjs` | prints `get_policy`, the evidence basis and `get_stats` for `trg-000001` |

The test gates — the direct suite, the mutation sweep, the web suite and CI —
are listed with their results in `docs/ARCHITECTURE.md`, section 12, and are
not repeated here. One reproducibility note that belongs with the commands:
`tests/mutation_sweep.py` pins `SRC` to an absolute path, and
`.github/workflows/tests.yml` rewrites it to the checkout root before running
the sweep; running it from a clone elsewhere needs the same substitution.

---

## Live acts against this deployment

Each arc script asserts through a `check(cond, what)` helper and exits on the
count of failures, so a transcript claims exactly what a check asserted. What
follows is what the checks in those transcripts actually say — including the
ones that failed.

| Act | Script | Transcript | Policy | Checks that passed |
|---|---|---|---|---|
| 1–2 | `arc-custody.mjs` | `web/arc.act12.transcript.json` | `trg-000002` | `create_policy` landed SUCCESS; status `DRAFT`; coverage recorded as 0.02 GEN; **custody rose by exactly the coverage**; `cancel_policy` landed SUCCESS; status `CANCELLED`; the coverage is **owed on the ledger, not sent**; after `claim` the ledger is clear |
| 3 | `arc-refusals.mjs` | `web/arc.act3.transcript.json` | `trg-000001` | 15 refusals, each matched against the contract's **own sentence** rather than a status code — wrong caller, window outside the coverage period, an inverted window, a window not yet over, a claim with no INDEPENDENT source, an origin outside the agreed basis, the same page twice, an unknown policy, and every verb refused in the wrong state. Zero failures; no writes |
| 5–6 | `arc-panel.mjs` | `web/arc.act56.transcript.json` | `trg-000001` | `file_claim` landed SUCCESS; status `INVESTIGATING`; evidence version 1; four sources recorded, three INDEPENDENT and one PARTY; `investigate` landed SUCCESS **run by a third party**; outcome `UNDETERMINED`, `hold_reason` `EVIDENCE_INSUFFICIENT`, `evidence_flag` `INSUFFICIENT`, 0 publishers and 0 qualifying; **custody did not move** (0.1 GEN before and after); nothing has ever been paid; status `PENDING_FINALITY` |
| 7 | `arc-promote.mjs` | `web/arc.act7.transcript.json` | `trg-000001` | `promote` landed SUCCESS and is **permissionless**; the hold returned the policy to `ACTIVE`; outcome `UNDETERMINED` and hold reason `EVIDENCE_INSUFFICIENT` on the record; version 1 is the judged version; nothing has ever been paid; the coverage is still in custody (0.1 GEN) |

Acts 5–6 are the design working. Every evidence URL pointed at a commit that
was never published, so nothing was readable, and the contract returned
`UNDETERMINED` with custody unmoved. `UNDETERMINED` is a first-class outcome,
not a failure: when the panel cannot read, it does not pay, and it says which
of the two happened. The decision record is `trg-000001-d1`, evidence root
`97c6b8de3bbd93c9d55829200be97f19b797f20dc11653fcbddf644c59eaf9aa`, observed at
epoch 1788834499, with all four rows `readable=false` and `reading=null`.

### Transactions

| Act | Write | Transaction |
|---|---|---|
| 1 | `create_policy` | [`0x262e85d1…476ef5`](https://explorer-studio-dev.genlayer.com/tx/0x262e85d18bbea2ae1eb447addc6f85f9db2d8e245399c4fec3e8b96989476ef5) |
| 2 | `cancel_policy` | [`0x83e3860c…44f03e`](https://explorer-studio-dev.genlayer.com/tx/0x83e3860c20b7eea7c884301a21f75f432838e8d745b579c44dc7e5eb4044f03e) |
| 2b | `claim` | [`0x4b0ed88a…abb7b3`](https://explorer-studio-dev.genlayer.com/tx/0x4b0ed88a78231cdc950a9ed9cdd3f890e189b99e04d57a21b4629b1c1eabb7b3) |
| 5 | `file_claim` | [`0xa61f5880…b46175`](https://explorer-studio-dev.genlayer.com/tx/0xa61f5880c3fa8e6c4ad9c64706f7c41a5eee6690c73b836371d332d01db46175) |
| 6 | `investigate` | [`0xcb867501…2706a1`](https://explorer-studio-dev.genlayer.com/tx/0xcb8675010f2b1aa7bb691303065f2acb1c14b13538a1c16368945531b42706a1) |
| 7 | `promote` | [`0xdb1afdea…e72571`](https://explorer-studio-dev.genlayer.com/tx/0xdb1afdea686300de0d16189becc95c40821464aead75cdcde98b5a61a0e72571) |

Every one finalized `MAJORITY_AGREE` with a `SUCCESS` leader. Act 3 sent no
transaction: a refusal costs nothing.

The deployment transaction's own hash is not recorded here — it was not
captured in a transcript, and the address is the identity this ledger keeps.

### What the transcripts also record

The transcripts carry failed checks. They are listed here rather than trimmed.

- **`arc.act12.transcript.json`, one failure**: `custody is back where it
  started (130000000000000000 vs 110000000000000000)`. The check compared
  `get_stats().escrow_atto` before the draft and after the cancel. `escrow_atto`
  is deposits minus pulls: `cancel_policy` credits the insurer's ledger balance
  and does not decrement it, and `claim` is the only writer in the contract that
  does. The assertion was written against the wrong quantity. The two checks
  either side of it — that the coverage is owed on the ledger rather than sent,
  and that the ledger is clear after the pull — both passed, and Act 2b's wallet
  delta is in the same transcript.
- **`arc.act56.transcript.json`, two failures** and
  **`arc.act7.transcript.json`, ten failures**: refusal probes in those scripts,
  where the call came back as an RPC envelope error
  (`Missing or invalid parameters` / `InvalidInputRpcError`) instead of the
  contract's revert text, so the assertion on the sentence could not match.
  The dedicated refusals run — `arc-refusals.mjs`, recorded separately in
  `web/arc.act3.transcript.json` — matches all 15 sentences with zero failures,
  and is the Act 3 record. Every Act 5, 6 and 7 check in those same transcripts
  passed.

### The transcripts are not in the repository

`.gitignore` excludes `web/arc*.transcript.json` and `web/arc*.log`. The
transcripts exist in this working tree; the scripts that produce them —
`web/scripts/arc-*.mjs` — are committed, and re-running one against a live
policy regenerates its transcript.

---

## Not yet on chain

**The payout arc has not run.** `web/scripts/arc-payout.mjs` is written and
reviewed, and it is scheduled — `file_claim` needs the event window to be over
while the claim grace is still open, a narrow window. Until it runs, against
this deployment:

- no payout has been made;
- no appeal has been filed;
- no bond has been forfeited or returned;
- no settlement has occurred.

The payout path — `settle`, `appeal`, `re_investigate`, `lapse_appeal`, and the
pull-payment `claim` every atto leaves through — is what the contract **does**.
It is pinned by the direct suite and the mutation sweep and deployed
byte-for-byte at the address above. None of that is a claim about a transaction
that has happened, and nothing in this file should be read as one.

---

## When this ledger changes

This document is the source of truth `npm run verify` checks the other surfaces
against, so it changes first and the rest follow in the same commit. A redeploy
invalidates the byte-verification above completely: a new address means a new
`gen_getContractCode` result, a new size and a new sha256 — and because
`deploy.mjs` refuses source carrying CR bytes, what it publishes is the LF
source, whose digest is not the one recorded above. Re-run the verification,
rewrite the table, move the old address into
**Superseded deployments**, and treat the live-acts section as history that
belongs to a contract nobody is pointing at any more.
