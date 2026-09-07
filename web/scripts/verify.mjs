/**
 * `npm run verify` — a clean checkout reproduces the judged deployment.
 *
 * Every surface that names the contract must name the SAME address: the
 * deployment ledger, the example env, the CI build env, the README. A
 * cutover story belongs in prose; contradictory defaults are a defect a
 * reviewer finds by cloning. Exits non-zero on the first disagreement and
 * prints every surface it read either way.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const ADDR = /0x[0-9a-fA-F]{40}/g;

function current(path, pattern) {
  if (!existsSync(root(path))) return { path, address: null, note: "missing" };
  const text = readFileSync(root(path), "utf-8");
  const m = text.match(pattern);
  return { path, address: m ? m[1].toLowerCase() : null };
}

const surfaces = [
  // The ledger's table marks exactly one row **current**.
  current("docs/DEPLOYMENT.md", /\|\s*v[\d.]+\s*\|\s*`(0x[0-9a-fA-F]{40})`\s*\|\s*\*\*current\*\*/),
  current("web/.env.example", /NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/),
  current(".github/workflows/tests.yml", /NEXT_PUBLIC_CONTRACT_ADDRESS:\s*"(0x[0-9a-fA-F]{40})"/),
  current("README.md", /\*\*Contract\*\*[^\n]*?`(0x[0-9a-fA-F]{40})`/),
];

let failed = false;
const want = surfaces[0].address;
for (const s of surfaces) {
  const ok = s.address && s.address === want;
  console.log(`${ok ? "ok  " : "FAIL"} ${s.path.padEnd(30)} ${s.address ?? `(no address found${s.note ? ": " + s.note : ""})`}`);
  if (!ok) failed = true;
}

// A superseded address may appear in prose ONLY inside the ledger and the
// README's history, never as a default anywhere else.
for (const path of ["web/.env.example", ".github/workflows/tests.yml"]) {
  const others = new Set((readFileSync(root(path), "utf-8").match(ADDR) ?? []).map((a) => a.toLowerCase()));
  others.delete(want);
  others.delete("0x0000000000000000000000000000000000000000");
  if (others.size) {
    console.log(`FAIL ${path}: names another address ${[...others].join(", ")}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nverify: the surfaces disagree — a clean checkout would not reproduce the judged deployment.");
  process.exit(1);
}
console.log(`\nverify: every surface names ${want}`);
