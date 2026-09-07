"""The consensus wall clock: three trace candidates read at their minimum and
refused when they disagree, an execution-layer floor that only ever tightens,
two beacon heads that bound the reading in BOTH directions and fail closed,
and a leader/validator comparison that is integer arithmetic — a failed round
writes nothing and locks nothing."""

import calendar
import json

import pytest

from conftest import (
    COVERAGE, COVER_LEN, INSURER, PREMIUM, STRANGER, W,
    activated, advance, as_, clock_drift, conserve, dead, drafted, err, now,
    policy, skew,
)


def _skew_traces(seconds):
    for host in ("cloudflare.com", "digitalocean.com", "medium.com"):
        skew(host, seconds)


def _beacon_time(module, epoch):
    """What a beacon head reports for a wall-clock instant: genesis plus
    slot*12, rounded down to the slot boundary."""
    g = module.BEACON_GENESIS_EPOCH
    return g + 12 * ((epoch - g) // 12)


def nothing_written(c):
    """A draft refused for want of a clock consumes no id and locks no atto."""
    assert int(c.policy_count) == 0
    assert len(c.policy_ids) == 0
    assert int(c.escrow_atto) == 0
    assert json.loads(c.get_policies_for(INSURER)) == []


# ── the trace candidates ─────────────────────────────────────────────────────

def test_every_trace_source_dead_refuses_a_timed_write(module, c):
    dead("cdn-cgi/trace")
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock is available"):
        drafted(module, c)
    nothing_written(c)
    conserve(module, c)


def test_one_dead_trace_source_is_ignored_while_the_other_two_agree(module, c):
    dead("medium.com")
    assert c._utc_now() == now()
    pid = drafted(module, c)
    assert pid == "trg-000001"
    assert policy(c, pid)["created_epoch"] == now()
    conserve(module, c)


def test_the_clock_is_the_minimum_candidate_never_the_mean_or_the_maximum(module, c):
    """Three live traces spread across the whole tolerance: the reading that
    lands in state is the LEAST forward of them."""
    skew("digitalocean.com", 200)
    skew("medium.com", 300)
    assert c._utc_now() == now()
    created = policy(c, drafted(module, c))["created_epoch"]
    assert created == now()
    assert created != now() + 166 and created != now() + 300


def test_a_backward_skewed_minimum_is_the_reading_the_state_records(module, c):
    """It is the consensus minimum — not any node's wall clock — that is
    written, so a modest common lag moves created_epoch with it."""
    skew("cloudflare.com", -200)
    assert c._utc_now() == now() - 200
    assert policy(c, drafted(module, c))["created_epoch"] == now() - 200


def test_trace_divergence_at_exactly_the_tolerance_is_accepted(module, c):
    skew("medium.com", module.MAX_CLOCK_DIVERGENCE)
    assert c._utc_now() == now()
    assert policy(c, drafted(module, c))["created_epoch"] == now()


def test_trace_divergence_one_second_past_the_tolerance_is_refused(module, c):
    skew("medium.com", module.MAX_CLOCK_DIVERGENCE + 1)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    nothing_written(c)
    conserve(module, c)


def test_an_insane_trace_epoch_is_dropped_like_a_dead_source(module, c):
    """A trace answering an epoch below MIN_SANE_EPOCH is not a candidate, so
    it can neither become the minimum nor manufacture divergence between the
    two healthy ones."""
    skew("medium.com", -(now() - 100))
    assert c._utc_now() == now()
    assert policy(c, drafted(module, c))["created_epoch"] == now()


# ── the execution-layer floor ────────────────────────────────────────────────

def test_a_dead_explorer_fails_open_but_dead_beacons_fail_closed(module, c):
    """The asymmetry is the design: the explorer is corroboration and may go
    missing, the beacon is the bound and may not."""
    dead("blockscout")
    assert c._utc_now() == now()
    assert drafted(module, c) == "trg-000001"

    dead("headers/head")
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    assert int(c.policy_count) == 1 and len(c.policy_ids) == 1
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)


def test_an_explorer_block_ahead_of_the_traces_is_refused(module, c):
    skew("blockscout", 400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    nothing_written(c)
    conserve(module, c)


def test_an_explorer_block_at_exactly_the_tolerance_is_accepted(module, c):
    skew("blockscout", module.MAX_CLOCK_DIVERGENCE)
    assert c._utc_now() == now()
    assert drafted(module, c) == "trg-000001"
    skew("blockscout", module.MAX_CLOCK_DIVERGENCE + 1)
    assert c._utc_now() == 0


def test_a_lagging_explorer_is_tolerated(module, c):
    """The chain floor is one-directional: an indexer 21 minutes behind is
    ordinary and must not freeze the contract."""
    skew("blockscout", -1_250)
    assert c._utc_now() == now()
    assert drafted(module, c) == "trg-000001"


# ── the beacon bound ─────────────────────────────────────────────────────────

def test_one_dead_beacon_head_is_survivable(module, c):
    dead("publicnode.com")
    assert c._utc_now() == now()
    assert drafted(module, c) == "trg-000001"
    conserve(module, c)


def test_divergent_beacon_heads_are_refused(module, c):
    skew("publicnode.com", 400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    nothing_written(c)


def test_an_insane_beacon_head_is_dropped_like_a_dead_one(module, c):
    """A head reporting a slot before MIN_SANE_EPOCH is not a witness, so it
    can neither bound the clock nor manufacture divergence with the other."""
    skew("publicnode.com", -(now() - 100))
    assert c._utc_now() == now()
    assert policy(c, drafted(module, c))["created_epoch"] == now()


def test_a_forward_skewed_wall_clock_hits_the_beacon_ceiling(module, c):
    """S20: a common forward skew of every edge host passes the mutual
    divergence check and clears the floor; only an independent mechanism
    catches it, and closing windows early is exactly what it would buy."""
    _skew_traces(400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    nothing_written(c)


def test_a_backward_skewed_wall_clock_hits_the_beacon_floor_without_the_explorer(module, c):
    """The beacon bounds BOTH directions on its own: with the explorer dead
    (floor 0) a wall clock 400s behind the chain is still refused."""
    dead("blockscout")
    _skew_traces(-400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    nothing_written(c)


def test_the_beacon_ceiling_sits_on_the_slot_boundary(module, c):
    """The beacon reports whole slots, so the ceiling is MAX_CLOCK_DIVERGENCE
    above the slot boundary, not above the wall-clock instant."""
    ceiling = _beacon_time(module, now()) + module.MAX_CLOCK_DIVERGENCE
    _skew_traces(ceiling - now())
    assert c._utc_now() == ceiling
    assert drafted(module, c) == "trg-000001"

    _skew_traces(ceiling - now() + 1)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    assert int(c.policy_count) == 1
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)


# ── leader versus validator ──────────────────────────────────────────────────

def test_validator_drift_within_tolerance_agrees_on_the_leader_reading(module, c):
    clock_drift(0, 200)
    pid = drafted(module, c)
    assert pid == "trg-000001"
    assert policy(c, pid)["created_epoch"] == now()
    conserve(module, c)


@pytest.mark.parametrize("offsets", [(0, 400), (400, 0), (-400, 0)])
def test_validator_drift_beyond_tolerance_fails_the_round_and_writes_nothing(
        module, c, offsets):
    clock_drift(*offsets)
    with pytest.raises(err(module), match=r"^\[LLM_ERROR\]"):
        drafted(module, c)
    nothing_written(c)
    conserve(module, c)


@pytest.mark.parametrize("offsets", [("DEAD", 0), (0, "DEAD")])
def test_a_clock_outage_one_node_sees_is_disagreement_not_a_transient(
        module, c, offsets):
    """A leader without a clock cannot declare the clock down for validators
    that have one — nor the reverse. The round fails and is retried."""
    clock_drift(*offsets)
    with pytest.raises(err(module), match=r"^\[LLM_ERROR\]"):
        drafted(module, c)
    nothing_written(c)


def test_a_clock_outage_every_node_sees_is_transient(module, c):
    clock_drift("DEAD", "DEAD")
    with pytest.raises(err(module), match=r"^\[TRANSIENT\] no consensus clock is available"):
        drafted(module, c)
    nothing_written(c)


# ── the writes that need the clock ───────────────────────────────────────────

def test_create_policy_without_a_clock_locks_nothing_and_recovers(module, c):
    clock_drift("DEAD")
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock is available"):
        drafted(module, c)
    nothing_written(c)
    assert json.loads(c.get_stats())["policies"] == 0
    conserve(module, c)

    clock_drift()
    pid = drafted(module, c)
    assert pid == "trg-000001"
    assert policy(c, pid)["created_epoch"] == now()
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)


def test_expire_without_a_clock_refunds_nothing_and_recovers(module, c):
    pid = activated(module, c)
    advance(COVER_LEN + W + 1)
    before = policy(c, pid)
    escrow_before = int(c.escrow_atto)

    clock_drift("DEAD")
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock is available"):
        c.expire(pid)
    assert policy(c, pid) == before
    assert int(c.escrow_atto) == escrow_before
    assert int(c.get_claimable(INSURER)) == PREMIUM
    assert json.loads(c.get_stats())["active"] == 1
    conserve(module, c)

    clock_drift()
    assert json.loads(c.expire(pid)) == {"refund_atto": str(COVERAGE)}
    p = policy(c, pid)
    assert p["status"] == "EXPIRED" and p["expired_epoch"] == now()
    assert p["refund_atto"] == str(COVERAGE)
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    assert json.loads(c.get_stats())["active"] == 0
    conserve(module, c)


# ── the calendar the floor and the beacon are read through ───────────────────

def test_the_calendar_helpers_match_an_oracle_that_is_not_the_algorithm(module):
    assert module._epoch_from_civil(1970, 1, 1, 0, 0, 0) == 0
    for y in (1972, 1999, 2000, 2024, 2026, 2100, 2400):
        for m in range(1, 13):
            for d in (1, 28):
                expect = calendar.timegm((y, m, d, 23, 59, 59, 0, 0, 0))
                assert module._epoch_from_civil(y, m, d, 23, 59, 59) == expect
    assert module._epoch_from_iso("2026-08-28T11:22:33.000000Z") == 1_787_916_153
    assert module._epoch_from_iso("2026-08-28T11:22:33Z") == 1_787_916_153
    assert module._epoch_from_iso("  2026-08-28T11:22:33.5Z\n") == 1_787_916_153
    assert module._epoch_from_iso("2020-12-01T12:00:23Z") == module.BEACON_GENESIS_EPOCH
