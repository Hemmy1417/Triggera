/* Act 3 (refusals) + Act 7 (promotion of an UNDETERMINED hold).
 *
 * Studio Next drops sockets often enough that the SDK's own calls need the
 * same retry the raw RPC helper has. estimateTransactionFeesForWrite is
 * always safe to retry -- it creates no transaction. writeContract is only
 * retried when it failed WITHOUT yielding a hash, and every act re-reads
 * state afterwards, so a write that secretly landed is caught by the
 * assertion rather than by a second send. */
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const RPC = 'https://studio-next.genlayer.com/api';
const ADDR = '0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42';
const PID = 'trg-000001';
const SHA = '43c12b4bd913dc8b0ea7eb5c685d1ea85efe41da';
const FEE_FLOOR = 10n ** 15n;
const OUT = 'arc.act7.log';
const chain = { ...studioDevnet, id: 61997, name: 'Studio Next', rpcUrls: { default: { http: [RPC] } } };
const keys = JSON.parse(readFileSync('.data/keys.json', 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(OUT, '');
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); appendFileSync(OUT, s + '\n'); };
const fails = [];
const check = (cond, what) => { say('   ' + (cond ? 'ok  ' : 'FAIL') + ' ' + what); if (!cond) fails.push(what); };

const TRANSIENT = /fetch failed|socket|other side closed|502|503|504|econnreset|timeout|unknown rpc|rate limit|-32029/i;
const isTransient = (e) => TRANSIENT.test(String(e?.message ?? '') + ' ' + String(e?.cause?.message ?? '') + ' ' + String(e?.details ?? ''));

/** Retry ANY thunk while the failure is transport, not the contract. */
async function resilient(label, thunk, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await thunk(); }
    catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      say('   (' + label + ' transport wobble, retry ' + (i + 1) + ')');
      await sleep(1200 * (i + 1));
    }
  }
  throw last;
}

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
const rawView = (fn, args = []) => resilient('read ' + fn, () => reader.readContract({ address: ADDR, functionName: fn, args }), 10);
async function view(fn, args = []) {
  const raw = await rawView(fn, args);
  return typeof raw === 'string' ? (raw === '' ? null : JSON.parse(raw)) : raw;
}

function revertText(err) {
  const out = []; const seen = new Set();
  const walk = (n, d) => {
    if (!n || d > 10 || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'string') {
        if (k === 'result' || k === 'payload' || k === 'data') {
          try {
            const s = Buffer.from(v, 'base64').toString('utf-8');
            if (/[ -~]{8,}/.test(s)) out.push(s.replace(/^[\x00-\x1f]+/, ''));
          } catch { /* not base64 */ }
        }
        out.push(v);
      } else if (Array.isArray(v)) {
        if (v.length && v.every((x) => typeof x === 'number')) {
          try { out.push(Buffer.from(v).toString('utf-8')); } catch { /* keep */ }
        } else v.forEach((c) => walk(c, d + 1));
      } else if (v && typeof v === 'object') walk(v, d + 1);
    }
  };
  walk(err, 0);
  return out.join(' | ');
}

async function estimate(client, fn, args, value) {
  return resilient('estimate ' + fn, () =>
    client.estimateTransactionFeesForWrite({ address: ADDR, functionName: fn, args, value }));
}

async function send(role, fn, args, value = 0n) {
  const client = createClient({ chain, account: createAccount(keys[role].pk) });
  const est = await estimate(client, fn, args, value);
  const feeValue = BigInt(est.feeValue) < FEE_FLOOR ? FEE_FLOOR : BigInt(est.feeValue);
  const fees = { distribution: est.distribution, feeValue, messageAllocations: est.messageAllocations };
  const res = await resilient('send ' + fn, () =>
    client.writeContract({ address: ADDR, functionName: fn, args, value, fees }), 3);
  const hash = typeof res === 'string' ? res : (res?.transactionHash ?? res?.hash ?? '');
  say('   ' + fn + ' tx ' + hash);
  for (let i = 0; i < 200; i++) {
    await sleep(4000);
    let t;
    try { t = (await rpc('eth_getTransactionByHash', [hash])).result; } catch { continue; }
    const st = t?.status ?? t?.statusName;
    if (st === 'FINALIZED') {
      const arr = t.consensus_data?.leader_receipt ?? [];
      const l = arr.find((x) => x?.mode !== 'validator') ?? arr[0];
      say('   ' + fn + ': FINALIZED ' + t.result_name + ' leader=' + l?.execution_result);
      return { ok: l?.execution_result === 'SUCCESS', hash };
    }
    if (st === 'CANCELED' || st === 'UNDETERMINED') { say('   ' + fn + ': ' + st); return { ok: false, hash }; }
    if (i % 10 === 9) say('   ' + fn + ': ... ' + (st ?? 'pending'));
  }
  throw new Error(fn + ' never finalized');
}

async function mustRefuse(role, fn, args, value, needle) {
  const client = createClient({ chain, account: createAccount(keys[role].pk) });
  try {
    await estimate(client, fn, args, value);
    check(false, 'REFUSAL EXPECTED but ' + fn + ' passed simulation (' + needle + ')');
  } catch (err) {
    const text = revertText(err);
    const hit = text.toLowerCase().includes(needle.toLowerCase());
    check(hit, fn + ' refused: "' + needle + '"');
    if (!hit) say('        full error: ' + text.slice(0, 600));
  }
}

const pol = await view('get_policy', [PID]);
say('POLICY ' + PID + ' status=' + pol.status + ' v' + pol.evidence_version);

const base = 'https://raw.githubusercontent.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/';
const S = [
  { url: base + 'agency-bulletin-07.txt', label: 'Agency bulletin 07' },
  { url: 'https://cdn.jsdelivr.net/gh/Hemmy1417/Triggera@' + SHA + '/evidence/storm-07/press-report.txt', label: 'Provincial press report' },
  { url: 'https://rawcdn.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/provider-history.txt', label: 'Weather provider daily history' },
  { url: 'https://raw.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/station-log.txt', label: 'Premises station log' },
];
const now0 = Math.floor(Date.now() / 1000);
const cs = Number(pol.coverage_start_epoch);
const end = Math.min(now0 - 180, Number(pol.coverage_end_epoch));
const start = Math.max(cs, end - 21600);

say('');
say('ACT 3 - the refusals, on the contract\'s own sentences');
await mustRefuse('NO', 'activate', [PID], 1n, 'nothing to activate in');
await mustRefuse('THIRD', 'file_claim', [PID, start, end, 157, JSON.stringify(S)], 0n, 'only the policyholder files a claim');
await mustRefuse('YES', 'file_claim', [PID, cs - 9000, end, 157, JSON.stringify(S)], 0n, 'inside the coverage period');
await mustRefuse('YES', 'file_claim', [PID, end, start, 157, JSON.stringify(S)], 0n, 'must end after it starts');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157, JSON.stringify([S[3]])], 0n, 'INDEPENDENT origin');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157,
  JSON.stringify([{ url: 'https://example.com/x.txt', label: 'Outside' }, S[0]])], 0n, 'outside the agreed');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157, JSON.stringify([S[0], S[0]])], 0n, 'already in the record');
await mustRefuse('CREATOR', 'claim', [], 0n, 'nothing claimable');
await mustRefuse('THIRD', 'promote', ['trg-000002'], 0n, 'nothing is pending finality');
await mustRefuse('THIRD', 'settle', [PID], 0n, 'settle');

say('');
say('ACT 7 - promotion: the UNDETERMINED hold returns the policy to ACTIVE');
const p1 = await view('get_policy', [PID]);
if (p1.status !== 'PENDING_FINALITY') {
  say('   policy is ' + p1.status + ' — nothing pending, skipping');
} else {
  const until = Number(p1.pending_until_epoch);
  while (Math.floor(Date.now() / 1000) <= until) {
    const left = until - Math.floor(Date.now() / 1000) + 5;
    say('   finality window still open, ' + left + 's to go');
    await sleep(Math.min(left, 45) * 1000);
  }
  const pr = await send('THIRD', 'promote', [PID]);
  check(pr.ok, 'promote landed SUCCESS (permissionless)');
  const p2 = await view('get_policy', [PID]);
  const s2 = await view('get_stats');
  check(p2.status === 'ACTIVE', 'the hold returned the policy to ACTIVE (got ' + p2.status + ')');
  check(p2.outcome === 'UNDETERMINED', 'outcome recorded UNDETERMINED (got ' + p2.outcome + ')');
  check(p2.hold_reason === 'EVIDENCE_INSUFFICIENT', 'hold reason on the record (got ' + p2.hold_reason + ')');
  check(Number(p2.judged_version) === 1, 'version 1 is the judged version (got ' + p2.judged_version + ')');
  check(BigInt(s2.paid_atto) === 0n, 'nothing has ever been paid (' + s2.paid_atto + ')');
  check(BigInt(s2.escrow_atto) === 100000000000000000n, 'the coverage is still in custody (' + s2.escrow_atto + ')');
  say('   investigations ' + s2.investigations + ', triggers met ' + s2.satisfied);
  say('');
  say('   the policy can be claimed again: a refiled claim becomes version 2');
}

say('');
say(fails.length === 0 ? 'ALL CHECKS PASSED' : 'FAILED: ' + fails.length + ' - ' + fails.join('; '));
writeFileSync('arc.act7.transcript.json', JSON.stringify({ log, fails }, null, 1));
process.exit(fails.length === 0 ? 0 : 1);
