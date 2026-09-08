/* Custody reconciliation: what the contract holds must equal what it owes.
   escrow_atto is "deposits minus claims", so the invariant is
     escrow_atto == sum(coverage+premium+bond still held by live policies)
                    + sum(every unpulled ledger balance)
   and the contract's real GEN balance must be at least that. */
import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { readFileSync } from 'node:fs';

const RPC = 'https://studio-next.genlayer.com/api';
const ADDR = '0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42';
const chain = { ...studioDevnet, id: 61997, name: 'Studio Next', rpcUrls: { default: { http: [RPC] } } };
const keys = JSON.parse(readFileSync('.data/keys.json', 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reader = createClient({ chain });

async function rpc(method, params, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 triggera-arc' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const t = await r.text();
      if (!r.ok) { last = 'HTTP ' + r.status; await sleep(800 * (i + 1)); continue; }
      return JSON.parse(t);
    } catch (e) { last = String(e?.cause?.code ?? e?.message ?? e); await sleep(800 * (i + 1)); }
  }
  throw new Error(method + ': ' + last);
}
async function rawView(fn, args = []) {
  for (let i = 0; i < 8; i++) {
    try { return await reader.readContract({ address: ADDR, functionName: fn, args }); }
    catch (e) { if (i === 7) throw e; await sleep(700 * (i + 1)); }
  }
}
async function view(fn, args = []) {
  const raw = await rawView(fn, args);
  return typeof raw === 'string' ? (raw === '' ? null : JSON.parse(raw)) : raw;
}

const gen = (a) => (Number(a) / 1e18).toFixed(6);
const stats = await view('get_stats');
const book = await view('get_policies', [0, 100]);

/* What each policy still has behind it, by status. The COVERAGE is what a
   live policy holds; the PREMIUM is not, because activate() credits it to
   the insurer's ledger the moment it is paid (contracts/triggera.py, in
   activate: _credit(p.insurer, premium)) -- so it is already counted in the
   ledger total below, and counting it here would double it. An open
   appeal's bond is held until the appeal concludes. */
const HOLDS = new Set(['DRAFT', 'ACTIVE', 'INVESTIGATING', 'PENDING_FINALITY', 'FINAL']);
let held = 0n;
const rows = [];
for (const p of book.policies) {
  let amt = 0n;
  if (HOLDS.has(p.status)) {
    amt += BigInt(p.coverage_atto);
    if (p.appeal_open) amt += BigInt(p.appeal_bond_atto || '0');
  }
  held += amt;
  rows.push(`  ${p.policy_id}  ${String(p.status).padEnd(16)} holds ${gen(amt)} GEN`);
}

let owed = 0n;
const ledger = [];
for (const [role, v] of Object.entries(keys)) {
  const c = BigInt((await rawView('get_claimable', [v.addr])) || '0');
  owed += c;
  if (c > 0n) ledger.push(`  ${role} is owed ${gen(c)} GEN`);
}

const bal = BigInt((await rpc('eth_getBalance', [ADDR, 'latest'])).result ?? '0x0');
const escrow = BigInt(stats.escrow_atto);

console.log('POLICIES');
rows.forEach((r) => console.log(r));
console.log('LEDGER');
console.log(ledger.length ? ledger.join('\n') : '  nobody is owed anything');
console.log('');
console.log('behind live policies  ' + gen(held) + ' GEN');
console.log('owed on the ledger    ' + gen(owed) + ' GEN');
console.log('accounted for         ' + gen(held + owed) + ' GEN');
console.log('escrow_atto says      ' + gen(escrow) + ' GEN');
console.log('contract GEN balance  ' + gen(bal) + ' GEN');
console.log('');
const reconciles = held + owed === escrow;
const solvent = bal >= escrow;
console.log(reconciles ? 'ok   custody reconciles exactly' : 'FAIL custody does NOT reconcile (delta ' + (escrow - held - owed) + ' atto)');
console.log(solvent ? 'ok   the contract holds at least what it owes' : 'FAIL the contract is short by ' + (escrow - bal) + ' atto');
process.exit(reconciles && solvent ? 0 : 1);
