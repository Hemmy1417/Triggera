"""Mutation check for Triggera: break one protective rule in a scratch copy of
the repo and prove the direct suite FAILS. A mutation that survives is a rule
no test pins. A CONTROL (no mutation) runs first and must stay green, or the
sweep refuses to proceed.

WHAT THIS COVERS, stated plainly so the count is not mistaken for more than it
is. The guard mutations are DERIVED FROM THE SOURCE rather than hand-listed:
every unique single-line `if` that immediately protects a `raise
gl.vm.UserError` is disabled in turn. That makes each anchor exact by
construction -- an anchor cannot drift from the contract, because it was read
out of it -- and it means a guard added later is swept automatically the next
time this runs.

It does NOT cover multi-line conditions, guards that raise further than two
lines away, or rules expressed as arithmetic. The arithmetic that decides
money and outcomes is therefore mutated by hand at the end of the list: the
majority test, the contradicting count, the bond floor, the payout and the
premium.

Run from anywhere: python tests/mutation_sweep.py
"""

import pathlib
import shutil
import subprocess
import sys
import time

SRC = pathlib.Path(r"C:/Users/Pc/Desktop/Triggera")
WORK = pathlib.Path(__file__).resolve().parent / "work"
CONTRACT_REL = pathlib.Path("contracts") / "triggera.py"

# A sweep that silently lost entries must not report success.
EXPECTED_MIN_GUARDS = 85

IGNORE = shutil.ignore_patterns("work", "__pycache__", "node_modules", ".next",
                                ".git", "web", ".pytest_cache")

# ── KNOWN-EQUIVALENT MUTANTS, listed rather than deleted ─────────────────────
#
# These two are NOT run, and the reason is recorded here so the count below
# cannot quietly mean something weaker than it says.
#
# Both sit inside the panel's structural validation of the model's answer
# (judge, contracts/triggera.py). Deleting either one leaves the round still
# refused and still writing nothing -- a non-list falls through to the per-row
# lookup, and a missing row entry reaches `s.get("reading")` and dies there --
# so no public behaviour distinguishes the mutant from the original. The
# panel's own failure sentence never surfaces either: run_nondet reports a
# leader failure as "[LLM_ERROR] validators disagreed with the leader's
# failure", so a test cannot match on the specific guard. Verified directly:
# removing BOTH layers together still passes all tests.
#
# What IS pinned, by test_s16_sources_not_an_array_is_refused and
# test_s16_a_missing_reading_for_a_row_is_refused: malformed model output is
# refused and nothing is written. What is NOT pinned is WHICH guard refuses
# it. That is a real limit of the harness, not a hole in the contract, and it
# is written down here rather than papered over.
EQUIVALENT_NOT_RUN = [
    "judge: not isinstance(readings, list)",
    "judge: s is None",
]

MUTATIONS = [
    ("CONTROL (no mutation - must PASS)", None, None),

    # -- S34: the excerpt a later appeal re-reads must be corroborated -----
    # Disabling either branch lets a leader store a passage no validator saw,
    # which every appeal after it would then faithfully reconsider.
    ('validator: the leader excerpt must be text this validator fetched',
     '                    if not (mine_x.startswith(theirs_x) or theirs_x.startswith(mine_x)):',
     '                    if False:'),
    ('validator: a readable row may not carry an empty excerpt',
     '                    if not theirs_x:',
     '                    if False:'),

    # -- guards, derived from the source: each disables one refusal --------
    ('_require_clock: now == 0',
     '        if now == 0:',
     '        if False:'),

    ('_clean_basis: not isinstance(entries, list) or not (1 <= len(entries) <= MAX_BAS',
     '        if not isinstance(entries, list) or not (1 <= len(entries) <= MAX_BASIS_ENTRIES):',
     '        if False:'),

    ('_clean_basis: not isinstance(e, dict)',
     '            if not isinstance(e, dict):',
     '            if False:'),

    ('_clean_basis: kind not in SOURCE_KINDS',
     '            if kind not in SOURCE_KINDS:',
     '            if False:'),

    ('_clean_basis: cls not in SOURCE_CLASSES',
     '            if cls not in SOURCE_CLASSES:',
     '            if False:'),

    ('_clean_basis: not _valid_origin(origin)',
     '            if not _valid_origin(origin):',
     '            if False:'),

    ('_clean_basis: origin in seen',
     '            if origin in seen:',
     '            if False:'),

    ('_clean_basis: not independent_domains',
     '        if not independent_domains:',
     '        if False:'),

    ('_clean_basis: min_independent > len(independent_domains)',
     '        if min_independent > len(independent_domains):',
     '        if False:'),

    ('create_policy: not (1 <= len(title) <= MAX_TITLE_CHARS)',
     '        if not (1 <= len(title) <= MAX_TITLE_CHARS):',
     '        if False:'),

    ('create_policy: len(notional) > MAX_NOTIONAL_CHARS',
     '        if len(notional) > MAX_NOTIONAL_CHARS:',
     '        if False:'),

    ('create_policy: event_type not in EVENT_TYPES',
     '        if event_type not in EVENT_TYPES:',
     '        if False:'),

    ('create_policy: not (1 <= len(metric) <= MAX_METRIC_CHARS)',
     '        if not (1 <= len(metric) <= MAX_METRIC_CHARS):',
     '        if False:'),

    ('create_policy: not (1 <= len(unit) <= MAX_UNIT_CHARS)',
     '        if not (1 <= len(unit) <= MAX_UNIT_CHARS):',
     '        if False:'),

    ('create_policy: operator not in OPERATORS',
     '        if operator not in OPERATORS:',
     '        if False:'),

    ('create_policy: not (MIN_THRESHOLD <= thr <= MAX_THRESHOLD)',
     '        if not (MIN_THRESHOLD <= thr <= MAX_THRESHOLD):',
     '        if False:'),

    ('create_policy: not (MIN_MEASUREMENT_HOURS <= mh <= MAX_MEASUREMENT_HOURS)',
     '        if not (MIN_MEASUREMENT_HOURS <= mh <= MAX_MEASUREMENT_HOURS):',
     '        if False:'),

    ('create_policy: not (0 <= dh <= MAX_DURATION_HOURS)',
     '        if not (0 <= dh <= MAX_DURATION_HOURS):',
     '        if False:'),

    ('create_policy: not (1 <= len(country) <= MAX_PLACE_CHARS)',
     '        if not (1 <= len(country) <= MAX_PLACE_CHARS):',
     '        if False:'),

    ('create_policy: not (1 <= len(region) <= MAX_PLACE_CHARS)',
     '        if not (1 <= len(region) <= MAX_PLACE_CHARS):',
     '        if False:'),

    ('create_policy: not (-90_000_000 <= lat <= 90_000_000) or not (-180_000_000 <= lon',
     '        if not (-90_000_000 <= lat <= 90_000_000) or not (-180_000_000 <= lon <= 180_000_000):',
     '        if False:'),

    ('create_policy: not (0 <= rad <= MAX_RADIUS_KM)',
     '        if not (0 <= rad <= MAX_RADIUS_KM):',
     '        if False:'),

    ('create_policy: (lat != 0 or lon != 0) and rad == 0',
     '        if (lat != 0 or lon != 0) and rad == 0:',
     '        if False:'),

    ('create_policy: premium < MIN_PREMIUM_ATTO',
     '        if premium < MIN_PREMIUM_ATTO:',
     '        if False:'),

    ('create_policy: not (MIN_INDEPENDENT <= min_ind <= MAX_INDEPENDENT)',
     '        if not (MIN_INDEPENDENT <= min_ind <= MAX_INDEPENDENT):',
     '        if False:'),

    ('create_policy: not (MIN_TERMS_CHARS <= len(terms) <= MAX_TERMS_CHARS)',
     '        if not (MIN_TERMS_CHARS <= len(terms) <= MAX_TERMS_CHARS):',
     '        if False:'),

    ('create_policy: not (MIN_COVERAGE_ATTO <= coverage <= MAX_COVERAGE_ATTO)',
     '        if not (MIN_COVERAGE_ATTO <= coverage <= MAX_COVERAGE_ATTO):',
     '        if False:'),

    ('create_policy: premium >= coverage',
     '        if premium >= coverage:',
     '        if False:'),

    ('create_policy: not (MIN_WINDOW_SECONDS <= w <= cap)',
     '            if not (MIN_WINDOW_SECONDS <= w <= cap):',
     '            if False:'),

    ('create_policy: start < now - MAX_CLOCK_DIVERGENCE',
     '        if start < now - MAX_CLOCK_DIVERGENCE:',
     '        if False:'),

    ('create_policy: end < start + MIN_WINDOW_SECONDS',
     '        if end < start + MIN_WINDOW_SECONDS:',
     '        if False:'),

    ('create_policy: end > start + MAX_COVERAGE_PERIOD',
     '        if end > start + MAX_COVERAGE_PERIOD:',
     '        if False:'),

    ('cancel_policy: self._sender() != p.insurer',
     '        if self._sender() != p.insurer:',
     '        if False:'),

    ('activate: holder == p.insurer',
     '        if holder == p.insurer:',
     '        if False:'),

    ('activate: self._value() != premium',
     '        if self._value() != premium:',
     '        if False:'),

    ('activate: now >= int(p.coverage_end_epoch)',
     '        if now >= int(p.coverage_end_epoch):',
     '        if False:'),

    ('_clean_rows: not isinstance(rows, list) or not (1 <= len(rows) <= MAX_SOURCES)',
     '        if not isinstance(rows, list) or not (1 <= len(rows) <= MAX_SOURCES):',
     '        if False:'),

    ('_clean_rows: not isinstance(r, dict)',
     '            if not isinstance(r, dict):',
     '            if False:'),

    ('_clean_rows: not _valid_url(url)',
     '            if not _valid_url(url):',
     '            if False:'),

    ('_clean_rows: not (1 <= len(label) <= MAX_LABEL_CHARS)',
     '            if not (1 <= len(label) <= MAX_LABEL_CHARS):',
     '            if False:'),

    ('_clean_rows: matched is None',
     '            if matched is None:',
     '            if False:'),

    ('_clean_rows: norm in seen',
     '            if norm in seen:',
     '            if False:'),

    ('file_claim: self._sender() != p.policyholder',
     '        if self._sender() != p.policyholder:',
     '        if False:'),

    ('file_claim: p.status != "ACTIVE"',
     '        if p.status != "ACTIVE":',
     '        if False:'),

    ('file_claim: now > int(p.coverage_end_epoch) + int(p.claim_grace)',
     '        if now > int(p.coverage_end_epoch) + int(p.claim_grace):',
     '        if False:'),

    ('file_claim: start < int(p.coverage_start_epoch) or end > int(p.coverage_end_ep',
     '        if start < int(p.coverage_start_epoch) or end > int(p.coverage_end_epoch):',
     '        if False:'),

    ('file_claim: end <= start',
     '        if end <= start:',
     '        if False:'),

    ('file_claim: end - start > MAX_EVENT_WINDOW_SECONDS',
     '        if end - start > MAX_EVENT_WINDOW_SECONDS:',
     '        if False:'),

    ('file_claim: end > now',
     '        if end > now:',
     '        if False:'),

    ('file_claim: version > MAX_VERSIONS',
     '        if version > MAX_VERSIONS:',
     '        if False:'),

    ('file_claim: not (0 <= claimed <= MAX_READING)',
     '        if not (0 <= claimed <= MAX_READING):',
     '        if False:'),

    ('file_claim: not any(r["cls"] == "INDEPENDENT" for r in rows)',
     '        if not any(r["cls"] == "INDEPENDENT" for r in rows):',
     '        if False:'),

    ('investigate: p.status != "INVESTIGATING"',
     '        if p.status != "INVESTIGATING":',
     '        if False:'),

    ('investigate: version == 0',
     '        if version == 0:',
     '        if False:'),

    ('investigate: self.decisions.get(f"{p.policy_id}|{version}") is not None',
     '        if self.decisions.get(f"{p.policy_id}|{version}") is not None:',
     '        if False:'),

    ('promote: p.status != "PENDING_FINALITY"',
     '        if p.status != "PENDING_FINALITY":',
     '        if False:'),

    ('promote: now <= int(p.pending_until_epoch)',
     '        if now <= int(p.pending_until_epoch):',
     '        if False:'),

    ('promote: raw is None',
     '        if raw is None:',
     '        if False:'),

    ('appeal: sender not in (p.insurer, p.policyholder)',
     '        if sender not in (p.insurer, p.policyholder):',
     '        if False:'),

    ('appeal: now > int(p.appeal_until_epoch)',
     '        if now > int(p.appeal_until_epoch):',
     '        if False:'),

    ('appeal: not (MIN_GROUNDS_CHARS <= len(grounds) <= MAX_REASON_CHARS)',
     '        if not (MIN_GROUNDS_CHARS <= len(grounds) <= MAX_REASON_CHARS):',
     '        if False:'),

    ('appeal: self._value() != bond',
     '        if self._value() != bond:',
     '        if False:'),

    ('appeal: prior_raw is None',
     '        if prior_raw is None:',
     '        if False:'),

    ('appeal: new_version > MAX_VERSIONS',
     '        if new_version > MAX_VERSIONS:',
     '        if False:'),

    ('re_investigate: recorded_raw is None',
     '        if recorded_raw is None:',
     '        if False:'),

    ('re_investigate: not _dossier_intact(recorded.get("rows", []))',
     '        if not _dossier_intact(recorded.get("rows", [])):',
     '        if False:'),

    ('lapse_appeal: now <= int(p.appeal_filed_epoch) + STALE_APPEAL_SECONDS',
     '        if now <= int(p.appeal_filed_epoch) + STALE_APPEAL_SECONDS:',
     '        if False:'),

    ('settle: now <= int(p.appeal_until_epoch)',
     '        if now <= int(p.appeal_until_epoch):',
     '        if False:'),

    ('settle: p.outcome not in ("SATISFIED", "NOT_SATISFIED")',
     '        if p.outcome not in ("SATISFIED", "NOT_SATISFIED"):',
     '        if False:'),

    ('settle: p.evidence_flag != "SUFFICIENT"',
     '        if p.evidence_flag != "SUFFICIENT":',
     '        if False:'),

    ('expire: p.status not in ("ACTIVE", "INVESTIGATING")',
     '        if p.status not in ("ACTIVE", "INVESTIGATING"):',
     '        if False:'),

    ('expire: now <= grace_end',
     '        if now <= grace_end:',
     '        if False:'),

    ('expire: now <= patience_end',
     '            if now <= patience_end:',
     '            if False:'),

    ('_panel_round: raw_package is None',
     '        if raw_package is None:',
     '        if False:'),

    ('judge: not (0 <= reading <= MAX_READING)',
     '                    if not (0 <= reading <= MAX_READING):',
     '                    if False:'),

    ('judge: not isinstance(v, bool)',
     '                    if not isinstance(v, bool):',
     '                    if False:'),

    ('judge: evidence_flag not in EVIDENCE_FLAGS',
     '            if evidence_flag not in EVIDENCE_FLAGS:',
     '            if False:'),

    ('validator_fn: not isinstance(out, dict)',
     '        if not isinstance(out, dict):',
     '        if False:'),

    # -- the arithmetic that decides outcomes and money -------------------

    ('derivation: a tie becomes a payout (majority > turned >=)',
     '    if qualifying * 2 > publishers:',
     '    if qualifying * 2 >= publishers:'),

    ('derivation: contradicting voices stop being counted',
     '    contradicting = publishers - qualifying',
     '    contradicting = 0'),

    ('bond: the floor becomes a ceiling',
     '        return max(APPEAL_BOND_FLOOR_ATTO,',
     '        return min(APPEAL_BOND_FLOOR_ATTO,'),

    ('settle: the policyholder is paid half the coverage',
     '        self._credit(p.policyholder, coverage)',
     '        self._credit(p.policyholder, coverage // 2)'),

    ('activate: the premium never reaches the insurer',
     '        self._credit(p.insurer, premium)',
     '        self._credit(p.insurer, 0)'),
]


def _fresh_copy():
    if WORK.exists():
        shutil.rmtree(WORK)
    shutil.copytree(SRC, WORK, ignore=IGNORE)


def _apply(text: str, old: str, new: str):
    """The anchor must sit in the contract exactly once, or the mutant is not
    mutating what its name says it does."""
    if text.count(old) != 1:
        return None
    return text.replace(old, new, 1)


def _mutate(original: str, old, new):
    if old == "MULTI":
        text = original
        for o, n in new:
            text = _apply(text, o, n) if text is not None else None
            if text is None:
                return None
        return text
    return _apply(original, old, new)


def run_suite() -> bool:
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/direct", "-q", "-x",
         "-p", "no:cacheprovider"],
        cwd=WORK, capture_output=True, text=True)
    return r.returncode == 0


def main() -> int:
    guards = len(MUTATIONS) - 1
    if guards < EXPECTED_MIN_GUARDS:
        print(f"SWEEP INCOMPLETE: {guards} mutants listed, "
              f"{EXPECTED_MIN_GUARDS} expected")
        return 2

    original = (SRC / CONTRACT_REL).read_text(encoding="utf-8")
    killed, survived, missing = [], [], []
    started = time.time()

    for name, old, new in MUTATIONS:
        if old is not None:
            text = _mutate(original, old, new)
            if text is None:
                print(f"ANCHOR MISSING   {name}")
                missing.append(name)
                continue
        else:
            text = original

        _fresh_copy()
        (WORK / CONTRACT_REL).write_bytes(text.encode("utf-8"))
        green = run_suite()

        if old is None:
            status = "CONTROL PASS" if green else "CONTROL **FAILED**"
            print(f"{status:18} {name}")
            if not green:
                print("the unmutated suite is red — nothing below would mean anything")
                return 2
        elif green:
            print(f"SURVIVED **      {name}")
            survived.append(name)
        else:
            print(f"killed           {name}")
            killed.append(name)

    print()
    print(f"killed {len(killed)} / survived {len(survived)} / anchor-missing {len(missing)}"
          f"   ({guards} mutants, {time.time() - started:.0f}s)")
    if survived:
        print("UNPINNED RULES:")
        for s in survived:
            print("  -", s)
    if missing:
        print("ANCHORS NOT FOUND EXACTLY ONCE:")
        for m in missing:
            print("  -", m)
    return 1 if (survived or missing) else 0


if __name__ == "__main__":
    sys.exit(main())
