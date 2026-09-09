/* Acts 8-12: the payout path, live on trg-000001.
 *
 * Act 8   the policyholder refiles (version 2) citing the agency, the press
 *         and its own station log — NOT the weather provider. Two INDEPENDENT
 *         publishers, both past the 150 km/h trigger.
 * Act 9   the panel runs; after the finality window the record is promoted.
 *         Expected: SUFFICIENT, publishers 2, qualifying 2, contradicting 0
 *         -> SATISFIED.
 * Act 10  the INSURER appeals with a 0.05 GEN bond and adds the provider row
 *         (149 km/h — short of the trigger). The re-hearing reads the RECORDED
 *         bytes of rows EV-001..EV-003 and fetches only EV-004 live. Expected:
 *         publishers 3, qualifying 2, contradicting 1 -> SATISFIED STANDS.
 *         The outcome string did not change, so the appeal failed and the bond
 *         is forfeited to the counterparty — the policyholder. A second
 *         promotion is MANDATORY: re_investigate arms a fresh finality window
 *         and resets the outcome to ''.
 * Act 11  settle credits the WHOLE coverage to the policyholder. No split.
 * Act 12  the policyholder withdraws bond + coverage in ONE claim(); custody
 *         for this policy reconciles to zero.
 *
 * THE POINT OF THE ASSERTIONS: it is not enough that the arc ends SATISFIED.
 * The script asserts the DERIVATION — the publisher arithmetic before and
 * after the contradicting source enters — because that is the claim being
 * made: adding a source that disagrees did not flip a majority, and a failed
 * appeal costs its bond.
 *
 * RESUMABLE. Every act is guarded by the state it expects, read from the
 * contract, not from a local flag. Re-running after a partial failure resumes
 * where the chain actually is; it never refiles a claim that is already on the
 * record. See the plan block below.
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
const ADDR = '0xe3d35e24E2aa9A58f451Ce0468cFA3cB3B1E1309';
const PID = 'trg-000001';
const SHA = '43c12b4bd913dc8b0ea7eb5c685d1ea85efe41da';
const FEE_FLOOR = 10n ** 15n;
const OUT = 'arc.payout.log';
const TRANSCRIPT = 'arc.payout.transcript.json';
const chain = { ...studioDevnet, id: 61997, name: 'Studio Next', rpcUrls: { default: { http: [RPC] } } };
const keys = JSON.parse(readFileSync('.data/keys.json', 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(OUT, '');
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); appendFileSync(OUT, s + '\n'); };
const fails = [];
/* Refusals that happened but whose REASON the node would not return. Not
   failures -- the call was refused -- but not full proofs either. */
const unproven = [];
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

/* send() is arc-promote.mjs's helper with two additions and no behaviour
 * change: a maxTicks budget (the two panel rounds need ~300 ticks, as
 * arc-panel.mjs used), and the leader's decoded payload on the return so a
 * revert prints the contract's own sentence instead of a bare false. */
async function send(role, fn, args, value = 0n, maxTicks = 200) {
  const client = createClient({ chain, account: createAccount(keys[role].pk) });
  const est = await estimate(client, fn, args, value);
  const feeValue = BigInt(est.feeValue) < FEE_FLOOR ? FEE_FLOOR : BigInt(est.feeValue);
  const fees = { distribution: est.distribution, feeValue, messageAllocations: est.messageAllocations };
  /* A PAYABLE WRITE IS NEVER RETRIED.
   *
   * resilient() cannot tell "the node refused it" from "the node accepted it
   * and the socket died before the hash came back". On a free call a second
   * send costs nothing but a wasted round. On appeal() it attaches the bond
   * again -- a second real 0.05 GEN, and the contract would refuse the
   * duplicate only AFTER the value had left the wallet. So value-bearing
   * calls get exactly one attempt; if it fails ambiguously the script stops
   * and the operator re-runs, where the resume branch re-reads appeal_open
   * and skips an appeal that actually landed. */
  const sendTries = value > 0n ? 1 : 3;
  const res = await resilient('send ' + fn, () =>
    client.writeContract({ address: ADDR, functionName: fn, args, value, fees }), sendTries);
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
      let p = l?.result?.payload ?? '';
      if (Array.isArray(p)) { try { p = Buffer.from(p).toString('utf-8'); } catch { /* keep */ } }
      say('   ' + fn + ': FINALIZED ' + t.result_name + ' leader=' + l?.execution_result);
      return { ok: l?.execution_result === 'SUCCESS', hash, text: String(p ?? '') };
    }
    if (st === 'CANCELED' || st === 'UNDETERMINED') { say('   ' + fn + ': ' + st); return { ok: false, hash, text: String(st) }; }
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
    /* THREE OUTCOMES, NOT TWO.
     *
     * The dangerous case is the call being ACCEPTED — that is a genuine
     * failure and is handled above. Here the call was refused, and the only
     * question left is whether we can prove WHY.
     *
     * Studio Next does not always surface the contract's own sentence at the
     * fee-estimation stage: a refusal can come back as a bare
     * InvalidInputRpcError with no decodable payload. Recording that as a
     * FAIL says "the contract did not refuse", which is the opposite of what
     * happened and the opposite of what matters. Recording it as a clean pass
     * would claim a sentence we never read. So it is its own result: the
     * refusal is demonstrated, its reason is not. */
    const text = revertText(err);
    const hit = text.toLowerCase().includes(needle.toLowerCase());
    if (hit) {
      check(true, fn + ' refused: "' + needle + '"');
    } else {
      unproven.push(fn + ' (' + needle + ')');
      say('   ok* ' + fn + ' was REFUSED, but the node did not return the '
        + 'contract\'s reason, so "' + needle + '" is not proven by this run');
      say('        node said: ' + text.slice(0, 200).replace(/\s+/g, ' '));
    }
  }
}

// ── the arc's own vocabulary ────────────────────────────────────────────────

const COVERAGE = 100000000000000000n;   // 0.1 GEN
const BOND = 50000000000000000n;        // 0.05 GEN, the floor at this coverage
const HOLDER = '0x57a7dc8ea2d2de0a5906eb28902b8d677dfc657c';
const INSURER = '0x86ddeafc53b2e194aad4d74d265ab7cb741118b5';
/* The consensus clock (cdn-cgi/trace + eth floor + beacon ceiling) may differ
 * from this machine's clock by up to MAX_CLOCK_DIVERGENCE = 300 s in either
 * direction. Every wall-clock wait carries that margin plus slack. */
const CLOCK_MARGIN = 330;

const AGENCY = 'https://raw.githubusercontent.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/agency-bulletin-07.txt';
const PRESS = 'https://cdn.jsdelivr.net/gh/Hemmy1417/Triggera@' + SHA + '/evidence/storm-07/press-report.txt';
const PROVIDER = 'https://rawcdn.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/provider-history.txt';
const STATION = 'https://raw.githack.com/Hemmy1417/Triggera/' + SHA + '/evidence/storm-07/station-log.txt';

const CLAIM_ROWS = [
  { url: AGENCY, label: 'Agency bulletin 07' },
  { url: PRESS, label: 'Provincial press report' },
  { url: STATION, label: 'Premises station log' },
];
const PROVIDER_LABEL = 'Weather provider daily history';
const GROUNDS = 'the weather provider daily history for the same window reads 149 km/h, '
  + 'short of the 150 km/h trigger, and the filed record left that source out';

const nowSec = () => Math.floor(Date.now() / 1000);
const gen = (atto) => (Number(atto) / 1e18).toFixed(4) + ' GEN';

async function claimableOf(addr) {
  /* get_claimable returns a BARE decimal string. JSON.parse would turn
     150000000000000000 into a lossy Number, so never route it through view(). */
  const raw = await rawView('get_claimable', [addr]);
  return BigInt(String(raw ?? '0') || '0');
}

async function money(label) {
  const s = await view('get_stats');
  const holder = await claimableOf(HOLDER);
  const insurer = await claimableOf(INSURER);
  const m = {
    policies: Number(s.policies), active: Number(s.active),
    investigations: Number(s.investigations), satisfied: Number(s.satisfied),
    paid: BigInt(s.paid_atto), escrow: BigInt(s.escrow_atto),
    holder, insurer,
  };
  say('   MONEY ' + label + ': escrow ' + m.escrow + ' (' + gen(m.escrow) + ')'
    + '  paid ' + m.paid + '  claimable[holder] ' + m.holder + '  claimable[insurer] ' + m.insurer);
  say('         stats policies ' + m.policies + ' active ' + m.active
    + ' investigations ' + m.investigations + ' satisfied ' + m.satisfied);
  return m;
}

function summarise(p, where) {
  say('   STATE ' + where + ': status=' + p.status
    + ' evidence_v' + p.evidence_version + ' judged_v' + p.judged_version
    + ' pending_v' + p.pending_version
    + ' outcome=' + (p.outcome || '-') + '/' + (p.hold_reason || '-')
    + ' flag=' + (p.evidence_flag || '-')
    + ' pubs=' + p.publishers + ' qual=' + p.qualifying + ' contra=' + p.contradicting
    + ' appeal_open=' + p.appeal_open
    + ' payout=' + p.payout_atto);
}

const transcript = { log, fails, decisions: {}, money: {} };
function finish(code) {
  say('');
  if (unproven.length) {
    say('REFUSED, REASON NOT RETURNED BY THE NODE (' + unproven.length + '): ' + unproven.join('; '));
    say('  the call was refused in each case; the node did not surface the reason');
    say('  at estimation, so this run does not prove WHICH rule refused it.');
  }
  say(fails.length === 0 && code === 0 ? 'ALL CHECKS PASSED' : 'FAILED: ' + fails.length + (fails.length ? ' - ' + fails.join('; ') : ''));
  transcript.fails = fails;
  writeFileSync(TRANSCRIPT, JSON.stringify(transcript, null, 1));
  process.exit(fails.length === 0 && code === 0 ? 0 : 1);
}
/** The arc cannot continue and must not paper over it. */
function hardStop(why) {
  say('');
  say('STOP: ' + why);
  fails.push(why);
  finish(1);
}

/** Wait until the LOCAL clock is past a deadline the POLICY reports, with the
 *  consensus-clock margin added. Re-reads the view every pass — never a local
 *  stopwatch, because the field can be re-armed underneath us. */
async function waitPast(field, what) {
  for (;;) {
    const p = await view('get_policy', [PID]);
    const until = Number(p[field]);
    if (!until) { say('   ' + field + ' is 0 — nothing to wait for'); return p; }
    const left = until + CLOCK_MARGIN - nowSec();
    if (left <= 0) {
      say('   ' + what + ' is open (' + field + '=' + until + ', local now ' + nowSec() + ')');
      return p;
    }
    say('   ' + what + ': ' + left + 's to go (' + field + '=' + until + ' + ' + CLOCK_MARGIN + 's clock margin)');
    await sleep(Math.min(left, 45) * 1000);
  }
}

function decisionLine(d) {
  say('   outcome        ' + d?.outcome + (d?.hold_reason ? ' / ' + d.hold_reason : ''));
  say('   evidence_flag  ' + d?.evidence_flag);
  say('   publishers     ' + d?.publishers + '  qualifying ' + d?.qualifying + '  contradicting ' + d?.contradicting);
  say('   reason         ' + String(d?.reason ?? '').slice(0, 300));
  for (const r of d?.rows ?? []) {
    say('   row ' + r.id + ' ' + r.cls + '/' + r.kind + ' ' + r.host
      + ' readable=' + r.readable + ' reading=' + JSON.stringify(r.reading)
      + ' window_ok=' + r.window_ok + ' geo_ok=' + r.geo_ok + ' kind_matches=' + r.kind_matches);
  }
}

// ── where are we? the resume plan ───────────────────────────────────────────

let pol = await view('get_policy', [PID]);
if (!pol) hardStop('policy ' + PID + ' is not on the contract at ' + ADDR);
say('TRIGGERA payout arc — policy ' + PID + ' at ' + ADDR);
summarise(pol, 'on entry');
const m0 = await money('on entry');
transcript.money.entry = { ...m0, paid: String(m0.paid), escrow: String(m0.escrow), holder: String(m0.holder), insurer: String(m0.insurer) };

check(BigInt(pol.coverage_atto) === COVERAGE, 'coverage is 0.1 GEN (' + pol.coverage_atto + ')');
check(BigInt(pol.appeal_bond_atto) === BOND, 'the policy demands a 0.05 GEN bond (' + pol.appeal_bond_atto + ')');
check(pol.policyholder.toLowerCase() === HOLDER, 'policyholder is the YES key');
check(pol.insurer.toLowerCase() === INSURER, 'insurer is the CREATOR key');
check(Number(pol.min_independent) === 2, 'min_independent is 2');
check(pol.operator === 'GTE' && Number(pol.threshold) === 150, 'the trigger is GTE 150 ' + pol.unit);
if (fails.length) hardStop('the policy is not the one this arc was written against');

const V_CLAIM = 2;   // the claim this arc files
const V_APPEAL = 3;  // the version the appeal appends the provider to

/* Every act is guarded on chain state, so a re-run resumes rather than
 * repeats. The one state this arc cannot recover from is ACTIVE with the
 * claim already filed: that means a promotion sent an UNDETERMINED round back
 * to ACTIVE, and refiling blindly would burn a version and hide the failure. */
const plan = {
  act8: pol.status === 'ACTIVE' && Number(pol.evidence_version) < V_CLAIM,
  act9a: false, act9b: false, act10a: false, act10b: false, act10c: false, act11: false, act12: false,
};
if (pol.status === 'ACTIVE' && Number(pol.evidence_version) >= V_CLAIM) {
  hardStop('the policy is ACTIVE with evidence_version ' + pol.evidence_version
    + ' — a previous round was promoted as UNDETERMINED (' + (pol.hold_reason || '?')
    + '). The evidence did not carry. Refiling is a decision for a human, not a retry.');
}
say('');
say('PLAN: entering at status ' + pol.status + ', evidence v' + pol.evidence_version
  + ', judged v' + pol.judged_version + '. Acts already on the record are skipped.');

// ── Act 8 — the claim (version 2) ───────────────────────────────────────────

say('');
say('ACT 8 - the policyholder files claim version ' + V_CLAIM + ' (agency + press + station; the provider is NOT cited)');
if (!plan.act8) {
  say('   skipped: evidence_version is already ' + pol.evidence_version + ' and the status is ' + pol.status);
} else {
  const deadline = Number(pol.coverage_end_epoch) + Number(pol.claim_grace);
  const slack = deadline - CLOCK_MARGIN - nowSec();
  say('   claim deadline epoch ' + deadline + ' — ' + slack + 's of margin left');
  if (slack <= 0) {
    hardStop('past coverage_end + claim_grace (' + deadline + '): file_claim would refuse and expire() '
      + 'is now permissionless — the coverage would refund to the insurer.');
  }
  /* THE EVENT WINDOW MUST BE AT LEAST ONE MEASUREMENT WINDOW WIDE.
   *
   * measurement_hours is not a wall in file_claim -- the contract would
   * happily accept a six-hour window. It is a wall in the PANEL'S PROMPT:
   * the model is asked for "the value the source states ... over a
   * {measurement_hours}-hour window inside the event window". Our fixtures
   * state a 24-hour figure, and this policy measures over 24 hours, so a
   * six-hour event window has no 24-hour window inside it and every reading
   * comes back null. That does not revert -- it lands a perfectly valid
   * UNDETERMINED and CONSUMES an evidence version we cannot get back. A
   * silent wrong answer is worse than a refusal, so the width is asserted
   * here rather than discovered afterwards.
   *
   * The coverage period is exactly one measurement window wide, so the only
   * legal claim is the whole of it -- and file_claim also demands the window
   * be OVER (`end > now` refuses). Hence the wait below. */
  const measureSecs = Number(pol.measurement_hours) * 3600;
  const start = Number(pol.coverage_start_epoch);
  const end = Number(pol.coverage_end_epoch);
  check(end - start >= measureSecs,
    'the coverage period is at least one ' + pol.measurement_hours + 'h measurement window wide');
  if (end - start < measureSecs) {
    hardStop('the coverage period (' + (end - start) + 's) is shorter than one measurement window ('
      + measureSecs + 's): no reading could ever be stated for it.');
  }

  /* file_claim refuses while the window is still running, and refuses again
     once the grace has passed. Both edges are the CONSENSUS clock, not ours,
     so we wait past the end with a margin and re-read rather than trusting
     the local clock at the boundary. */
  while (nowSec() <= end + CLOCK_MARGIN) {
    const left = end + CLOCK_MARGIN - nowSec();
    say('   the event window is still running, ' + left + 's to go'
      + ' (then ' + (deadline - end) + 's of grace to file)');
    await sleep(Math.min(left + 2, 60) * 1000);
  }
  if (nowSec() > deadline - CLOCK_MARGIN) {
    hardStop('the claim grace closes at ' + deadline + ' and our clock reads ' + nowSec()
      + ': too little margin to file safely. The coverage now belongs to the insurer via expire().');
  }
  say('   event window ' + start + ' -> ' + end
    + '  (' + new Date(start * 1000).toISOString() + ' -> ' + new Date(end * 1000).toISOString() + ')');
  say('   that is the whole coverage period, one ' + pol.measurement_hours + 'h measurement window wide');
  check(end > start, 'the event window ends after it starts');
  check(end <= Number(pol.coverage_end_epoch) && start >= Number(pol.coverage_start_epoch), 'the window sits inside the coverage period');
  if (fails.length) hardStop('the event window could not be built inside the coverage period');

  const filed = await send('YES', 'file_claim', [PID, start, end, 157, JSON.stringify(CLAIM_ROWS)]);
  check(filed.ok, 'file_claim landed SUCCESS');
  if (!filed.ok) hardStop('file_claim reverted: ' + filed.text.slice(0, 500));

  pol = await view('get_policy', [PID]);
  summarise(pol, 'after the claim');
  check(pol.status === 'INVESTIGATING', 'status is INVESTIGATING (got ' + pol.status + ')');
  check(Number(pol.evidence_version) === V_CLAIM, 'evidence version advanced to ' + V_CLAIM + ' (got ' + pol.evidence_version + ')');
  check(Number(pol.judged_version) === 1, 'judged_version is still 1 — filing decides nothing (got ' + pol.judged_version + ')');
  check(Number(pol.claimed_reading) === 157, 'the claimed reading 157 is on the record (got ' + pol.claimed_reading + ')');

  const pkg = await view('get_package', [PID, V_CLAIM]);
  const rows = pkg?.rows ?? [];
  check(rows.length === 3, 'three rows recorded, the provider deliberately absent (got ' + rows.length + ')');
  check(rows.map((r) => r.id).join(',') === 'EV-001,EV-002,EV-003', 'row ids restart at EV-001 for the new version (got ' + rows.map((r) => r.id).join(',') + ')');
  check(rows.filter((r) => r.cls === 'INDEPENDENT').length === 2, 'two INDEPENDENT rows (got ' + rows.filter((r) => r.cls === 'INDEPENDENT').length + ')');
  check(rows.filter((r) => r.cls === 'PARTY').length === 1, 'one PARTY row — the station log (got ' + rows.filter((r) => r.cls === 'PARTY').length + ')');
  check(!rows.some((r) => String(r.url ?? '').includes('rawcdn.githack.com')), 'the weather provider is NOT in the filed package');
  say('   rows: ' + rows.map((r) => r.id + ' ' + r.cls + '/' + r.kind).join(', '));

  const mAfterClaim = await money('after the claim');
  check(mAfterClaim.escrow === m0.escrow, 'filing moved no custody (' + mAfterClaim.escrow + ')');
  check(mAfterClaim.paid === m0.paid, 'filing paid nobody (' + mAfterClaim.paid + ')');
}

// ── Act 9a — the panel ──────────────────────────────────────────────────────

pol = await view('get_policy', [PID]);
plan.act9a = pol.status === 'INVESTIGATING';
say('');
say('ACT 9a - the panel (permissionless, run by an unrelated third party)');
if (!plan.act9a) {
  say('   skipped: status is ' + pol.status + ', not INVESTIGATING — the round for v' + V_CLAIM + ' is already on the record');
} else {
  const already = await view('get_decision', [PID, V_CLAIM]);
  if (already) hardStop('a decision for v' + V_CLAIM + ' exists while the status is INVESTIGATING — the chain is in a shape this arc does not model');
  say('   three pages are fetched live; this is a full LLM round, allow ~20 minutes');
  const inv = await send('THIRD', 'investigate', [PID], 0n, 300);
  check(inv.ok, 'investigate landed SUCCESS');
  if (!inv.ok) hardStop('investigate reverted: ' + inv.text.slice(0, 600));
}

// The derivation, asserted whether the round ran now or on a previous pass.
const d2 = await view('get_decision', [PID, V_CLAIM]);
transcript.decisions['v' + V_CLAIM] = d2;
if (!d2) hardStop('no decision record for v' + V_CLAIM);
say('');
say('   THE FIRST DETERMINATION (v' + V_CLAIM + ')');
decisionLine(d2);
check(d2.evidence_flag === 'SUFFICIENT', 'the record is SUFFICIENT (got ' + d2.evidence_flag + ')');
check(Number(d2.publishers) === 2, 'TWO independent publishers spoke (got ' + d2.publishers + ')');
check(Number(d2.qualifying) === 2, 'BOTH read past the 150 km/h trigger (got ' + d2.qualifying + ')');
check(Number(d2.contradicting) === 0, 'nothing contradicted (got ' + d2.contradicting + ')');
check(d2.outcome === 'SATISFIED', 'the trigger was met: SATISFIED (got ' + d2.outcome + ')');
const hosts2 = (d2.rows ?? []).map((r) => r.host);
/* A negative membership test passes for free on an empty array, so the row
   count is asserted first -- otherwise "the provider was absent" would be
   proved just as well by a record with no rows at all. */
check(hosts2.length === 3, 'the first round recorded three rows (got ' + hosts2.length + ')');
check(hosts2.length === 3 && !hosts2.includes('rawcdn.githack.com'),
  'and the provider host is absent from them — the insurer, not the claimant, brings it');
if (d2.outcome !== 'SATISFIED' || d2.evidence_flag !== 'SUFFICIENT') {
  hardStop('the first round did not carry (' + d2.outcome + ' / ' + d2.evidence_flag + ' / ' + (d2.hold_reason || '-')
    + '). promote() will send the policy back to ACTIVE and there is nothing to appeal or settle. '
    + 'The evidence, not the script, decides this — read the rows above.');
}

/* These two read GLOBAL counters (get_stats is contract-wide, not per-policy)
   against fixed numbers, so they are only true while this arc has not yet
   posted a bond or settled anything. On a resumed run -- appeal already
   filed, or the coverage already paid -- they would fail on a perfectly
   healthy chain and report a working arc as broken. Gate them on the phase
   they actually describe. */
const mAfterPanel = await money('after the panel');
if (pol.appeal_open !== 'yes' && pol.status !== 'PAID' && mAfterPanel.paid === 0n) {
  check(mAfterPanel.escrow === COVERAGE, 'custody still holds exactly the coverage (' + mAfterPanel.escrow + ')');
  check(mAfterPanel.paid === 0n, 'nothing has ever been paid (' + mAfterPanel.paid + ')');
} else {
  say('   (custody absolutes skipped: the chain is past this phase — escrow '
    + mAfterPanel.escrow + ', paid ' + mAfterPanel.paid + ')');
}

// ── Act 9b — promotion #1 ───────────────────────────────────────────────────

pol = await view('get_policy', [PID]);
plan.act9b = pol.status === 'PENDING_FINALITY' && Number(pol.pending_version) === V_CLAIM;
say('');
say('ACT 9b - promotion #1: the record becomes state after the finality window');
if (!plan.act9b) {
  say('   skipped: status is ' + pol.status + ' pending_v' + pol.pending_version + ' — v' + V_CLAIM + ' is already promoted');
} else {
  await waitPast('pending_until_epoch', 'the finality window');
  const pr = await send('THIRD', 'promote', [PID]);
  check(pr.ok, 'promote landed SUCCESS (permissionless)');
  if (!pr.ok) hardStop('promote reverted: ' + pr.text.slice(0, 500));
}

pol = await view('get_policy', [PID]);
summarise(pol, 'after promotion #1');
if (pol.status === 'ACTIVE') {
  hardStop('promotion returned the policy to ACTIVE — the round was not conclusive. Nothing to appeal, nothing to settle.');
}
check(pol.status === 'FINAL' || Number(pol.judged_version) >= V_CLAIM, 'the record was promoted (status ' + pol.status + ', judged v' + pol.judged_version + ')');
/* Only assert the promoted state while it IS the promoted state: a resume
 * that lands after the re-hearing finds judged_version still 2 but the
 * outcome deliberately reset to '', and asserting SATISFIED there would fail
 * for the wrong reason. */
if (pol.status === 'FINAL' && Number(pol.judged_version) === V_CLAIM) {
  check(pol.outcome === 'SATISFIED', 'SATISFIED is now STATE, not just a record (got ' + pol.outcome + ')');
  check(pol.evidence_flag === 'SUFFICIENT', 'the state carries the SUFFICIENT flag (got ' + pol.evidence_flag + ')');
  check(Number(pol.publishers) === 2 && Number(pol.qualifying) === 2 && Number(pol.contradicting) === 0,
    'the derivation was copied onto the policy: 2/2/0 (got ' + pol.publishers + '/' + pol.qualifying + '/' + pol.contradicting + ')');
}

// ── Act 10a — the insurer's bonded appeal ───────────────────────────────────

pol = await view('get_policy', [PID]);
plan.act10a = pol.status === 'FINAL' && !pol.appeal_open && Number(pol.judged_version) === V_CLAIM
  && Number(pol.evidence_version) === V_CLAIM;
say('');
say('ACT 10a - the INSURER appeals with a ' + gen(BOND) + ' bond, adding the provider row (149 km/h)');
if (!plan.act10a) {
  say('   skipped: status ' + pol.status + ', appeal_open=' + pol.appeal_open
    + ', evidence v' + pol.evidence_version + ' — the appeal is already filed or no longer possible');
  if (Number(pol.evidence_version) < V_APPEAL) {
    hardStop('the appeal was never filed and cannot be filed now (status ' + pol.status
      + ', appeal_open=' + pol.appeal_open + ', evidence v' + pol.evidence_version
      + ', appeal_until_epoch ' + pol.appeal_until_epoch + ' vs local now ' + nowSec()
      + '). The 900s appeal window closed. Acts 10-12 rest on it, so the arc ends here rather '
      + 'than pretending a re-hearing happened.');
  }
} else {
  const left = Number(pol.appeal_until_epoch) - nowSec();
  say('   appeal window closes at epoch ' + pol.appeal_until_epoch + ' — ' + left + 's of local slack');
  if (left <= CLOCK_MARGIN) {
    hardStop('only ' + left + 's of the appeal window remain and the consensus clock can run '
      + CLOCK_MARGIN + 's ahead of this machine. Filing now would likely refuse. The window is 900s wide: '
      + 'promote and appeal must run in the same pass.');
  }
  const mBefore = await money('before the appeal');
  const ap = await send('CREATOR', 'appeal', [PID, GROUNDS, PROVIDER, PROVIDER_LABEL], BOND);
  check(ap.ok, 'appeal landed SUCCESS with the exact bond');
  if (!ap.ok) hardStop('appeal reverted: ' + ap.text.slice(0, 500));

  pol = await view('get_policy', [PID]);
  summarise(pol, 'after the appeal');
  check(pol.appeal_open === true, 'an appeal is open (poll this, not the status)');
  check(pol.status === 'FINAL', 'the status is UNCHANGED at FINAL — an appeal is not a status (got ' + pol.status + ')');
  check(pol.appellant.toLowerCase() === INSURER, 'the appellant is the insurer (got ' + pol.appellant + ')');
  check(Number(pol.appealed_version) === V_CLAIM, 'the appealed version is ' + V_CLAIM + ' (got ' + pol.appealed_version + ')');
  check(Number(pol.appeal_new_version) === V_APPEAL, 'the appeal writes version ' + V_APPEAL + ' (got ' + pol.appeal_new_version + ')');
  check(Number(pol.evidence_version) === V_APPEAL, 'evidence_version advanced to ' + V_APPEAL + ' (got ' + pol.evidence_version + ')');

  const pkg3 = await view('get_package', [PID, V_APPEAL]);
  const rows3 = pkg3?.rows ?? [];
  check(rows3.length === 4, 'the appealed package holds the three prior rows plus one (got ' + rows3.length + ')');
  const ev4 = rows3.find((r) => r.id === 'EV-004');
  check(!!ev4, 'the provider entered as EV-004');
  check(String(ev4?.label ?? '').startsWith('[APPELLANT] '), 'EV-004 is labelled as the appellant\'s addition (got ' + ev4?.label + ')');
  check(ev4?.cls === 'INDEPENDENT' && ev4?.kind === 'WEATHER_PROVIDER', 'EV-004 inherits its class and kind from the frozen basis (got ' + ev4?.cls + '/' + ev4?.kind + ')');

  const mAfterAppeal = await money('after the appeal');
  check(mAfterAppeal.escrow === mBefore.escrow + BOND, 'the bond is now in custody: ' + mBefore.escrow + ' + ' + BOND + ' = ' + mAfterAppeal.escrow);
  check(mAfterAppeal.escrow === COVERAGE + BOND, 'custody holds coverage + bond (' + gen(mAfterAppeal.escrow) + ')');
  check(mAfterAppeal.holder === mBefore.holder, 'the bond is HELD, not credited to the policyholder (' + mAfterAppeal.holder + ')');
  check(mAfterAppeal.insurer === mBefore.insurer, 'the bond is HELD, not credited to the insurer (' + mAfterAppeal.insurer + ')');
}

// ── Act 10b — the re-hearing ────────────────────────────────────────────────

pol = await view('get_policy', [PID]);
plan.act10b = pol.appeal_open === true;
say('');
say('ACT 10b - the re-hearing: EV-001..EV-003 are read from the RECORDED bytes, only EV-004 is fetched live');
let mBeforeRe = null;
if (!plan.act10b) {
  say('   skipped: no appeal is open — the re-hearing already concluded');
} else {
  const filedAt = Number(pol.appeal_filed_epoch);
  const staleAt = filedAt + 3600;
  const staleIn = staleAt - nowSec();
  say('   the appeal lapses (bond refunded to the insurer, by anyone) at epoch ' + staleAt + ' — ' + staleIn + 's away');
  if (staleIn <= 0) {
    hardStop('the appeal is past its stale window: lapse_appeal is permissionless now and would refund the bond '
      + 'to the insurer, converting a failed appeal into a free one. Re-run the arc from a fresh appeal.');
  }
  mBeforeRe = await money('before the re-hearing');
  say('   this is a second full LLM round, allow ~20 minutes');
  const re = await send('THIRD', 're_investigate', [PID], 0n, 300);
  check(re.ok, 're_investigate landed SUCCESS (permissionless)');
  if (!re.ok) hardStop('re_investigate reverted: ' + re.text.slice(0, 600));
  say('   contract returned: ' + re.text.slice(0, 300));
}

const d3 = await view('get_decision', [PID, V_APPEAL]);
transcript.decisions['v' + V_APPEAL] = d3;
if (!d3) hardStop('no decision record for v' + V_APPEAL);
say('');
say('   THE RE-HEARING (v' + V_APPEAL + ') — the whole point of the arc');
decisionLine(d3);
check(d3.evidence_flag === 'SUFFICIENT', 'the re-heard record is still SUFFICIENT (got ' + d3.evidence_flag + ')');
check(Number(d3.publishers) === 3, 'THREE publishers now speak (got ' + d3.publishers + ')');
check(Number(d3.qualifying) === 2, 'two still read past the trigger (got ' + d3.qualifying + ')');
check(Number(d3.contradicting) === 1, 'exactly ONE publisher contradicts (got ' + d3.contradicting + ')');
/* Counting to one does not prove WHICH source dissented, and the whole arc
   rests on it being the provider at 149. An assertion that only counts would
   pass just as happily if the agency had gone unreadable and the press had
   dropped to 140 -- a completely different story with the same tally. So name
   the row and read its number. */
const providerRow = (d3.rows ?? []).find((r) => r.host === 'rawcdn.githack.com');
check(!!providerRow, 'the provider row is present in the re-heard record');
check(providerRow ? Number(providerRow.reading) === 149 : false,
  'and it is the PROVIDER that dissents, reading 149 km/h against a 150 threshold (got '
  + (providerRow ? providerRow.reading : 'no row') + ')');
const agencyRow = (d3.rows ?? []).find((r) => r.host === 'raw.githubusercontent.com');
const pressRow = (d3.rows ?? []).find((r) => r.host === 'cdn.jsdelivr.net');
check(agencyRow ? Number(agencyRow.reading) === 157 : false,
  'the agency still reads 157 (got ' + (agencyRow ? agencyRow.reading : 'no row') + ')');
check(pressRow ? Number(pressRow.reading) === 161 : false,
  'the press still reads 161 (got ' + (pressRow ? pressRow.reading : 'no row') + ')');
check(d3.outcome === 'SATISFIED', 'SATISFIED STANDS — a contradicting source did not flip a majority (got ' + d3.outcome + ')');
check(d3.outcome === d2.outcome, 'the outcome string is unchanged (' + d2.outcome + ' -> ' + d3.outcome + '), so the appeal FAILED');
const hosts3 = (d3.rows ?? []).map((r) => r.host);
check(hosts3.includes('rawcdn.githack.com'), 'the provider host is in the re-heard round');
if (d3.outcome !== 'SATISFIED') {
  hardStop('the re-hearing changed the outcome to ' + d3.outcome + '. The appeal SUCCEEDED, the bond went back '
    + 'to the insurer, and the payout path is closed. That is the contract working, not a bug — but it is not this arc.');
}

if (mBeforeRe) {
  const mAfterRe = await money('after the re-hearing');
  check(mAfterRe.holder === mBeforeRe.holder + BOND,
    'THE FORFEITED BOND IS CREDITED TO THE POLICYHOLDER: ' + mBeforeRe.holder + ' + ' + BOND + ' = ' + mAfterRe.holder);
  check(mAfterRe.insurer === mBeforeRe.insurer, 'the insurer was credited nothing (' + mAfterRe.insurer + ')');
  check(mAfterRe.escrow === mBeforeRe.escrow, 'custody is unchanged — the atto only changed owner on the ledger (' + mAfterRe.escrow + ')');
  check(mAfterRe.investigations === mBeforeRe.investigations + 1, 'the investigation count advanced (' + mAfterRe.investigations + ')');
  check(mAfterRe.paid === 0n, 'still nothing paid out (' + mAfterRe.paid + ')');
}

pol = await view('get_policy', [PID]);
summarise(pol, 'after the re-hearing');
check(pol.appeal_open === false, 'the appeal is closed (got ' + pol.appeal_open + ')');
check(pol.status === 'PENDING_FINALITY' || Number(pol.judged_version) >= V_APPEAL,
  'the re-hearing armed a fresh finality window (status ' + pol.status + ')');

// ── Act 10c — promotion #2 (mandatory) ──────────────────────────────────────

pol = await view('get_policy', [PID]);
plan.act10c = pol.status === 'PENDING_FINALITY' && Number(pol.pending_version) === V_APPEAL;
say('');
say('ACT 10c - promotion #2: mandatory. re_investigate reset the outcome to "" and armed a NEW window');
if (!plan.act10c) {
  say('   skipped: status is ' + pol.status + ' judged_v' + pol.judged_version + ' — v' + V_APPEAL + ' is already promoted');
} else {
  check(pol.outcome === '', 'the outcome was reset by the re-hearing — without this promote, settle refuses (got "' + pol.outcome + '")');
  await waitPast('pending_until_epoch', 'the second finality window');
  const pr2 = await send('THIRD', 'promote', [PID]);
  check(pr2.ok, 'promote #2 landed SUCCESS');
  if (!pr2.ok) hardStop('promote #2 reverted: ' + pr2.text.slice(0, 500));
}

pol = await view('get_policy', [PID]);
summarise(pol, 'after promotion #2');
if (pol.status === 'ACTIVE') hardStop('promotion #2 returned the policy to ACTIVE — the re-heard round was not conclusive');
check(Number(pol.judged_version) === V_APPEAL, 'the judged version is now ' + V_APPEAL + ' (got ' + pol.judged_version + ')');
check(pol.outcome === 'SATISFIED', 'the re-heard SATISFIED is now state (got ' + pol.outcome + ')');
check(Number(pol.publishers) === 3 && Number(pol.qualifying) === 2 && Number(pol.contradicting) === 1,
  'the state carries 3 publishers / 2 qualifying / 1 contradicting (got '
  + pol.publishers + '/' + pol.qualifying + '/' + pol.contradicting + ')');

// ── Act 11 — settlement ─────────────────────────────────────────────────────

pol = await view('get_policy', [PID]);
plan.act11 = pol.status === 'FINAL' && !pol.appeal_open && BigInt(pol.payout_atto) === 0n;
say('');
say('ACT 11 - settlement: the WHOLE coverage is credited to the policyholder');
if (!plan.act11) {
  say('   skipped: status ' + pol.status + ', payout ' + pol.payout_atto + ' — this policy is already settled');
} else {
  await waitPast('appeal_until_epoch', 'the second appeal window');
  const mBeforeSettle = await money('before settle');
  const st = await send('THIRD', 'settle', [PID]);
  check(st.ok, 'settle landed SUCCESS (permissionless: run by a third party who is paid nothing)');
  if (!st.ok) hardStop('settle reverted: ' + st.text.slice(0, 500));

  pol = await view('get_policy', [PID]);
  summarise(pol, 'after settle');
  check(pol.status === 'PAID', 'status is PAID (got ' + pol.status + ')');
  check(BigInt(pol.payout_atto) === COVERAGE, 'the payout is the whole coverage, no split, no rounding (' + pol.payout_atto + ')');

  const mAfterSettle = await money('after settle');
  check(mAfterSettle.holder === mBeforeSettle.holder + COVERAGE,
    'the coverage is credited to the policyholder: ' + mBeforeSettle.holder + ' + ' + COVERAGE + ' = ' + mAfterSettle.holder);
  check(mAfterSettle.holder === COVERAGE + BOND, 'the policyholder is owed coverage + forfeited bond = ' + gen(COVERAGE + BOND));
  check(mAfterSettle.insurer === mBeforeSettle.insurer, 'settling credited the insurer nothing (' + mAfterSettle.insurer + ')');
  check(mAfterSettle.paid === mBeforeSettle.paid + COVERAGE, 'paid_atto advanced by exactly the coverage (' + mAfterSettle.paid + ')');
  check(mAfterSettle.satisfied === mBeforeSettle.satisfied + 1, 'the satisfied count advanced (' + mAfterSettle.satisfied + ')');
  check(mAfterSettle.active === mBeforeSettle.active - 1, 'the active count fell (' + mAfterSettle.active + ')');
  check(mAfterSettle.escrow === mBeforeSettle.escrow, 'custody is unchanged at settle — crediting is not paying (' + mAfterSettle.escrow + ')');

  say('   settle is one-shot:');
  await mustRefuse('THIRD', 'settle', [PID], 0n, 'nothing to settle in PAID');
}

// ── Act 12 — the withdrawal ─────────────────────────────────────────────────

pol = await view('get_policy', [PID]);
const owed = await claimableOf(HOLDER);
plan.act12 = owed > 0n;
say('');
say('ACT 12 - the policyholder withdraws: ONE claim() moves bond + coverage');
if (!plan.act12) {
  say('   skipped: the policyholder is owed nothing — the withdrawal already happened');
} else {
  check(owed === COVERAGE + BOND, 'the ledger owes the policyholder ' + gen(COVERAGE + BOND) + ' (got ' + owed + ')');
  const mBeforeClaim = await money('before the withdrawal');
  const cl = await send('YES', 'claim', [], 0n);
  check(cl.ok, 'claim landed SUCCESS');
  if (!cl.ok) hardStop('claim reverted: ' + cl.text.slice(0, 500));

  const mAfterClaim = await money('after the withdrawal');
  check(mAfterClaim.holder === 0n, 'the policyholder ledger is zeroed (' + mAfterClaim.holder + ')');
  check(mAfterClaim.escrow === mBeforeClaim.escrow - (COVERAGE + BOND),
    'custody fell by exactly what left: ' + mBeforeClaim.escrow + ' - ' + (COVERAGE + BOND) + ' = ' + mAfterClaim.escrow);
  check(mAfterClaim.escrow === 0n, 'CUSTODY RECONCILES TO ZERO for this policy (' + mAfterClaim.escrow + ')');
  check(mAfterClaim.paid === mBeforeClaim.paid, 'paid_atto is the settlement figure, not the withdrawal (' + mAfterClaim.paid + ')');

  say('   claim is one-shot:');
  await mustRefuse('YES', 'claim', [], 0n, 'nothing claimable');
}

// ── the reconciliation ──────────────────────────────────────────────────────

pol = await view('get_policy', [PID]);
const mEnd = await money('at the end');
transcript.money.end = { ...mEnd, paid: String(mEnd.paid), escrow: String(mEnd.escrow), holder: String(mEnd.holder), insurer: String(mEnd.insurer) };
say('');
say('RECONCILIATION');
summarise(pol, 'final');
check(pol.status === 'PAID', 'the policy ends PAID (got ' + pol.status + ')');
check(pol.outcome === 'SATISFIED', 'the outcome of record is SATISFIED (got ' + pol.outcome + ')');
check(Number(pol.judged_version) === V_APPEAL, 'the judged version of record is ' + V_APPEAL + ' (got ' + pol.judged_version + ')');
check(BigInt(pol.payout_atto) === COVERAGE, 'the payout of record is the whole coverage (' + pol.payout_atto + ')');
check(mEnd.investigations === 3, 'three panel rounds ran across the policy\'s life (got ' + mEnd.investigations + ')');
check(mEnd.satisfied === 1, 'one trigger was met (got ' + mEnd.satisfied + ')');
check(mEnd.active === 0, 'no policy is active (got ' + mEnd.active + ')');
check(mEnd.paid === COVERAGE, 'paid_atto is exactly the coverage (' + mEnd.paid + ')');
check(mEnd.escrow === 0n, 'the contract holds nothing (' + mEnd.escrow + ')');
check(mEnd.holder === 0n, 'the policyholder is owed nothing further (' + mEnd.holder + ')');
say('');
say('   0.1 GEN coverage + 0.05 GEN forfeited bond left the contract in one transfer to');
say('   ' + pol.policyholder + '. The insurer appealed a determination it disliked,');
say('   added a source that disagreed, and the majority held: three publishers, two past');
say('   the trigger, one short. The bond paid for the noise.');

finish(0);
