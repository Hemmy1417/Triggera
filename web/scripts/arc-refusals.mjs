/* Act 3: every refusal, asserted on the contract's OWN sentence.
 *
 * A refused write never becomes a transaction -- Studio Next runs the call
 * during sim_estimateTransactionFees and fails there. The contract's sentence
 * rides base64 behind one tag byte at err.cause.data.receipt.result (shape
 * confirmed by dumping a real error). Error.cause is NON-ENUMERABLE, so a
 * decoder built on Object.entries walks straight past it; this one uses
 * getOwnPropertyNames and follows cause explicitly. */
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const RPC = 'https://studio-next.genlayer.com/api';
const ADDR = '0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42';
const PID = 'trg-000001';
const SHA = '43c12b4bd913dc8b0ea7eb5c685d1ea85efe41da';
const chain = { ...studioDevnet, id: 61997, rpcUrls: { default: { http: [RPC] } } };
const keys = JSON.parse(readFileSync('.data/keys.json', 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'arc.act3.log';
writeFileSync(OUT, '');
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); appendFileSync(OUT, s + '\n'); };
const fails = [];
const check = (cond, what) => { say('   ' + (cond ? 'ok  ' : 'FAIL') + ' ' + what); if (!cond) fails.push(what); };

const TRANSIENT = /fetch failed|socket|other side closed|50[234]|econnreset|timeout|unknown rpc|rate limit|-32029/i;
const isTransient = (e) => TRANSIENT.test(String(e?.message ?? '') + ' ' + String(e?.details ?? '') + ' ' + String(e?.cause?.message ?? ''));
async function resilient(label, thunk, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await thunk(); }
    catch (e) { last = e; if (!isTransient(e)) throw e; await sleep(1200 * (i + 1)); }
  }
  throw last;
}

/** Every string in the error graph, plus any base64 receipt payload decoded.
 *  getOwnPropertyNames because Error.cause is non-enumerable. */
function revertText(err) {
  const out = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || depth > 8 || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const k of Object.getOwnPropertyNames(node)) {
      let v;
      try { v = node[k]; } catch { continue; }
      if (typeof v === 'string') {
        out.push(v);
        if (/^[A-Za-z0-9+/=]{12,}$/.test(v)) {
          try {
            const s = Buffer.from(v, 'base64').toString('utf-8');
            if (/\[EXPECTED\]|\[TRANSIENT\]|\[LLM\]/.test(s)) out.push(s.replace(/^[\x00-\x1f]+/, ''));
          } catch { /* not base64 */ }
        }
      } else if (v && typeof v === 'object') walk(v, depth + 1);
    }
    if (node.cause) walk(node.cause, depth + 1);
  };
  walk(err, 0);
  return out.join(' | ');
}

const reader = createClient({ chain });
const rawView = (fn, args = []) => resilient('read', () => reader.readContract({ address: ADDR, functionName: fn, args }), 10);
async function view(fn, args = []) {
  const raw = await rawView(fn, args);
  return typeof raw === 'string' ? (raw === '' ? null : JSON.parse(raw)) : raw;
}

async function mustRefuse(role, fn, args, value, needle) {
  const client = createClient({ chain, account: createAccount(keys[role].pk) });
  try {
    await resilient('estimate', () =>
      client.estimateTransactionFeesForWrite({ address: ADDR, functionName: fn, args, value }));
    check(false, 'REFUSAL EXPECTED but ' + fn + ' passed simulation (wanted: ' + needle + ')');
  } catch (err) {
    const text = revertText(err);
    const m = text.match(/\[EXPECTED\][^|]*/);
    const sentence = m ? m[0].trim() : '(no contract sentence decoded)';
    const hit = sentence.toLowerCase().includes(needle.toLowerCase());
    check(hit, fn + ' -> "' + sentence + '"');
    if (!hit) say('        wanted "' + needle + '"; raw: ' + text.slice(0, 300));
  }
}

const pol = await view('get_policy', [PID]);
say('POLICY ' + PID + ' status=' + pol.status + ' v' + pol.evidence_version + ' outcome=' + (pol.outcome || '-'));
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
say('ACT 3 - what the contract refuses, and the sentence it refuses with');
await mustRefuse('NO', 'activate', [PID], 1n, 'nothing to activate in');
await mustRefuse('THIRD', 'file_claim', [PID, start, end, 157, JSON.stringify(S)], 0n, 'only the policyholder files a claim');
await mustRefuse('YES', 'file_claim', [PID, cs - 9000, end, 157, JSON.stringify(S)], 0n, 'inside the coverage period');
await mustRefuse('YES', 'file_claim', [PID, end, start, 157, JSON.stringify(S)], 0n, 'must end after it starts');
await mustRefuse('YES', 'file_claim', [PID, start, now0 + 7200, 157, JSON.stringify(S)], 0n, 'not over yet');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157, JSON.stringify([S[3]])], 0n, 'INDEPENDENT origin');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157,
  JSON.stringify([{ url: 'https://example.com/x.txt', label: 'Outside the basis' }, S[0]])], 0n, 'outside the agreed');
await mustRefuse('YES', 'file_claim', [PID, start, end, 157, JSON.stringify([S[0], S[0]])], 0n, 'already in the record');
await mustRefuse('YES', 'file_claim', ['trg-000099', start, end, 157, JSON.stringify(S)], 0n, 'unknown policy');
await mustRefuse('CREATOR', 'claim', [], 0n, 'nothing claimable');
await mustRefuse('THIRD', 'promote', ['trg-000002'], 0n, 'nothing is pending finality');
await mustRefuse('THIRD', 'settle', [PID], 0n, 'nothing to settle in');
await mustRefuse('THIRD', 'investigate', [PID], 0n, 'an investigation runs on a filed claim');
await mustRefuse('CREATOR', 'appeal', [PID, 'The panel misread the agency bulletin for the insured area.', '', ''], 50000000000000000n, 'nothing appealable in');
await mustRefuse('CREATOR', 'cancel_policy', [PID], 0n, 'draft');

say('');
say(fails.length === 0 ? 'ALL CHECKS PASSED (' + (15 - fails.length) + ' refusals)' : 'FAILED: ' + fails.length + ' - ' + fails.join('; '));
writeFileSync('arc.act3.transcript.json', JSON.stringify({ log, fails }, null, 1));
process.exit(fails.length === 0 ? 0 : 1);
