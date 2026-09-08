/* Live Acts 3, 5 and 6 against the deployed Triggera on trg-000001.
 *
 * Act 3  refusals   - four calls the contract must refuse, each asserted on
 *                     the sentence it refuses with.
 * Act 5  claim      - the policyholder files a real claim package.
 * Act 6  panel      - the investigation runs. The evidence URLs are pinned to
 *                     a commit that is not published, so NOTHING is readable.
 *                     This is the point: when the panel cannot read, the
 *                     contract must NOT pay. UNDETERMINED, custody unmoved.
 *
 * An UNDETERMINED promotion returns the policy to ACTIVE (promote(), "the
 * hold that pays nobody"), so this act is reversible: the same policy can be
 * claimed again against real evidence once it is published.
 */
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { readFileSync, writeFileSync } from 'node:fs';

const RPC = 'https://studio-next.genlayer.com/api';
const ADDR = '0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42';
const PID = 'trg-000001';
const SHA = '43c12b4bd913dc8b0ea7eb5c685d1ea85efe41da';
const FEE_FLOOR = 10n ** 15n;
const chain = { ...studioDevnet, id: 61997, name: 'Studio Next', rpcUrls: { default: { http: [RPC] } } };
const keys = JSON.parse(readFileSync('.data/keys.json', 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); };

async function rpc(method, params, tries = 10) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 triggera-arc' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const t = await r.text();
      if (!r.ok) { last = 'HTTP ' + r.status; await sleep(900 * (i + 1)); continue; }
      return JSON.parse(t);
    } catch (e) { last = String(e?.cause?.code ?? e?.message ?? e); await sleep(900 * (i + 1)); }
  }
  throw new Error(method + ': ' + last);
}
const reader = createClient({ chain });
async function rawView(fn, args = []) {
  for (let i = 0; i < 10; i++) {
    try { return await reader.readContract({ address: ADDR, functionName: fn, args }); }
    catch (e) { if (i === 9) throw e; await sleep(800 * (i + 1)); }
  }
}
async function view(fn, args = []) {
  const raw = await rawView(fn, args);
  return typeof raw === 'string' ? (raw === '' ? null : JSON.parse(raw)) : raw;
}

function leaderOf(t) {
  const arr = t?.consensus_data?.leader_receipt ?? [];
  return arr.find((x) => x?.mode !== 'validator') ?? arr[0];
}
function revertText(err) {
  // A refused write fails at sim_estimateTransactionFees; the contract's own
  // sentence rides base64 behind one tag byte on data.receipt.result, and
  // viem buries the raw error down the cause chain.
  const seen = [];
  let node = err;
  for (let d = 0; d < 8 && node && typeof node === 'object'; d++) {
    for (const k of ['message', 'shortMessage', 'details']) {
      if (typeof node[k] === 'string') seen.push(node[k]);
    }
    const res = node?.data?.receipt?.result ?? node?.receipt?.result;
    if (res) {
      try {
        const b = Array.isArray(res) ? Buffer.from(res) : Buffer.from(String(res), 'base64');
        seen.push(b.subarray(1).toString('utf-8'));
      } catch (e) { /* keep going */ }
    }
    node = node.cause ?? node.data ?? null;
  }
  return seen.join(' | ');
}

async function waitFinal(hash, label, maxTicks = 200) {
  for (let i = 0; i < maxTicks; i++) {
    await sleep(4000);
    let t;
    try { t = (await rpc('eth_getTransactionByHash', [hash])).result; } catch (e) { continue; }
    const st = t?.status ?? t?.statusName;
    if (st === 'FINALIZED') {
      const l = leaderOf(t);
      let p = l?.result?.payload ?? '';
      if (Array.isArray(p)) { try { p = Buffer.from(p).toString('utf-8'); } catch (e) { /* keep */ } }
      say('   ' + label + ': FINALIZED ' + t.result_name + ' leader=' + l?.execution_result);
      return { ok: l?.execution_result === 'SUCCESS', text: String(p ?? ''), tx: t };
    }
    if (st === 'CANCELED' || st === 'UNDETERMINED') { say('   ' + label + ': ' + st); return { ok: false, text: st, tx: t }; }
    if (i % 10 === 9) say('   ' + label + ': ... ' + (st ?? 'pending'));
  }
  throw new Error(label + ': never finalized');
}

async function write(role, fn, args, valueAtto = 0n, maxTicks = 200) {
  const account = createAccount(keys[role].pk);
  const client = createClient({ chain, account });
  const est = await client.estimateTransactionFeesForWrite({ address: ADDR, functionName: fn, args, value: valueAtto });
  const feeValue = BigInt(est.feeValue) < FEE_FLOOR ? FEE_FLOOR : BigInt(est.feeValue);
  const fees = { distribution: est.distribution, feeValue, messageAllocations: est.messageAllocations };
  const res = await client.writeContract({ address: ADDR, functionName: fn, args, value: valueAtto, fees });
  const hash = typeof res === 'string' ? res : (res?.transactionHash ?? res?.hash ?? '');
  say('   ' + fn + ' tx ' + hash);
  return Object.assign({ hash }, await waitFinal(hash, fn, maxTicks));
}

/** A call that MUST be refused. Passes only if it was refused AND the
 *  sentence matches -- a call that SUCCEEDS is a failure of this check. */
async function mustRefuse(role, fn, args, valueAtto, needle) {
  try {
    const r = await write(role, fn, args, valueAtto, 40);
    if (r.ok) { check(false, 'REFUSAL EXPECTED but ' + fn + ' SUCCEEDED (' + needle + ')'); return; }
    const hit = r.text.toLowerCase().includes(needle.toLowerCase());
    check(hit, 'refused "' + needle + '" (on-chain: ' + r.text.slice(0, 120) + ')');
  } catch (err) {
    const text = revertText(err);
    const hit = text.toLowerCase().includes(needle.toLowerCase());
    check(hit, 'refused "' + needle + '"' + (hit ? '' : ' -- got: ' + text.slice(0, 240)));
  }
}

const fails = [];
const check = (cond, what) => { say('   ' + (cond ? 'ok  ' : 'FAIL') + ' ' + what); if (!cond) fails.push(what); };

const base = 'https://raw.githubusercontent.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/';
const SOURCES = [
  { url: base + 'agency-bulletin-07.txt', label: 'Agency bulletin 07' },
  { url: 'https://cdn.jsdelivr.net/gh/Hemmy1417/Triggera@' + SHA + '/evidence/storm-07/press-report.txt', label: 'Provincial press report' },
  { url: 'https://rawcdn.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/provider-history.txt', label: 'Weather provider daily history' },
  { url: 'https://raw.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/station-log.txt', label: 'Premises station log' },
];

const pol0 = await view('get_policy', [PID]);
const stats0 = await view('get_stats');
say('POLICY ' + PID + ' status=' + pol0.status + ' v' + pol0.evidence_version);
say('   custody before ' + stats0.escrow_atto);
if (pol0.status !== 'ACTIVE') { say('policy is not ACTIVE; nothing to do'); process.exit(1); }

const now = Math.floor(Date.now() / 1000);
const cs = Number(pol0.coverage_start_epoch);
const end = Math.min(now - 180, Number(pol0.coverage_end_epoch));
const start = Math.max(cs, end - 21600);
say('   event window ' + start + ' -> ' + end + '  (' + new Date(start * 1000).toISOString() + ' -> ' + new Date(end * 1000).toISOString() + ')');

// ── Act 3: what the contract refuses ────────────────────────────────────────
say('');
say('ACT 3 - the refusals');
await mustRefuse('THIRD', 'file_claim', [PID, start, end, 157, JSON.stringify(SOURCES)], 0n,
  'only the policyholder files a claim');
await mustRefuse('YES', 'file_claim', [PID, cs - 5000, end, 157, JSON.stringify(SOURCES)], 0n,
  'must lie inside the coverage period');
await mustRefuse('YES', 'file_claim', [PID, start, now + 7200, 157, JSON.stringify(SOURCES)], 0n,
  'inside the coverage period');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157, JSON.stringify([SOURCES[3]])], 0n,
  'INDEPENDENT origin');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157,
  JSON.stringify([{ url: 'https://example.com/not-in-basis.txt', label: 'Outside' }, SOURCES[0]])], 0n,
  'outside the agreed');
await mustRefuse('NO', 'activate', [PID], 1n, 'is ACTIVE');

// ── Act 5: the claim ────────────────────────────────────────────────────────
say('');
say('ACT 5 - the policyholder files the claim');
const filed = await write('YES', 'file_claim', [PID, start, end, 157, JSON.stringify(SOURCES)]);
check(filed.ok, 'file_claim landed SUCCESS');
if (!filed.ok) { say('   revert: ' + filed.text.slice(0, 500)); writeFileSync('arc.act56.transcript.json', JSON.stringify({ log, fails }, null, 1)); process.exit(1); }
const pol1 = await view('get_policy', [PID]);
check(pol1.status === 'INVESTIGATING', 'status is INVESTIGATING (got ' + pol1.status + ')');
check(Number(pol1.evidence_version) === Number(pol0.evidence_version) + 1, 'evidence version advanced to ' + pol1.evidence_version);
const pkg = await view('get_package', [PID, Number(pol1.evidence_version)]);
check(!!pkg, 'the claim package is on the record');
check((pkg?.rows ?? []).length === 4, 'four sources recorded (got ' + (pkg?.rows ?? []).length + ')');
const kinds = (pkg?.rows ?? []).map((r) => r.cls + '/' + r.kind).join(', ');
say('   rows: ' + kinds);
check((pkg?.rows ?? []).filter((r) => r.cls === 'INDEPENDENT').length === 3, 'three INDEPENDENT rows, one PARTY');

// ── Act 6: the panel ────────────────────────────────────────────────────────
say('');
say('ACT 6 - the panel runs against evidence that does not resolve');
say('   (the fixtures are pinned to a commit that is not published: every page 404s)');
const inv = await write('THIRD', 'investigate', [PID], 0n, 300);
check(inv.ok, 'investigate landed SUCCESS (permissionless: run by a third party)');
if (!inv.ok) { say('   revert: ' + inv.text.slice(0, 600)); }

const dec = await view('get_decision', [PID, Number(pol1.evidence_version)]);
const pol2 = await view('get_policy', [PID]);
const stats2 = await view('get_stats');

say('');
say('THE DETERMINATION');
say('   outcome        ' + dec?.outcome);
say('   hold_reason    ' + dec?.hold_reason);
say('   evidence_flag  ' + dec?.evidence_flag);
say('   publishers     ' + dec?.publishers + '  qualifying ' + dec?.qualifying + '  contradicting ' + dec?.contradicting);
say('   reason         ' + String(dec?.reason ?? '').slice(0, 300));
for (const r of dec?.rows ?? []) {
  say('   row ' + r.id + ' ' + r.host + ' readable=' + r.readable + ' reading=' + JSON.stringify(r.reading) + ' window_ok=' + r.window_ok + ' geo_ok=' + r.geo_ok + ' kind_matches=' + r.kind_matches);
}

check(dec?.outcome === 'UNDETERMINED', 'the panel did NOT decide the trigger was met (got ' + dec?.outcome + ')');
check(dec?.evidence_flag !== 'SUFFICIENT', 'the record is not marked SUFFICIENT (got ' + dec?.evidence_flag + ')');
check(Number(dec?.qualifying ?? -1) === 0, 'no publisher qualified (got ' + dec?.qualifying + ')');
check(pol2.status === 'PENDING_FINALITY', 'the policy is PENDING_FINALITY (got ' + pol2.status + ')');

/* NOT asserted here, deliberately. It is tempting to check that custody and
   paid_atto did not move across investigate() and call that proof the
   unreadable round paid nobody -- but investigate() writes only decisions,
   investigation_count, pending_version, pending_until_epoch and status. It
   touches escrow_atto, claimable, paid_atto, satisfied_count and payout_atto
   nowhere in contracts/triggera.py, so such a check cannot fail for ANY
   outcome, including SATISFIED. It would be a green light that means nothing.

   What actually forbids a payout here is three things, each proved by a
   different act:
     - promote() maps UNDETERMINED to ACTIVE, never to FINAL   (arc-promote)
     - settle() refuses anything that is not FINAL             (arc-refusals)
     - settle() refuses unless evidence_flag is SUFFICIENT     (contract, S22)
   So the money assertions live there, where they can fail. */
say('   (custody/paid are asserted after promotion and at settle, not here:');
say('    investigate() cannot move money for any outcome, so checking it here');
say('    would be an assertion that cannot fail -- see the note in this file)');
say('   for the record, custody now ' + stats2.escrow_atto + ' and paid ' + stats2.paid_atto);
say('   finality opens at ' + pol2.pending_until_epoch + ' (' + (Number(pol2.pending_until_epoch) - Math.floor(Date.now() / 1000)) + 's away)');

say('');
say(fails.length === 0 ? 'ALL CHECKS PASSED' : 'FAILED: ' + fails.length + ' - ' + fails.join('; '));
writeFileSync('arc.act56.transcript.json', JSON.stringify({ log, fails, decision: dec }, null, 1));
process.exit(fails.length === 0 ? 0 : 1);
