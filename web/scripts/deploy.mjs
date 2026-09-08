/**
 * Deploy `contracts/triggera.py` to GenLayer Studio Next and verify the bytes.
 *
 *   node web/scripts/deploy.mjs            deploy, wait for finality, print the address
 *   node web/scripts/deploy.mjs verify 0x… fetch the deployed source and diff it byte-for-byte
 *
 * Signs with the CREATOR key in web/.data/keys.json (gitignored). Studio Next
 * refuses a transaction without a fee distribution and a non-zero deposit, so
 * the estimate is taken explicitly and floored.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const SOURCE = fileURLToPath(new URL("../../contracts/triggera.py", import.meta.url));
const FEE_FLOOR = 10n ** 15n;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 triggera-deploy" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}
const sha = (s) => createHash("sha256").update(s, "utf-8").digest("hex");

const [cmd, arg] = process.argv.slice(2);

if (cmd === "verify") {
  // The deployed code, as the chain stores it, against the repo file.
  // Studio Next answers gen_getContractCode with the source base64-encoded.
  const r = await rpc("gen_getContractCode", [arg]);
  const raw = typeof r.result === "string" ? r.result : (r.result?.code ?? "");
  const live = raw.startsWith("# ") ? raw : Buffer.from(raw, "base64").toString("utf-8");
  const repo = readFileSync(SOURCE, "utf-8");
  /* LINE ENDINGS ARE NORMALIZED BEFORE COMPARING, and both digests printed.
   *
   * The contract was deployed from a working tree that still carried CRLF, so
   * the chain stores the CRLF form. `.gitattributes` declares `*.py text
   * eol=lf`, so every CLONE checks out LF. A raw text comparison therefore
   * passed on the deploying machine and would have FAILED for anyone else --
   * the exact opposite of what this check exists to prove. The two differ only
   * in line endings; the normalized digest is the one that must match from any
   * checkout, and it is printed so nothing is taken on trust. */
  const norm = (t) => t.replace(/\r\n/g, "\n");
  const eol = (t) => (norm(t) === t ? "LF" : "CRLF");
  console.log(`live  sha256 ${sha(live)}  (${live.length} chars, ${eol(live)})`);
  console.log(`repo  sha256 ${sha(repo)}  (${repo.length} chars, ${eol(repo)})`);
  console.log(`live  sha256 ${sha(norm(live))}  normalized to LF`);
  console.log(`repo  sha256 ${sha(norm(repo))}  normalized to LF`);
  if (norm(live) !== norm(repo)) {
    const a = norm(live).split("\n"), b = norm(repo).split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`first difference at line ${i + 1}\n  live: ${a[i]}\n  repo: ${b[i]}`); break; }
    }
    console.error("verify: the deployed source does NOT match contracts/triggera.py");
    process.exit(1);
  }
  console.log(live === repo
    ? "verify: byte-for-byte identical"
    : "verify: identical after normalizing line endings — the chain holds the "
      + "CRLF form, a clone holds LF, and nothing but the line endings differs");
} else {
  const KEYS = JSON.parse(readFileSync(new URL("../.data/keys.json", import.meta.url), "utf-8"));
  const account = createAccount(KEYS.CREATOR.pk);
  const client = createClient({ chain, account });
  const code = readFileSync(SOURCE, "utf-8");
  if (code.includes("\r")) throw new Error("contracts/triggera.py carries CR bytes — normalize to LF before deploying");
  console.log(`deploying contracts/triggera.py (sha256 ${sha(code)}) as ${account.address} on chain ${chain.id}`);
  const est = await client.estimateTransactionFees();
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  const hash = await client.deployContract({ code, args: [], fees: { distribution: est.distribution, feeValue } });
  console.log(`deploy tx ${hash}`);
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (status === "FINALIZED") {
      const arr = t.consensus_data?.leader_receipt ?? [];
      const leader = arr.find((x) => x?.mode !== "validator") ?? arr[0];
      console.log(`FINALIZED — ${t.result_name} — leader ${leader?.execution_result}`);
      if (leader?.execution_result !== "SUCCESS") {
        console.error(String(leader?.genvm_result?.stderr ?? "").slice(-1500));
        process.exit(1);
      }
      console.log(`CONTRACT ${t.data?.contract_address}`);
      process.exit(0);
    }
    if (status === "CANCELED" || status === "UNDETERMINED") { console.error(`deploy ${status}`); process.exit(1); }
    if (i % 5 === 4) console.log(`  … ${status ?? "pending"}`);
  }
  console.error("no finality after 6 minutes — check the hash on the Studio");
  process.exit(1);
}
