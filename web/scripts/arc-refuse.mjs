/* The other half: what happens when the publishers agree the trigger was NOT met.
 *
 * The payout arc proved the contract pays when a majority read past the
 * trigger. Nothing on chain yet proved it REFUSES when a majority read short
 * of it, or that the coverage then goes back to the insurer instead of being
 * stranded. This runs that, on trg-000003, against evidence/storm-14h.
 *
 * Act A  the policyholder claims on all three independent publishers.
 *        agency 138 and press 142 are SHORT of the 150 km/h trigger; the
 *        provider at 151 is past it. One of three -> NOT_SATISFIED.
 * Act B  the panel runs; after the finality window the record is promoted to
 *        FINAL. NOT_SATISFIED is appealable, exactly like SATISFIED.
 * Act C  settle. This is the act that matters: it moves NOTHING. The coverage
 *        stays locked, the policyholder is credited nothing, and the policy
 *        goes back to ACTIVE for the rest of its period.
 * Act D  once the claim grace has passed, expire() returns the whole coverage
 *        to the INSURER, and the insurer pulls it with claim(). Custody for
 *        this policy reconciles to zero having paid the policyholder nothing.
 *
 * THE ASSERTIONS NAME THE ROWS. A count of "1 qualifying" would hold just as
 * well if the agency had gone unreadable and the provider had been the only
 * voice. Each publisher is pinned by host and reading, so the transcript
 * proves the derivation and not merely its arithmetic.
 *
 * RESUMABLE. Every act is guarded by the status it expects, read from the
 * contract. Re-running after a partial failure resumes where the chain is. */
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const RPC = 'https://studio-next.genlayer.com/api';
const ADDR = '0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42';
const PID = process.env.PID || 'trg-000003';
const SHA = '375f3d3499acd05ffba49f4bc2bac0924327a3b9';
const FEE_FLOOR = 10n ** 15n;
const OUT = 'arc.refuse.log';
const CLOCK_MARGIN = 330;
const chain = { ...studioDevnet, id: 61997, name: 'Studio Next', rpcUrls: { default: { http: [RPC] } } };
const keys = JSON.parse(readFileSync('.data/keys.json', 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(OUT, '');
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); appendFileSync(OUT, s + '\n'); };
const fails = [];
const unproven = [];
const check = (cond, what) => { say('   ' + (cond ? 'ok  ' : 'FAIL') + ' ' + what); if (!cond) fails.push(what); };
const nowSec = () => Math.floor(Date.now() / 1000);
const hardStop = (why) => { say(''); say('STOPPED: ' + why); writeFileSync('arc.refuse.transcript.json', JSON.stringify({ log, fails, unproven }, null, 1)); process.exit(1); };

const TRANSIENT = /fetch failed|socket|other side closed|502|503|504|econnreset|timeout|unknown rpc|rate limit|-32029/i;
const isTransient = (e) => TRANSIENT.test(String(e?.message ?? '') + ' ' + String(e?.cause?.message ?? '') + ' ' + String(e?.details ?? ''));

async function resilient(label, thunk, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await thunk(); }
    catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      say('   (' + label + ' wobble, retry ' + (i + 1) + ')');
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
async function view(fn, args = []) {
  const raw = await resilient('read ' + fn, () =>
    reader.readContract({ address: ADDR, functionName: fn, args }), 10);
  return typeof raw === 'string' ? (raw === '' ? null : JSON.parse(raw)) : raw;
}

/** Keep only the printable run of a leader payload: it carries a control byte
 *  and a printable type marker before the returned string. */
function printable(s) {
  return [...String(s || '')].filter((ch) => ch >= ' ' && ch <= '~').join('').trim();
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
            if (/[ -~]{8,}/.test(s)) out.push(printable(s));
          } catch { /* not base64 */ }
        }
        out.push(v);
      } else if (Array.isArray(v)) {
        if (v.length && v.every((x) => typeof x === 'number')) {
          try { out.push(printable(Buffer.from(v).toString('utf-8'))); } catch { /* keep */ }
        } else v.forEach((c) => walk(c, d + 1));
      } else if (v && typeof v === 'object') walk(v, d + 1);
    }
  };
  walk(err, 0);
  return out.join(' | ');
}

async function send(role, fn, args, value = 0n, maxTicks = 220) {
  const client = createClient({ chain, account: createAccount(keys[role].pk) });
  const est = await resilient('estimate ' + fn, () =>
    client.estimateTransactionFeesForWrite({ address: ADDR, functionName: fn, args, value }));
  const feeValue = BigInt(est.feeValue) < FEE_FLOOR ? FEE_FLOOR : BigInt(est.feeValue);
  const fees = { distribution: est.distribution, feeValue, messageAllocations: est.messageAllocations };
  /* A value-bearing write is never retried: a lost response cannot be told
     from a refusal, and a second attempt would send real value again. */
  const res = await resilient('send ' + fn, () =>
    client.writeContract({ address: ADDR, functionName: fn, args, value, fees }), value > 0n ? 1 : 3);
  const hash = typeof res === 'string' ? res : (res?.transactionHash ?? res?.hash ?? '');
  say('   ' + fn + ' tx ' + hash);
  for (let i = 0; i < maxTicks; i++) {
    await sleep(4000);
    let t;
    try { t = (await rpc('eth_getTransactionByHash', [hash])).result; } catch { continue; }
    const st = t?.status ?? t?.statusName;
    if (st === 'FINALIZED') {
      const arr = t.consensus_data?.leader_receipt ?? [];
      const l = arr.find((x) => x?.mode !== 'validator') ?? arr[0];
      let text = '';
      try { text = printable(Buffer.from(l?.result?.payload ?? '', 'base64').toString('utf-8')); } catch { /* none */ }
      say('   ' + fn + ': FINALIZED ' + t.result_name + ' leader=' + l?.execution_result
        + (text ? ' -> ' + text.slice(0, 90) : ''));
      return { ok: l?.execution_result === 'SUCCESS', text, hash };
    }
    if (st === 'CANCELED' || st === 'UNDETERMINED') { say('   ' + fn + ': ' + st); return { ok: false, text: '', hash }; }
    if (i % 10 === 9) say('   ' + fn + ': ... ' + (st ?? 'pending'));
  }
  throw new Error(fn + ' never finalized');
}

async function mustRefuse(role, fn, args, value, needle) {
  const client = createClient({ chain, account: createAccount(keys[role].pk) });
  try {
    await resilient('estimate ' + fn, () =>
      client.estimateTransactionFeesForWrite({ address: ADDR, functionName: fn, args, value }));
    check(false, 'REFUSAL EXPECTED but ' + fn + ' passed simulation (' + needle + ')');
  } catch (err) {
    /* Three outcomes, not two. Accepted is a real failure. Refused with the
       reason read is a full proof. Refused with the node returning only a bare
       RPC error proves the refusal but not its reason -- recording that as a
       failure would assert the contract did NOT refuse, which is false. */
    const text = revertText(err);
    if (text.toLowerCase().includes(needle.toLowerCase())) {
      check(true, fn + ' refused: "' + needle + '"');
    } else {
      unproven.push(fn + ' (' + needle + ')');
      say('   ok* ' + fn + ' was REFUSED, but the node did not return its reason, so "'
        + needle + '" is not proven by this run');
    }
  }
}

const base = 'https://raw.githubusercontent.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-14h/';
const ROWS = [
  { url: base + 'agency-bulletin-14.txt', label: 'Agency bulletin 14' },
  { url: 'https://cdn.jsdelivr.net/gh/Hemmy1417/Triggera@' + SHA + '/evidence/storm-14h/press-report.txt', label: 'Provincial press report' },
  { url: 'https://rawcdn.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-14h/provider-history.txt', label: 'Weather provider hourly history' },
  { url: 'https://raw.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-14h/station-log.txt', label: 'Premises station log' },
];
const EXPECTED = [
  { host: 'raw.githubusercontent.com', reading: 138, what: 'the agency' },
  { host: 'cdn.jsdelivr.net', reading: 142, what: 'the press' },
  { host: 'rawcdn.githack.com', reading: 151, what: 'the provider' },
];

async function money(when) {
  const s = await view('get_stats');
  const holder = BigInt(await view('get_claimable', [keys.YES.addr]) ?? 0);
  const insurer = BigInt(await view('get_claimable', [keys.CREATOR.addr]) ?? 0);
  const m = { escrow: BigInt(s.escrow_atto), paid: BigInt(s.paid_atto), holder, insurer };
  say('   MONEY ' + when + ': escrow ' + m.escrow + '  paid ' + m.paid
    + '  claimable[holder] ' + m.holder + '  claimable[insurer] ' + m.insurer);
  return m;
}

const summarise = (p, when) => say('   STATE ' + when + ': status=' + p.status + ' v' + p.evidence_version
  + ' judged=' + p.judged_version + ' outcome=' + (p.outcome || '-') + '/' + (p.evidence_flag || '-')
  + ' pubs=' + p.publishers + ' qual=' + p.qualifying + ' contra=' + p.contradicting);

// ── entry ───────────────────────────────────────────────────────────────────
let pol = await view('get_policy', [PID]);
if (!pol) hardStop('no policy ' + PID);
say('TRIGGERA refusal arc - policy ' + PID + ' at ' + ADDR);
summarise(pol, 'on entry');
const m0 = await money('on entry');
const COVERAGE = BigInt(pol.coverage_atto);
check(Number(pol.measurement_hours) === 1, 'the policy measures over one hour (got ' + pol.measurement_hours + ')');
check(Number(pol.threshold) === 150, 'the trigger is 150 ' + pol.unit);
check(Number(pol.min_independent) === 2, 'it needs two independent publishers');

const cStart = Number(pol.coverage_start_epoch);
const cEnd = Number(pol.coverage_end_epoch);
const grace = Number(pol.claim_grace);
const deadline = cEnd + grace;

// ── Act A: the claim ────────────────────────────────────────────────────────
say('');
say('ACT A - the policyholder claims on all three independent publishers');
if (Number(pol.evidence_version) > 0) {
  say('   skipped: a claim is already on the record (v' + pol.evidence_version + ')');
} else {
  if (nowSec() > deadline - CLOCK_MARGIN) {
    hardStop('the claim grace closed at ' + deadline + '. The coverage can now only be reclaimed by expire().');
  }
  while (nowSec() <= cEnd + CLOCK_MARGIN) {
    const left = cEnd + CLOCK_MARGIN - nowSec();
    say('   the event window is still running, ' + left + 's to go (then ' + grace + 's of grace)');
    await sleep(Math.min(left + 2, 60) * 1000);
  }
  say('   event window ' + cStart + ' -> ' + cEnd + ', one measurement window wide');
  const filed = await send('YES', 'file_claim', [PID, cStart, cEnd, 151, JSON.stringify(ROWS)]);
  check(filed.ok, 'file_claim landed SUCCESS');
  if (!filed.ok) hardStop('file_claim reverted: ' + filed.text.slice(0, 400));
  pol = await view('get_policy', [PID]);
  summarise(pol, 'after the claim');
}
const V = Number(pol.evidence_version);

// ── Act B: the panel, then promotion ────────────────────────────────────────
say('');
say('ACT B - the panel reads three live pages, then the record is promoted');
if (pol.status === 'INVESTIGATING') {
  say('   a full LLM round with three live fetches, allow ~20 minutes');
  const inv = await send('THIRD', 'investigate', [PID], 0n, 320);
  check(inv.ok, 'investigate landed SUCCESS (permissionless)');
  if (!inv.ok) hardStop('investigate reverted: ' + inv.text.slice(0, 400));
  pol = await view('get_policy', [PID]);
} else {
  say('   skipped: status is ' + pol.status + ', the round for v' + V + ' is already recorded');
}

const d = await view('get_decision', [PID, V]);
if (!d) hardStop('no decision record for v' + V);
say('');
say('   THE DETERMINATION (v' + V + ')');
check(d.evidence_flag === 'SUFFICIENT', 'the record is SUFFICIENT — the panel could read (got ' + d.evidence_flag + ')');
check(Number(d.publishers) === 3, 'THREE independent publishers spoke (got ' + d.publishers + ')');
check(Number(d.qualifying) === 1, 'ONE read past the trigger (got ' + d.qualifying + ')');
check(Number(d.contradicting) === 2, 'TWO read short of it (got ' + d.contradicting + ')');
check(d.outcome === 'NOT_SATISFIED', 'the trigger was NOT met (got ' + d.outcome + ')');
/* Name every row. The tally alone would be satisfied by a different story. */
for (const e of EXPECTED) {
  const row = (d.rows ?? []).find((r) => r.host === e.host);
  check(row ? Number(row.reading) === e.reading : false,
    e.what + ' reads ' + e.reading + ' (got ' + (row ? row.reading : 'no row') + ')');
}
const party = (d.rows ?? []).find((r) => r.host === 'raw.githack.com');
check(party ? party.cls === 'PARTY' : false, 'the station log is the policyholder\'s own and never counts');
if (d.outcome !== 'NOT_SATISFIED') {
  hardStop('the panel returned ' + d.outcome + ', not NOT_SATISFIED. The evidence decides this, not the script.');
}

if (pol.status === 'PENDING_FINALITY') {
  const until = Number(pol.pending_until_epoch);
  while (nowSec() <= until + 5) {
    const left = until + 5 - nowSec();
    say('   the finality window is still open, ' + left + 's to go');
    await sleep(Math.min(left + 2, 45) * 1000);
  }
  const pr = await send('THIRD', 'promote', [PID]);
  check(pr.ok, 'promote landed SUCCESS (permissionless)');
  if (!pr.ok) hardStop('promote reverted: ' + pr.text.slice(0, 400));
  pol = await view('get_policy', [PID]);
}
summarise(pol, 'after promotion');
check(pol.outcome === 'NOT_SATISFIED', 'the outcome of record is NOT_SATISFIED (got ' + pol.outcome + ')');
check(pol.status === 'FINAL' || pol.status === 'ACTIVE' || pol.status === 'EXPIRED',
  'a refused trigger reaches a settleable state (got ' + pol.status + ')');
const mAfterPanel = await money('after the determination');
check(mAfterPanel.paid === m0.paid, 'the determination paid nobody (' + mAfterPanel.paid + ')');
check(mAfterPanel.holder === m0.holder, 'the policyholder was credited nothing (' + mAfterPanel.holder + ')');

// ── Act C: settlement that moves nothing ────────────────────────────────────
say('');
say('ACT C - settlement. The whole point: it moves NOTHING');
if (pol.status === 'FINAL') {
  const until = Number(pol.appeal_until_epoch);
  while (nowSec() <= until + 5) {
    const left = until + 5 - nowSec();
    say('   the appeal window is still open, ' + left + 's to go');
    await sleep(Math.min(left + 2, 45) * 1000);
  }
  const mBefore = await money('before settle');
  const st = await send('THIRD', 'settle', [PID]);
  check(st.ok, 'settle landed SUCCESS (permissionless)');
  if (!st.ok) hardStop('settle reverted: ' + st.text.slice(0, 400));
  const mAfter = await money('after settle');
  check(mAfter.escrow === mBefore.escrow, 'CUSTODY IS UNCHANGED — a refused trigger moves no coverage (' + mAfter.escrow + ')');
  check(mAfter.paid === mBefore.paid, 'NOTHING WAS PAID (' + mAfter.paid + ')');
  check(mAfter.holder === mBefore.holder, 'the policyholder is credited nothing (' + mAfter.holder + ')');
  pol = await view('get_policy', [PID]);
  summarise(pol, 'after settle');
  check(pol.status === 'ACTIVE', 'the policy returns to ACTIVE for the rest of its period (got ' + pol.status + ')');
} else {
  say('   skipped: status is ' + pol.status + ', not FINAL');
}

// ── Act D: the insurer reclaims ─────────────────────────────────────────────
say('');
say('ACT D - the claim grace passes and the coverage goes back to the insurer');
if (pol.status === 'ACTIVE' || pol.status === 'INVESTIGATING') {
  while (nowSec() <= deadline + CLOCK_MARGIN) {
    const left = deadline + CLOCK_MARGIN - nowSec();
    say('   the claim grace is still open, ' + left + 's to go');
    await sleep(Math.min(left + 2, 60) * 1000);
  }
  await mustRefuse('YES', 'file_claim', [PID, cStart, cEnd, 151, JSON.stringify(ROWS)], 0n, 'claim grace');
  const mBefore = await money('before expire');
  const ex = await send('THIRD', 'expire', [PID]);
  check(ex.ok, 'expire landed SUCCESS (permissionless — anyone may run it)');
  if (!ex.ok) hardStop('expire reverted: ' + ex.text.slice(0, 400));
  const mAfter = await money('after expire');
  check(mAfter.insurer === mBefore.insurer + COVERAGE,
    'THE WHOLE COVERAGE IS CREDITED TO THE INSURER: ' + mBefore.insurer + ' + ' + COVERAGE + ' = ' + mAfter.insurer);
  check(mAfter.holder === mBefore.holder, 'the policyholder is still credited nothing (' + mAfter.holder + ')');
  check(mAfter.paid === mBefore.paid, 'paid_atto did not move — a refund is not a payout (' + mAfter.paid + ')');
  pol = await view('get_policy', [PID]);
  summarise(pol, 'after expire');
} else {
  say('   skipped: status is ' + pol.status);
}

if (pol.status === 'EXPIRED') {
  const mBefore = await money('before the insurer withdraws');
  if (mBefore.insurer > 0n) {
    const cl = await send('CREATOR', 'claim', []);
    check(cl.ok, 'claim landed SUCCESS');
    const mAfter = await money('after the insurer withdraws');
    check(mAfter.insurer === 0n, 'the insurer is owed nothing further (' + mAfter.insurer + ')');
    check(mAfter.escrow === mBefore.escrow - mBefore.insurer,
      'custody falls by exactly what left (' + mBefore.escrow + ' - ' + mBefore.insurer + ' = ' + mAfter.escrow + ')');
  } else {
    say('   skipped: the insurer has already withdrawn');
  }
}

// ── reconciliation ──────────────────────────────────────────────────────────
say('');
say('RECONCILIATION');
pol = await view('get_policy', [PID]);
const mEnd = await money('at the end');
summarise(pol, 'final');
check(pol.status === 'EXPIRED', 'the policy ends EXPIRED (got ' + pol.status + ')');
check(pol.outcome === 'NOT_SATISFIED', 'the outcome of record is still NOT_SATISFIED (got ' + pol.outcome + ')');
check(mEnd.paid === m0.paid, 'PAID_ATTO NEVER MOVED across the whole arc (' + m0.paid + ' -> ' + mEnd.paid + ')');
check(mEnd.holder === 0n, 'the policyholder received nothing, and is owed nothing (' + mEnd.holder + ')');
say('');
say('   The publishers were read and they disagreed with the claim: one past the');
say('   trigger, two short of it. The contract refused to pay, moved no coverage,');
say('   and returned it to the insurer once the claim grace closed. The');
say('   policyholder lost the premium and nothing else; the insurer never paid a');
say('   claim it did not owe. Nobody arbitrated that — the count did.');

if (unproven.length) {
  say('REFUSED, REASON NOT RETURNED BY THE NODE (' + unproven.length + '): ' + unproven.join('; '));
}
say(fails.length === 0 ? 'ALL CHECKS PASSED' : 'FAILED: ' + fails.length + ' - ' + fails.join('; '));
writeFileSync('arc.refuse.transcript.json', JSON.stringify({ log, fails, unproven, policy: pol }, null, 1));
process.exit(fails.length === 0 ? 0 : 1);
