"""The spine, end to end, before anything else is written against it."""

import json

import pytest

from conftest import (
    BOND, COVERAGE, HOLDER, INSURER, PREMIUM, STRANGER, W,
    activated, advance, answer, as_, claimed, conserve, decision, demo_sources,
    drafted, err, event_window, final, investigated, now, panel_says, policy,
    sent, settled,
)


def test_the_full_satisfied_lifecycle_pays_the_whole_coverage(module, c):
    pid = drafted(module, c)
    p = policy(c, pid)
    assert p["status"] == "DRAFT" and p["policy_id"] == "trg-000001"
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)

    as_(module, HOLDER, PREMIUM)
    c.activate(pid)
    p = policy(c, pid)
    assert p["status"] == "ACTIVE" and p["policyholder"] == HOLDER
    assert int(c.get_claimable(INSURER)) == PREMIUM      # premium earned at once
    conserve(module, c)

    start, end = event_window(c, pid)
    advance(end - now() + 1)
    as_(module, HOLDER, 0)
    c.file_claim(pid, start, end, 157, json.dumps(demo_sources()))
    p = policy(c, pid)
    assert p["status"] == "INVESTIGATING" and p["evidence_version"] == 1
    conserve(module, c)

    panel_says(answer())
    as_(module, STRANGER, 0)
    out = json.loads(c.investigate(pid))
    assert out["outcome"] == "SATISFIED"
    d = decision(c, pid, 1)
    assert (d["publishers"], d["qualifying"], d["contradicting"]) == (3, 2, 1)
    assert d["outcome"] == "SATISFIED" and d["hold_reason"] == ""
    assert "at or above 150 km/h" in d["question"]
    assert policy(c, pid)["status"] == "PENDING_FINALITY"
    conserve(module, c)

    advance(W + 1)
    c.promote(pid)
    p = policy(c, pid)
    assert p["status"] == "FINAL" and p["outcome"] == "SATISFIED"
    assert (p["publishers"], p["qualifying"], p["contradicting"]) == (3, 2, 1)

    advance(W + 1)
    out = json.loads(c.settle(pid))
    assert out == {"outcome": "SATISFIED", "payout_atto": str(COVERAGE)}
    p = policy(c, pid)
    assert p["status"] == "PAID" and p["payout_atto"] == str(COVERAGE)
    assert int(c.get_claimable(HOLDER)) == COVERAGE
    conserve(module, c)

    as_(module, HOLDER, 0)
    c.claim()
    as_(module, INSURER, 0)
    c.claim()
    assert sent() == [(HOLDER, COVERAGE), (INSURER, PREMIUM)]
    assert int(c.escrow_atto) == 0
    stats = json.loads(c.get_stats())
    assert stats["satisfied"] == 1 and stats["paid_atto"] == str(COVERAGE)
    assert stats["premiums_atto"] == str(PREMIUM) and stats["active"] == 0
    conserve(module, c)


def test_not_satisfied_moves_nothing_and_keeps_the_policy_active(module, c):
    pid = final(module, c, ans=answer(
        readings={"EV-001": 142, "EV-002": 149, "EV-003": 161, "EV-004": 153}))
    p = policy(c, pid)
    assert p["status"] == "FINAL" and p["outcome"] == "NOT_SATISFIED"
    assert (p["publishers"], p["qualifying"], p["contradicting"]) == (3, 1, 2)
    advance(W + 1)
    as_(module, STRANGER, 0)
    out = json.loads(c.settle(pid))
    assert out == {"outcome": "NOT_SATISFIED", "payout_atto": "0"}
    p = policy(c, pid)
    assert p["status"] == "ACTIVE" and p["payout_atto"] == "0"
    assert int(c.get_claimable(HOLDER)) == 0
    conserve(module, c)


def test_an_insufficient_record_holds_and_the_insurer_expires_after_grace(module, c):
    pid = investigated(module, c, ans=answer(evidence="PARTIAL"))
    d = decision(c, pid, 1)
    assert d["outcome"] == "UNDETERMINED" and d["hold_reason"] == "EVIDENCE_INSUFFICIENT"
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert c.promote(pid) == "undetermined"
    p = policy(c, pid)
    assert p["status"] == "ACTIVE" and p["hold_reason"] == "EVIDENCE_INSUFFICIENT"
    conserve(module, c)

    with pytest.raises(err(module), match=r"claim grace runs until"):
        c.expire(pid)
    advance(p["coverage_end_epoch"] + p["claim_grace"] - now() + 1)
    out = json.loads(c.expire(pid))
    assert out == {"refund_atto": str(COVERAGE)}
    assert policy(c, pid)["status"] == "EXPIRED"
    assert int(c.get_claimable(INSURER)) == COVERAGE + PREMIUM
    conserve(module, c)


def test_a_split_among_publishers_is_undetermined(module, c):
    basis = [
        {"kind": "METEOROLOGICAL_AGENCY", "origin": "agency.example.org", "class": "INDEPENDENT"},
        {"kind": "WEATHER_PROVIDER", "origin": "weather.example.net", "class": "INDEPENDENT"},
    ]
    from conftest import AGENCY_URL, PROVIDER_URL, source
    pid = investigated(module, c, basis=basis,
                       sources=[source(AGENCY_URL, "a"), source(PROVIDER_URL, "b")],
                       ans=answer(readings={"EV-001": 157, "EV-002": 149}))
    d = decision(c, pid, 1)
    assert d["outcome"] == "UNDETERMINED" and d["hold_reason"] == "SPLIT_EVIDENCE"
    assert (d["publishers"], d["qualifying"], d["contradicting"]) == (2, 1, 1)


def test_derivation_never_averages_and_one_publisher_speaks_once(module):
    rows = [
        {"cls": "INDEPENDENT", "host": "a.agency.example.org", "readable": True,
         "window_ok": True, "geo_ok": True, "kind_matches": True, "reading": 300},
        {"cls": "INDEPENDENT", "host": "b.agency.example.org", "readable": True,
         "window_ok": True, "geo_ok": True, "kind_matches": True, "reading": 100},
        {"cls": "INDEPENDENT", "host": "weather.example.net", "readable": True,
         "window_ok": True, "geo_ok": True, "kind_matches": True, "reading": 140},
        {"cls": "PARTY", "host": "station.example.com", "readable": True,
         "window_ok": True, "geo_ok": True, "kind_matches": True, "reading": 999},
    ]
    # An average of the independent readings (180) would pass 150; the
    # per-publisher rule reads agency.example.org ONCE, at its least
    # favourable page (100), so both publishers fall short.
    out = module._derive_outcome("GTE", 150, 1, "SUFFICIENT", rows)
    assert out == ("NOT_SATISFIED", "", 2, 0, 2)
    # Fewer publishers than required holds, whatever the numbers say.
    out = module._derive_outcome("GTE", 150, 3, "SUFFICIENT", rows)
    assert out == ("UNDETERMINED", "UNCORROBORATED", 2, 0, 0)
    # A <= trigger reads the least favourable page as the HIGHEST.
    out = module._derive_outcome("LTE", 120, 1, "SUFFICIENT", rows[:3])
    assert out == ("NOT_SATISFIED", "", 2, 0, 2)


def test_walls_hold(module, c):
    pid = activated(module, c)
    start, end = event_window(c, pid)
    advance(end - now() + 1)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=r"only the policyholder files"):
        c.file_claim(pid, start, end, 157, json.dumps(demo_sources()))
    as_(module, HOLDER, 0)
    with pytest.raises(err(module), match=r"outside the agreed evidence basis"):
        c.file_claim(pid, start, end, 157, json.dumps([
            {"url": "https://evil.io?x=@agency.example.org", "label": "smuggled"}]))
    c.file_claim(pid, start, end, 157, json.dumps(demo_sources()))
    panel_says(answer())
    as_(module, STRANGER, 0)
    c.investigate(pid)
    with pytest.raises(err(module), match=r"an investigation runs on a filed claim"):
        c.investigate(pid)
    with pytest.raises(err(module), match=r"finality window is still open"):
        c.promote(pid)
    conserve(module, c)


def test_activation_is_exactly_the_premium_and_never_the_insurer(module, c):
    pid = drafted(module, c)
    as_(module, HOLDER, PREMIUM - 1)
    with pytest.raises(err(module), match=r"exactly the premium"):
        c.activate(pid)
    as_(module, INSURER, PREMIUM)
    with pytest.raises(err(module), match=r"cannot insure itself"):
        c.activate(pid)
    as_(module, INSURER, 0)
    c.cancel_policy(pid)
    assert policy(c, pid)["status"] == "CANCELLED"
    assert int(c.get_claimable(INSURER)) == COVERAGE
    conserve(module, c)
