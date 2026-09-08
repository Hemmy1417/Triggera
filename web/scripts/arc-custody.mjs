/* Live Acts 1-2 against the deployed Triggera: a draft takes its FULL
   coverage into custody, and cancelling gives it back through the ledger. */
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { readFileSync, writeFileSync } from 'node:fs';

const RPC = 'https://studio-next.genlayer.com/api';
const ADDR = '0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42';
const FEE_FLOOR = 10n ** 15n;
const chain = { ...studioDevnet, id: 61997, name: 'Studio Next', rpcUrls: { default: { http: [RPC] } } };
const keys = JSON.parse(readFileSync('.data/keys.json', 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); };

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

const reader = createClient({ chain });
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

function payload(t) {
  const arr = t?.consensus_data?.leader_receipt ?? [];
  const leader = arr.find((x) => x?.mode !== 'validator') ?? arr[0];
  let p = leader?.result?.payload ?? leader?.genvm_result?.stdout ?? '';
  if (Array.isArray(p)) { try { p = Buffer.from(p).toString('utf-8'); } catch { /* keep */ } }
  if (typeof p === 'object' && p) { try { p = JSON.stringify(p); } catch { /* keep */ } }
  return { exec: leader?.execution_result, text: String(p ?? '') };
}

async function waitFinal(hash, label) {
  for (let i = 0; i < 120; i++) {
    await sleep(4000);
    let t;
    try { t = (await rpc('eth_getTransactionByHash', [hash])).result; } catch { continue; }
    const st = t?.status ?? t?.statusName;
    if (st === 'FINALIZED') {
      const { exec, text } = payload(t);
      say('   ' + label + ': FINALIZED ' + t.result_name + ' leader=' + exec);
      return { ok: exec === 'SUCCESS', text, tx: t };
    }
    if (st === 'CANCELED' || st === 'UNDETERMINED') { say('   ' + label + ': ' + st); return { ok: false, text: st, tx: t }; }
    if (i % 8 === 7) say('   ' + label + ': ... ' + (st ?? 'pending'));
  }
  throw new Error(label + ': never finalized');
}

async function write(role, fn, args, valueAtto = 0n) {
  const account = createAccount(keys[role].pk);
  const client = createClient({ chain, account });
  const est = await client.estimateTransactionFeesForWrite({ address: ADDR, functionName: fn, args, value: valueAtto });
  const feeValue = BigInt(est.feeValue) < FEE_FLOOR ? FEE_FLOOR : BigInt(est.feeValue);
  const fees = { distribution: est.distribution, feeValue, messageAllocations: est.messageAllocations };
  const res = await client.writeContract({ address: ADDR, functionName: fn, args, value: valueAtto, fees });
  const hash = typeof res === 'string' ? res : (res?.transactionHash ?? res?.hash ?? '');
  say('   ' + fn + ' tx ' + hash);
  return Object.assign({ hash }, await waitFinal(hash, fn));
}

const fails = [];
const check = (cond, what) => { say('   ' + (cond ? 'ok  ' : 'FAIL') + ' ' + what); if (!cond) fails.push(what); };

const now = Math.floor(Date.now() / 1000);
const COVERAGE = 20000000000000000n;
const PREMIUM = 2000000000000000n;
const basis = JSON.stringify([
  { kind: 'METEOROLOGICAL_AGENCY', origin: 'raw.githubusercontent.com', class: 'INDEPENDENT' },
  { kind: 'STATION_LOG', origin: 'raw.githack.com', class: 'PARTY' },
]);
const terms = 'ARC PROBE POLICY. Parametric wind cover written by the live arc to prove that a draft takes its full coverage into custody at acceptance and that cancelling returns it through the pull ledger. TRIGGER: maximum sustained wind speed at or above 150 km/h over any 24-hour window inside the claimed event window. No damage assessment is made.';

say('ACT 1 - a draft takes its FULL coverage into custody');
const before = await view('get_stats');
say('   escrow before ' + before.escrow_atto);

const created = await write('CREATOR', 'create_policy', [
  'Arc probe - custody at acceptance', 'USD 1', 'WIND',
  'maximum sustained wind speed', 'km/h', 'GTE', 150, 24, 0,
  'Philippines', 'Eastern Samar', 11500000, 125500000, 50,
  PREMIUM.toString(), 1, now + 60, now + 60 + 3600, 900, 900, 900,
  terms, basis,
], COVERAGE);
check(created.ok, 'create_policy landed SUCCESS');
if (!created.ok) say('   revert: ' + created.text.slice(0, 500));

const afterCreate = await view('get_stats');
const pid = 'trg-' + String(afterCreate.policies).padStart(6, '0');
say('   new policy ' + pid);
const pol = await view('get_policy', [pid]);
check(pol?.status === 'DRAFT', 'status is DRAFT (got ' + pol?.status + ')');
check(pol?.coverage_atto === COVERAGE.toString(), 'coverage recorded as ' + COVERAGE);
check(
  BigInt(afterCreate.escrow_atto) - BigInt(before.escrow_atto) === COVERAGE,
  'custody rose by exactly the coverage (' + (BigInt(afterCreate.escrow_atto) - BigInt(before.escrow_atto)) + ')',
);

say('');
say('ACT 2 - the insurer withdraws the draft; the coverage comes back through the ledger');
const claimableBefore = BigInt((await rawView('get_claimable', [keys.CREATOR.addr])) || '0');
const cancelled = await write('CREATOR', 'cancel_policy', [pid]);
check(cancelled.ok, 'cancel_policy landed SUCCESS');
if (!cancelled.ok) say('   revert: ' + cancelled.text.slice(0, 500));

const afterCancel = await view('get_stats');
const pol2 = await view('get_policy', [pid]);
const claimableAfter = BigInt((await rawView('get_claimable', [keys.CREATOR.addr])) || '0');
check(pol2?.status === 'CANCELLED', 'status is CANCELLED (got ' + pol2?.status + ')');
check(
  BigInt(afterCancel.escrow_atto) === BigInt(before.escrow_atto),
  'custody is back where it started (' + afterCancel.escrow_atto + ' vs ' + before.escrow_atto + ')',
);
check(
  claimableAfter - claimableBefore === COVERAGE,
  'the coverage is owed on the ledger, not sent (' + (claimableAfter - claimableBefore) + ')',
);

say('');
say('ACT 2b - the insurer pulls what the ledger owes');
const balBefore = BigInt((await rpc('eth_getBalance', [keys.CREATOR.addr, 'latest'])).result ?? '0x0');
const claimed = await write('CREATOR', 'claim', []);
check(claimed.ok, 'claim landed SUCCESS');
if (!claimed.ok) say('   revert: ' + claimed.text.slice(0, 500));
const claimableEnd = BigInt((await rawView('get_claimable', [keys.CREATOR.addr])) || '0');
const balAfter = BigInt((await rpc('eth_getBalance', [keys.CREATOR.addr, 'latest'])).result ?? '0x0');
check(claimableEnd === 0n, 'the ledger is now clear (' + claimableEnd + ')');
say('   wallet ' + balBefore + ' -> ' + balAfter + ' (delta ' + (balAfter - balBefore) + ', fees deducted)');

say('');
say(fails.length === 0 ? 'ALL CHECKS PASSED' : 'FAILED: ' + fails.length + ' - ' + fails.join('; '));
writeFileSync('arc.act12.transcript.json', JSON.stringify({ pid, log, fails }, null, 1));
process.exit(fails.length === 0 ? 0 : 1);
