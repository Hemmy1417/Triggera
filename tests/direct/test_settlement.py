"""Settlement and the exits: the settle walls and their boundaries (S24), the
whole coverage moving to the policyholder and nothing to the insurer beyond the
premium it already earned, the permissionless expiry reclaim (S17), the
pull-payment choke point, and the S30 invariants — one payout per policy,
terminal states that stay terminal, and a ledger that reconciles to escrow
after every write."""

import json

import pytest

from conftest import (
    BASIS, BOND, COVERAGE, COVER_LEN, EVENT_LEN, HOLDER, INSURER, PREMIUM,
    STRANGER, TERMS, THRESHOLD, W, activated, advance, answer, as_, claimed,
    conserve, decision, demo_sources, drafted, err, event_window, final,
    investigated, now, panel_says, policy, sent, settled,
)

INSURER2 = "0x3333333333333333333333333333333333333333"
HOLDER2 = "0x4444444444444444444444444444444444444444"

GROUNDS = "the agency bulletin states a gust, not the sustained speed this policy names"

# an odd coverage with no factor in common with anything: whatever the
# arithmetic does, the whole number has to arrive
ODD_COVERAGE = 77_777_777_777_777_777
ODD_PREMIUM = 3_333_333_333_333_333


def stats(c):
    return json.loads(c.get_stats())


def grace_end(c, pid):
    p = policy(c, pid)
    return p["coverage_end_epoch"] + p["claim_grace"]


def to_epoch(t):
    advance(t - now())


def not_satisfied():
    """142, 149 and 161 km/h against a 150 km/h trigger: two of the three
    independent publishers read short, so the trigger was not met."""
    return answer(readings={"EV-001": 142, "EV-002": 149, "EV-003": 161,
                            "EV-004": 153})


def drafted_by(module, c, insurer, coverage=COVERAGE, premium=PREMIUM):
    """The canonical draft for an insurer the conftest helpers do not know."""
    as_(module, insurer, coverage)
    start = now()
    return c.create_policy(
        "StormGuard Property Protection", "USD 100,000", "WIND",
        "maximum sustained wind speed", "km/h", "GTE", THRESHOLD, 24, 0,
        "Philippines", "Eastern Samar", 11_500_000, 125_500_000, 50,
        str(premium), 1, start, start + COVER_LEN, W, W, W, TERMS,
        json.dumps(BASIS))


def held_by(module, c, insurer, holder, coverage=COVERAGE, premium=PREMIUM):
    pid = drafted_by(module, c, insurer, coverage=coverage, premium=premium)
    as_(module, holder, premium)
    c.activate(pid)
    return pid


def file_for(module, c, pid, holder, claimed_reading=157):
    """Let the canonical event window pass, then file its claim."""
    p = policy(c, pid)
    start = p["coverage_start_epoch"]
    end = start + EVENT_LEN
    if now() <= end:
        advance(end - now() + 1)
    as_(module, holder, 0)
    c.file_claim(pid, start, end, claimed_reading, json.dumps(demo_sources()))


def investigate(module, c, pid, ans=None):
    panel_says(ans or answer())
    as_(module, STRANGER, 0)
    return c.investigate(pid)


def frozen(module, c, pid, status, claim_msg):
    """Every write refused in one place: a terminal policy is a record, and a
    record does not move money (S30)."""
    E = err(module)
    as_(module, HOLDER, PREMIUM)
    with pytest.raises(E, match=f"nothing to activate in {status}"):
        c.activate(pid)
    as_(module, HOLDER, 0)
    with pytest.raises(E, match=claim_msg):
        c.file_claim(pid, 0, 1, 157, json.dumps(demo_sources()))
    as_(module, STRANGER, 0)
    with pytest.raises(E, match=f"an investigation runs on a filed claim, not {status}"):
        c.investigate(pid)
    with pytest.raises(E, match="nothing is pending finality"):
        c.promote(pid)
    with pytest.raises(E, match="no appeal is open"):
        c.re_investigate(pid)
    with pytest.raises(E, match="no appeal is open"):
        c.lapse_appeal(pid)
    as_(module, INSURER, BOND)
    with pytest.raises(E, match=f"nothing appealable in {status}"):
        c.appeal(pid, GROUNDS, "", "")
    as_(module, STRANGER, 0)
    with pytest.raises(E, match=f"nothing to settle in {status}"):
        c.settle(pid)
    with pytest.raises(E, match=f"nothing to expire in {status}"):
        c.expire(pid)
    as_(module, INSURER, 0)
    with pytest.raises(E, match=f"this one is {status}"):
        c.cancel_policy(pid)
    assert policy(c, pid)["status"] == status


# ── settle walls ─────────────────────────────────────────────────────────────

def test_settle_refused_before_any_decision_exists(module, c):
    E = err(module)
    draft = drafted(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in DRAFT"):
        c.settle(draft)
    live = activated(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in ACTIVE"):
        c.settle(live)
    filed = claimed(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in INVESTIGATING"):
        c.settle(filed)
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


def test_settle_refused_in_pending_finality_even_after_the_window_lapses(module, c):
    E = err(module)
    pid = investigated(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in PENDING_FINALITY"):
        c.settle(pid)
    # a lapsed finality window is not a decision: only promote() makes state
    advance(10 * W)
    with pytest.raises(E, match="nothing to settle in PENDING_FINALITY"):
        c.settle(pid)
    p = policy(c, pid)
    assert p["outcome"] == "" and p["payout_atto"] == "0"
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


def test_settle_refused_after_an_undetermined_hold_returns_the_policy_to_active(module, c):
    pid = investigated(module, c, ans=answer(evidence="INSUFFICIENT"))
    assert decision(c, pid, 1)["outcome"] == "UNDETERMINED"
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert c.promote(pid) == "undetermined"
    with pytest.raises(err(module), match="nothing to settle in ACTIVE"):
        c.settle(pid)
    p = policy(c, pid)
    assert p["hold_reason"] == "EVIDENCE_INSUFFICIENT" and p["payout_atto"] == "0"
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


def test_settle_refused_while_an_appeal_is_open_however_late(module, c):
    pid = final(module, c)
    as_(module, HOLDER, BOND)
    c.appeal(pid, GROUNDS, "", "")
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="an appeal is open"):
        c.settle(pid)
    # past the appeal window and past the stale window alike
    advance(10 * W)
    with pytest.raises(err(module), match="an appeal is open"):
        c.settle(pid)
    assert policy(c, pid)["status"] == "FINAL"
    assert int(c.escrow_atto) == COVERAGE + PREMIUM + BOND
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


def test_settle_boundary_refuses_now_equal_to_the_appeal_deadline(module, c):
    pid = final(module, c)
    until = policy(c, pid)["appeal_until_epoch"]
    to_epoch(until)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="the appeal window is still open"):
        c.settle(pid)
    assert policy(c, pid)["status"] == "FINAL"
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)
    advance(1)
    out = json.loads(c.settle(pid))
    assert out == {"outcome": "SATISFIED", "payout_atto": str(COVERAGE)}
    p = policy(c, pid)
    assert p["status"] == "PAID" and p["settled_epoch"] == now()
    conserve(module, c)


def test_the_last_instant_of_the_appeal_window_belongs_to_the_appellant(module, c):
    """No gap and no overlap: at the deadline itself an appeal is still
    accepted and settlement is still refused."""
    pid = final(module, c)
    to_epoch(policy(c, pid)["appeal_until_epoch"])
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="the appeal window is still open"):
        c.settle(pid)
    as_(module, INSURER, BOND)
    c.appeal(pid, GROUNDS, "", "")
    assert policy(c, pid)["appeal_open"] is True
    conserve(module, c)


def test_settle_refuses_a_final_whose_outcome_was_forged_in_storage(module, c):
    """White-box: promote() never writes a FINAL that is not conclusive, so
    this depth guard is reachable only by tampering — and it must hold."""
    pid = final(module, c)
    advance(W + 1)
    p = c.policies[pid]
    as_(module, STRANGER, 0)
    for forged in ("UNDETERMINED", "", "PAID_PLEASE"):
        p.outcome = forged
        with pytest.raises(err(module), match="no conclusive decision stands"):
            c.settle(pid)
    assert policy(c, pid)["status"] == "FINAL"
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


def test_settle_refuses_a_final_whose_evidence_flag_was_forged_in_storage(module, c):
    pid = final(module, c)
    advance(W + 1)
    p = c.policies[pid]
    as_(module, STRANGER, 0)
    for forged in ("PARTIAL", "INSUFFICIENT", ""):
        p.evidence_flag = forged
        with pytest.raises(err(module), match="insufficient record cannot settle"):
            c.settle(pid)
    assert policy(c, pid)["status"] == "FINAL"
    assert c.get_claimable(HOLDER) == "0"
    assert int(c.escrow_atto) == COVERAGE + PREMIUM
    conserve(module, c)
    # restored, the same call settles: only the forged field blocked it
    p.evidence_flag = "SUFFICIENT"
    c.settle(pid)
    assert policy(c, pid)["status"] == "PAID"
    conserve(module, c)


def test_dead_clock_refuses_settle_and_writes_nothing(module, c):
    from conftest import clock_drift
    pid = final(module, c)
    advance(W + 1)
    before = policy(c, pid)
    clock_drift("DEAD")
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        c.settle(pid)
    assert policy(c, pid) == before
    assert c.get_claimable(HOLDER) == "0"
    assert sent() == []
    conserve(module, c)
    clock_drift()
    c.settle(pid)
    assert policy(c, pid)["status"] == "PAID"
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    conserve(module, c)


def test_settle_is_permissionless(module, c):
    pid = final(module, c)
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert json.loads(c.settle(pid))["outcome"] == "SATISFIED"
    assert policy(c, pid)["status"] == "PAID"
    assert c.get_claimable(STRANGER) == "0"
    conserve(module, c)


# ── SATISFIED ────────────────────────────────────────────────────────────────

def test_satisfied_credits_exactly_the_coverage_to_the_policyholder(module, c):
    pid = settled(module, c)
    p = policy(c, pid)
    assert p["status"] == "PAID" and p["outcome"] == "SATISFIED"
    assert p["payout_atto"] == str(COVERAGE) and p["refund_atto"] == "0"
    assert p["settled_epoch"] == now()
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    conserve(module, c)


def test_satisfied_pays_the_insurer_nothing_beyond_the_premium_it_earned(module, c):
    pid = settled(module, c)
    assert int(c.get_claimable(INSURER)) == PREMIUM
    assert stats(c)["premiums_atto"] == str(PREMIUM)
    assert policy(c, pid)["refund_atto"] == "0"
    conserve(module, c)


def test_settlement_allocates_and_nothing_has_left_the_contract_yet(module, c):
    settled(module, c)
    assert sent() == []
    assert int(c.escrow_atto) == COVERAGE + PREMIUM
    assert int(c.get_claimable(HOLDER)) + int(c.get_claimable(INSURER)) == \
        COVERAGE + PREMIUM
    conserve(module, c)


def test_satisfied_moves_the_stats_and_retires_the_active_count(module, c):
    settled(module, c)
    s = stats(c)
    assert s["policies"] == 1 and s["active"] == 0
    assert s["investigations"] == 1 and s["satisfied"] == 1
    assert s["paid_atto"] == str(COVERAGE)
    assert s["premiums_atto"] == str(PREMIUM)
    assert s["escrow_atto"] == str(COVERAGE + PREMIUM)
    conserve(module, c)


def test_second_settle_is_refused_and_allocates_nothing_twice(module, c):
    pid = settled(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing to settle in PAID"):
        c.settle(pid)
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    assert stats(c)["paid_atto"] == str(COVERAGE)
    assert stats(c)["satisfied"] == 1
    conserve(module, c)


def test_both_parties_claims_drain_escrow_to_exactly_zero(module, c):
    settled(module, c)
    as_(module, HOLDER, 0)
    c.claim()
    as_(module, INSURER, 0)
    c.claim()
    assert sent() == [(HOLDER, COVERAGE), (INSURER, PREMIUM)]
    assert sum(v for _, v in sent()) == COVERAGE + PREMIUM
    assert int(c.escrow_atto) == 0
    assert c.get_claimable(HOLDER) == "0" and c.get_claimable(INSURER) == "0"
    conserve(module, c)


def test_claim_zeroes_the_ledger_emits_the_transfer_and_refuses_a_second_time(module, c):
    settled(module, c)
    as_(module, HOLDER, 0)
    assert json.loads(c.claim()) == {"claimed_atto": str(COVERAGE)}
    assert sent() == [(HOLDER, COVERAGE)]
    assert c.get_claimable(HOLDER) == "0"
    assert int(c.escrow_atto) == PREMIUM
    conserve(module, c)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    assert sent() == [(HOLDER, COVERAGE)]
    # the insurer's premium is untouched by the policyholder's claim
    assert int(c.get_claimable(INSURER)) == PREMIUM
    conserve(module, c)


def test_claim_refused_with_nothing_on_the_ledger(module, c):
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    settled(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    assert sent() == []
    assert int(c.escrow_atto) == COVERAGE + PREMIUM
    conserve(module, c)


def test_a_stranger_cannot_claim_the_policyholders_balance(module, c):
    settled(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    assert sent() == []
    as_(module, HOLDER, 0)
    c.claim()
    assert sent() == [(HOLDER, COVERAGE)]
    conserve(module, c)


def test_the_coverage_is_paid_whole_with_no_rounding(module, c):
    pid = settled(module, c, coverage=ODD_COVERAGE, premium=ODD_PREMIUM)
    p = policy(c, pid)
    assert p["coverage_atto"] == str(ODD_COVERAGE)
    assert p["payout_atto"] == str(ODD_COVERAGE)
    assert int(c.get_claimable(HOLDER)) == ODD_COVERAGE
    assert int(c.get_claimable(INSURER)) == ODD_PREMIUM
    assert stats(c)["paid_atto"] == str(ODD_COVERAGE)
    for who in (HOLDER, INSURER):
        as_(module, who, 0)
        c.claim()
    assert sent() == [(HOLDER, ODD_COVERAGE), (INSURER, ODD_PREMIUM)]
    assert sum(v for _, v in sent()) == ODD_COVERAGE + ODD_PREMIUM
    assert int(c.escrow_atto) == 0
    conserve(module, c)


# ── NOT_SATISFIED ────────────────────────────────────────────────────────────

def test_not_satisfied_moves_nothing_and_returns_the_policy_to_active(module, c):
    pid = final(module, c, ans=not_satisfied())
    assert policy(c, pid)["outcome"] == "NOT_SATISFIED"
    advance(W + 1)
    as_(module, STRANGER, 0)
    out = json.loads(c.settle(pid))
    assert out == {"outcome": "NOT_SATISFIED", "payout_atto": "0"}
    p = policy(c, pid)
    assert p["status"] == "ACTIVE" and p["payout_atto"] == "0"
    assert p["settled_epoch"] == now()
    assert c.get_claimable(HOLDER) == "0"
    assert int(c.get_claimable(INSURER)) == PREMIUM
    assert int(c.escrow_atto) == COVERAGE + PREMIUM
    assert sent() == []
    conserve(module, c)


def test_not_satisfied_clears_the_final_and_appeal_epochs(module, c):
    pid = final(module, c, ans=not_satisfied())
    p = policy(c, pid)
    assert p["final_epoch"] > 0 and p["appeal_until_epoch"] > 0
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(pid)
    p = policy(c, pid)
    assert p["final_epoch"] == 0 and p["appeal_until_epoch"] == 0
    assert p["appeal_open"] is False
    # nothing is appealable or settleable while the policy is live again
    as_(module, HOLDER, BOND)
    with pytest.raises(err(module), match="nothing appealable in ACTIVE"):
        c.appeal(pid, GROUNDS, "", "")
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing to settle in ACTIVE"):
        c.settle(pid)
    conserve(module, c)


def test_not_satisfied_keeps_the_stats_untouched(module, c):
    pid = final(module, c, ans=not_satisfied())
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(pid)
    s = stats(c)
    assert s["satisfied"] == 0 and s["paid_atto"] == "0"
    assert s["active"] == 1              # the cover is still running
    assert s["escrow_atto"] == str(COVERAGE + PREMIUM)
    conserve(module, c)


def test_after_not_satisfied_the_policyholder_files_a_new_window_and_is_judged_again(module, c):
    pid = final(module, c, ans=not_satisfied())
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(pid)
    start = policy(c, pid)["coverage_start_epoch"]
    # a DIFFERENT event window inside the same coverage period
    second = (start + EVENT_LEN, start + 2 * EVENT_LEN)
    as_(module, HOLDER, 0)
    out = json.loads(c.file_claim(pid, second[0], second[1], 161,
                                  json.dumps(demo_sources())))
    assert out["version"] == 2
    p = policy(c, pid)
    assert p["status"] == "INVESTIGATING" and p["evidence_version"] == 2
    assert (p["event_start_epoch"], p["event_end_epoch"]) == second
    investigate(module, c, pid)
    d = decision(c, pid, 2)
    assert d["outcome"] == "SATISFIED" and d["evidence_version"] == 2
    assert d["event_start_epoch"] == second[0]
    assert decision(c, pid, 1)["outcome"] == "NOT_SATISFIED"   # the first record stands
    conserve(module, c)


def test_a_second_satisfied_pays_the_coverage_exactly_once(module, c):
    pid = final(module, c, ans=not_satisfied())
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(pid)
    start = policy(c, pid)["coverage_start_epoch"]
    as_(module, HOLDER, 0)
    c.file_claim(pid, start + EVENT_LEN, start + 2 * EVENT_LEN, 161,
                 json.dumps(demo_sources()))
    investigate(module, c, pid)
    advance(W + 1)
    c.promote(pid)
    advance(W + 1)
    assert json.loads(c.settle(pid))["payout_atto"] == str(COVERAGE)
    p = policy(c, pid)
    assert p["status"] == "PAID" and p["judged_version"] == 2
    assert int(c.get_claimable(HOLDER)) == COVERAGE     # once, not twice
    s = stats(c)
    assert s["satisfied"] == 1 and s["paid_atto"] == str(COVERAGE)
    assert s["investigations"] == 2 and s["active"] == 0
    conserve(module, c)


def test_a_paid_policy_refuses_a_further_claim_settlement_and_appeal(module, c):
    E = err(module)
    pid = settled(module, c)
    start = policy(c, pid)["coverage_start_epoch"]
    as_(module, HOLDER, 0)
    with pytest.raises(E, match="this one is PAID"):
        c.file_claim(pid, start, start + EVENT_LEN, 157, json.dumps(demo_sources()))
    as_(module, HOLDER, BOND)
    with pytest.raises(E, match="nothing appealable in PAID"):
        c.appeal(pid, GROUNDS, "", "")
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in PAID"):
        c.settle(pid)
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    assert policy(c, pid)["evidence_version"] == 1
    conserve(module, c)


def test_not_satisfied_then_expiry_returns_the_coverage_to_the_insurer(module, c):
    pid = final(module, c, ans=not_satisfied())
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(pid)
    to_epoch(grace_end(c, pid) + 1)
    assert json.loads(c.expire(pid)) == {"refund_atto": str(COVERAGE)}
    p = policy(c, pid)
    assert p["status"] == "EXPIRED" and p["refund_atto"] == str(COVERAGE)
    assert p["payout_atto"] == "0"
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


# ── expire ───────────────────────────────────────────────────────────────────

def test_expire_refused_before_the_policy_is_live(module, c):
    pid = drafted(module, c)
    to_epoch(grace_end(c, pid) + 1)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing to expire in DRAFT"):
        c.expire(pid)
    assert policy(c, pid)["status"] == "DRAFT"
    assert c.get_claimable(INSURER) == "0"
    conserve(module, c)


def test_expire_refused_while_a_decision_is_pending_or_final(module, c):
    E = err(module)
    pending = investigated(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to expire in PENDING_FINALITY"):
        c.expire(pending)
    decided = final(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to expire in FINAL"):
        c.expire(decided)
    # the grace passing does not open the exit on a decided policy
    to_epoch(grace_end(c, decided) + 1)
    with pytest.raises(E, match="nothing to expire in FINAL"):
        c.expire(decided)
    with pytest.raises(E, match="nothing to expire in PENDING_FINALITY"):
        c.expire(pending)
    assert c.get_claimable(INSURER) == str(2 * PREMIUM)
    conserve(module, c)


def test_expire_refuses_while_an_appeal_is_open(module, c):
    """White-box: an appeal is only ever open on a FINAL policy, which expire
    turns away on status alone — so the guard behind it is reached only by
    tampering, and it must still hold."""
    pid = final(module, c)
    as_(module, HOLDER, BOND)
    c.appeal(pid, GROUNDS, "", "")
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing to expire in FINAL"):
        c.expire(pid)
    c.policies[pid].status = "ACTIVE"
    to_epoch(grace_end(c, pid) + 1)
    with pytest.raises(err(module), match="resolve the open appeal first"):
        c.expire(pid)
    assert policy(c, pid)["status"] == "ACTIVE"
    assert c.get_claimable(INSURER) == str(PREMIUM)
    assert int(c.escrow_atto) == COVERAGE + PREMIUM + BOND
    conserve(module, c)


def test_expire_waits_for_the_grace_boundary_inclusive(module, c):
    pid = activated(module, c)
    ge = grace_end(c, pid)
    to_epoch(ge)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=f"the claim grace runs until {ge}"):
        c.expire(pid)
    assert policy(c, pid)["status"] == "ACTIVE"
    assert c.get_claimable(INSURER) == str(PREMIUM)
    conserve(module, c)
    advance(1)
    assert json.loads(c.expire(pid)) == {"refund_atto": str(COVERAGE)}
    conserve(module, c)


def test_expire_of_an_active_policy_that_never_had_a_claim(module, c):
    pid = activated(module, c)
    to_epoch(grace_end(c, pid) + 1)
    as_(module, STRANGER, 0)
    c.expire(pid)
    p = policy(c, pid)
    assert p["status"] == "EXPIRED" and p["expired_epoch"] == now()
    assert p["refund_atto"] == str(COVERAGE) and p["payout_atto"] == "0"
    assert p["evidence_version"] == 0 and p["outcome"] == ""
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    assert c.get_claimable(HOLDER) == "0"
    s = stats(c)
    assert s["active"] == 0 and s["satisfied"] == 0 and s["paid_atto"] == "0"
    conserve(module, c)
    as_(module, INSURER, 0)
    c.claim()
    assert sent() == [(INSURER, COVERAGE + PREMIUM)]
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_expire_after_an_undetermined_hold(module, c):
    pid = investigated(module, c, ans=answer(evidence="PARTIAL"))
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert c.promote(pid) == "undetermined"
    to_epoch(grace_end(c, pid) + 1)
    # the hold judged the version it held, so no patience window is owed
    assert json.loads(c.expire(pid)) == {"refund_atto": str(COVERAGE)}
    p = policy(c, pid)
    assert p["status"] == "EXPIRED" and p["hold_reason"] == "EVIDENCE_INSUFFICIENT"
    assert p["judged_version"] == p["evidence_version"] == 1
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    conserve(module, c)


def test_expire_waits_for_an_uninvestigated_claim_to_have_its_finality_window(module, c):
    pid = activated(module, c)
    p = policy(c, pid)
    start = p["coverage_start_epoch"]
    # a claim filed late in the grace earns a full finality window before the
    # insurer may pull the coverage out from under it
    to_epoch(p["coverage_end_epoch"] + 300)
    as_(module, HOLDER, 0)
    c.file_claim(pid, start, start + EVENT_LEN, 157, json.dumps(demo_sources()))
    patience_end = now() + W
    ge = grace_end(c, pid)
    assert patience_end > ge
    to_epoch(ge + 1)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module),
                       match=f"an uninvestigated claim is on the record.*expire after {patience_end}"):
        c.expire(pid)
    to_epoch(patience_end)
    with pytest.raises(err(module), match="an uninvestigated claim is on the record"):
        c.expire(pid)
    assert policy(c, pid)["status"] == "INVESTIGATING"
    assert c.get_claimable(INSURER) == str(PREMIUM)
    conserve(module, c)
    advance(1)
    assert json.loads(c.expire(pid)) == {"refund_atto": str(COVERAGE)}
    p = policy(c, pid)
    assert p["status"] == "EXPIRED" and p["evidence_version"] == 1
    assert p["judged_version"] == 0
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    conserve(module, c)


def test_expire_after_a_not_satisfied_settlement_and_a_late_refile_waits_again(module, c):
    pid = final(module, c, ans=not_satisfied())
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(pid)
    p = policy(c, pid)
    start = p["coverage_start_epoch"]
    to_epoch(p["coverage_end_epoch"] + 300)
    as_(module, HOLDER, 0)
    c.file_claim(pid, start + EVENT_LEN, start + 2 * EVENT_LEN, 161,
                 json.dumps(demo_sources()))
    patience_end = now() + W
    to_epoch(grace_end(c, pid) + 1)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=f"expire after {patience_end}"):
        c.expire(pid)
    to_epoch(patience_end + 1)
    c.expire(pid)
    assert policy(c, pid)["status"] == "EXPIRED"
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    conserve(module, c)


def test_expire_is_permissionless_and_credits_only_the_insurer(module, c):
    pid = activated(module, c)
    to_epoch(grace_end(c, pid) + 1)
    for who in (HOLDER, STRANGER):
        as_(module, who, 0)
        c.expire(pid) if False else None
    as_(module, STRANGER, 0)
    c.expire(pid)
    assert policy(c, pid)["status"] == "EXPIRED"
    assert c.get_claimable(STRANGER) == "0" and c.get_claimable(HOLDER) == "0"
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    conserve(module, c)


def test_double_expire_is_refused_and_refunds_nothing_twice(module, c):
    pid = activated(module, c)
    to_epoch(grace_end(c, pid) + 1)
    as_(module, STRANGER, 0)
    c.expire(pid)
    with pytest.raises(err(module), match="nothing to expire in EXPIRED"):
        c.expire(pid)
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    assert stats(c)["active"] == 0
    conserve(module, c)


# ── S30 invariants ───────────────────────────────────────────────────────────

def test_two_policies_settle_independently_with_their_own_ledgers(module, c):
    a = held_by(module, c, INSURER, HOLDER)
    b = held_by(module, c, INSURER2, HOLDER2)
    assert int(c.escrow_atto) == 2 * (COVERAGE + PREMIUM)
    conserve(module, c)

    file_for(module, c, a, HOLDER)
    investigate(module, c, a, answer())
    file_for(module, c, b, HOLDER2)
    investigate(module, c, b, not_satisfied())
    conserve(module, c)

    advance(W + 1)
    as_(module, STRANGER, 0)
    c.promote(a)
    c.promote(b)
    advance(W + 1)
    c.settle(a)
    conserve(module, c)
    assert c.get_claimable(HOLDER2) == "0"      # B's holder untouched by A
    assert c.get_claimable(INSURER2) == str(PREMIUM)
    c.settle(b)
    conserve(module, c)

    pa, pb = policy(c, a), policy(c, b)
    assert pa["status"] == "PAID" and pa["payout_atto"] == str(COVERAGE)
    assert pb["status"] == "ACTIVE" and pb["payout_atto"] == "0"
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    assert c.get_claimable(HOLDER2) == "0"
    assert int(c.get_claimable(INSURER)) == PREMIUM
    assert int(c.get_claimable(INSURER2)) == PREMIUM
    s = stats(c)
    assert s["policies"] == 2 and s["satisfied"] == 1 and s["active"] == 1
    assert s["paid_atto"] == str(COVERAGE)

    for who in (HOLDER, INSURER, INSURER2):
        as_(module, who, 0)
        c.claim()
    # what remains is exactly B's coverage, still locked
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)
    to_epoch(grace_end(c, b) + 1)
    as_(module, STRANGER, 0)
    c.expire(b)
    assert int(c.get_claimable(INSURER2)) == COVERAGE
    as_(module, INSURER2, 0)
    c.claim()
    assert int(c.escrow_atto) == 0
    assert sum(v for _, v in sent()) == 2 * (COVERAGE + PREMIUM)
    conserve(module, c)


def test_settling_one_policy_never_reaches_another_insurers_coverage(module, c):
    idle = held_by(module, c, INSURER2, HOLDER2)      # never claimed on
    paid = settled(module, c)
    assert policy(c, idle)["status"] == "ACTIVE"
    assert policy(c, idle)["payout_atto"] == "0"
    assert c.get_claimable(HOLDER2) == "0"
    assert int(c.get_claimable(INSURER2)) == PREMIUM
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    assert int(c.escrow_atto) == 2 * (COVERAGE + PREMIUM)
    for who in (HOLDER, INSURER, INSURER2):
        as_(module, who, 0)
        c.claim()
    assert int(c.escrow_atto) == COVERAGE            # idle's deposit alone
    assert policy(c, paid)["status"] == "PAID"
    conserve(module, c)


def test_post_terminal_actions_on_a_paid_policy_are_all_refused(module, c):
    pid = settled(module, c)
    frozen(module, c, pid, "PAID", "this one is PAID")
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    assert int(c.get_claimable(INSURER)) == PREMIUM
    assert int(c.escrow_atto) == COVERAGE + PREMIUM
    conserve(module, c)


def test_post_terminal_actions_on_an_expired_policy_are_all_refused(module, c):
    pid = activated(module, c)
    to_epoch(grace_end(c, pid) + 1)
    as_(module, STRANGER, 0)
    c.expire(pid)
    frozen(module, c, pid, "EXPIRED", "this one is EXPIRED")
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


def test_post_terminal_actions_on_a_cancelled_policy_are_all_refused(module, c):
    pid = drafted(module, c)
    as_(module, INSURER, 0)
    c.cancel_policy(pid)
    # a cancelled draft has no policyholder, so the claim wall is the identity
    # one — nobody at all can file on it
    frozen(module, c, pid, "CANCELLED", "only the policyholder files a claim")
    assert int(c.get_claimable(INSURER)) == COVERAGE
    assert c.get_claimable(HOLDER) == "0"
    conserve(module, c)


def test_a_terminal_policy_still_lets_the_ledger_drain(module, c):
    """The one thing a terminal state leaves open: what was already allocated
    is still the party's to pull."""
    paid = settled(module, c)
    other = activated(module, c)
    to_epoch(grace_end(c, other) + 1)
    as_(module, STRANGER, 0)
    c.expire(other)
    as_(module, INSURER, 0)
    c.claim()
    assert sent() == [(INSURER, COVERAGE + 2 * PREMIUM)]
    as_(module, HOLDER, 0)
    c.claim()
    assert int(c.escrow_atto) == 0
    assert [policy(c, p)["status"] for p in (paid, other)] == ["PAID", "EXPIRED"]
    conserve(module, c)


def test_stats_and_the_ledger_reconcile_at_every_step_of_a_full_arc(module, c):
    zero = {"policies": 0, "active": 0, "investigations": 0, "satisfied": 0,
            "paid_atto": "0", "premiums_atto": "0", "escrow_atto": "0"}
    assert stats(c) == zero
    pid = drafted(module, c)
    assert stats(c) == {**zero, "policies": 1, "escrow_atto": str(COVERAGE)}
    conserve(module, c)
    as_(module, HOLDER, PREMIUM)
    c.activate(pid)
    live = {**zero, "policies": 1, "active": 1,
            "premiums_atto": str(PREMIUM),
            "escrow_atto": str(COVERAGE + PREMIUM)}
    assert stats(c) == live
    conserve(module, c)
    file_for(module, c, pid, HOLDER)
    assert stats(c) == live                       # a filed claim moves no money
    conserve(module, c)
    investigate(module, c, pid)
    assert stats(c) == {**live, "investigations": 1}
    conserve(module, c)
    advance(W + 1)
    c.promote(pid)
    assert stats(c) == {**live, "investigations": 1}
    conserve(module, c)
    advance(W + 1)
    c.settle(pid)
    paid = {**live, "investigations": 1, "active": 0, "satisfied": 1,
            "paid_atto": str(COVERAGE)}
    assert stats(c) == paid
    conserve(module, c)
    as_(module, HOLDER, 0)
    c.claim()
    assert stats(c)["escrow_atto"] == str(PREMIUM)
    conserve(module, c)
    as_(module, INSURER, 0)
    c.claim()
    assert stats(c) == {**paid, "escrow_atto": "0"}
    conserve(module, c)


def test_escrow_tracks_deposits_minus_claims_exactly_across_an_appeal(module, c):
    deposits = 0

    def check():
        assert int(c.escrow_atto) == deposits - sum(v for _, v in sent())
        conserve(module, c)

    pid = activated(module, c)
    deposits += COVERAGE + PREMIUM
    check()
    file_for(module, c, pid, HOLDER)
    check()
    investigate(module, c, pid)
    check()
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.promote(pid)
    check()
    as_(module, INSURER, BOND)
    c.appeal(pid, GROUNDS, "", "")
    deposits += BOND
    check()                                  # the bond is undecided, nobody's yet
    panel_says(answer())                     # the same readings: the appeal fails
    as_(module, STRANGER, 0)
    out = json.loads(c.re_investigate(pid))
    assert out["bond_returned"] is False
    assert int(c.get_claimable(HOLDER)) == BOND
    check()                                  # the bond moved to the ledger
    advance(W + 1)
    c.promote(pid)
    check()
    advance(W + 1)
    c.settle(pid)
    assert int(c.get_claimable(HOLDER)) == BOND + COVERAGE
    assert int(c.get_claimable(INSURER)) == PREMIUM
    check()
    as_(module, HOLDER, 0)
    c.claim()
    check()
    as_(module, INSURER, 0)
    c.claim()
    check()
    assert int(c.escrow_atto) == 0
    assert sent() == [(HOLDER, BOND + COVERAGE), (INSURER, PREMIUM)]
    assert sum(v for _, v in sent()) == deposits
