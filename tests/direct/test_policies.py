"""Policy lifecycle before any evidence exists: the draft's validation walls,
the evidence basis frozen into the policy hash, the coverage locked at
drafting, cancellation, and the policyholder's exact premium as the
counter-signature."""

import json

import pytest

from conftest import (
    BASIS, BOND, COVERAGE, COVER_LEN, HOLDER, INSURER, PREMIUM, STRANGER,
    TERMS, THRESHOLD, W, _CliAddress, activated, advance, as_, clock_drift,
    conserve, drafted, err, now, policy, sent,
)


def entry(kind, origin, cls="INDEPENDENT"):
    return {"kind": kind, "origin": origin, "class": cls}


AGENCY = entry("METEOROLOGICAL_AGENCY", "agency.example.org")
PROVIDER = entry("WEATHER_PROVIDER", "weather.example.net")
NEWS = entry("NEWS_REPORT", "news.example.com")
STATION = entry("STATION_LOG", "station.example.com", "PARTY")


def raw_create(module, c, basis_json, who=INSURER, coverage=COVERAGE):
    """create_policy with the canonical draft and the basis string as given,
    for the walls drafted() cannot reach because it serializes the basis."""
    as_(module, who, coverage)
    start = now()
    return c.create_policy(
        "StormGuard Property Protection", "USD 100,000", "WIND",
        "maximum sustained wind speed", "km/h", "GTE", THRESHOLD, 24, 0,
        "Philippines", "Eastern Samar", 11_500_000, 125_500_000, 50,
        str(PREMIUM), 1, start, start + COVER_LEN, W, W, W, TERMS, basis_json)


def nothing_written(c):
    """A refused draft consumes no id, locks no atto and indexes nobody."""
    assert int(c.policy_count) == 0
    assert len(c.policy_ids) == 0
    assert int(c.escrow_atto) == 0
    assert json.loads(c.get_policies_for(INSURER)) == []
    assert json.loads(c.get_policies(0, 10)) == {"total": 0, "policies": []}
    assert json.loads(c.get_stats())["policies"] == 0


def ids_for(c, who):
    return [p["policy_id"] for p in json.loads(c.get_policies_for(who))]


# ── the draft ────────────────────────────────────────────────────────────────

def test_draft_returns_incrementing_ids_and_records_the_instrument(module, c):
    pid = drafted(module, c)
    assert pid == "trg-000001"
    assert drafted(module, c) == "trg-000002"
    assert int(c.policy_count) == 2
    p = policy(c, pid)
    assert p["status"] == "DRAFT"
    assert p["insurer"] == INSURER and p["policyholder"] == ""
    assert p["title"] == "StormGuard Property Protection"
    assert p["notional"] == "USD 100,000"
    assert (p["event_type"], p["metric"], p["unit"]) == (
        "WIND", "maximum sustained wind speed", "km/h")
    assert (p["operator"], p["threshold"]) == ("GTE", THRESHOLD)
    assert (p["measurement_hours"], p["duration_hours"]) == (24, 0)
    assert (p["country"], p["region"]) == ("Philippines", "Eastern Samar")
    assert (p["lat_e6"], p["lon_e6"], p["radius_km"]) == (11_500_000, 125_500_000, 50)
    assert p["coverage_atto"] == str(COVERAGE)
    assert p["premium_atto"] == str(PREMIUM)
    assert p["appeal_bond_atto"] == str(BOND)
    assert p["min_independent"] == 1
    assert p["coverage_start_epoch"] == now()
    assert p["coverage_end_epoch"] == now() + COVER_LEN
    assert (p["claim_grace"], p["finality_window"], p["appeal_window"]) == (W, W, W)
    assert p["created_epoch"] == now() and p["activated_epoch"] == 0
    assert p["evidence_version"] == 0 and p["evidence_root"] == ""
    assert p["outcome"] == "" and p["hold_reason"] == ""
    assert p["appeal_open"] is False and p["appeal_bond_atto"] == str(BOND)
    assert p["payout_atto"] == "0" and p["cancelled_epoch"] == 0
    assert int(c.escrow_atto) == 2 * COVERAGE
    conserve(module, c)


def test_draft_strips_the_text_fields_and_uppercases_the_enums(module, c):
    pid = drafted(module, c, title="  StormGuard  ", event_type=" wind ",
                  operator=" gte ", unit=" km/h ", country=" Philippines ",
                  region=" Eastern Samar ", metric=" wind speed ",
                  notional=" USD 1 ")
    p = policy(c, pid)
    assert p["title"] == "StormGuard" and p["event_type"] == "WIND"
    assert p["operator"] == "GTE" and p["unit"] == "km/h"
    assert p["country"] == "Philippines" and p["region"] == "Eastern Samar"
    assert p["metric"] == "wind speed" and p["notional"] == "USD 1"


def test_draft_refuses_title_outside_1_to_120_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="title must be 1-120 characters"):
        drafted(module, c, title="")
    with pytest.raises(E, match="title must be 1-120 characters"):
        drafted(module, c, title="   ")
    with pytest.raises(E, match="title must be 1-120 characters"):
        drafted(module, c, title="t" * 121)
    nothing_written(c)
    assert policy(c, drafted(module, c, title="t" * 120))["title"] == "t" * 120


def test_draft_refuses_notional_above_40_characters_but_allows_none(module, c):
    with pytest.raises(err(module), match="notional must be at most 40 characters"):
        drafted(module, c, notional="n" * 41)
    nothing_written(c)
    assert policy(c, drafted(module, c, notional="n" * 40))["notional"] == "n" * 40
    assert policy(c, drafted(module, c, notional=""))["notional"] == ""


def test_draft_refuses_metric_outside_1_to_80_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="metric must be 1-80 characters"):
        drafted(module, c, metric="")
    with pytest.raises(E, match="metric must be 1-80 characters"):
        drafted(module, c, metric="m" * 81)
    assert policy(c, drafted(module, c, metric="m" * 80))["metric"] == "m" * 80


def test_draft_refuses_unit_outside_1_to_24_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="unit must be 1-24 characters"):
        drafted(module, c, unit="")
    with pytest.raises(E, match="unit must be 1-24 characters"):
        drafted(module, c, unit="u" * 25)
    assert policy(c, drafted(module, c, unit="u" * 24))["unit"] == "u" * 24


def test_draft_refuses_country_outside_1_to_80_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="country must be 1-80 characters"):
        drafted(module, c, country="")
    with pytest.raises(E, match="country must be 1-80 characters"):
        drafted(module, c, country="c" * 81)
    assert policy(c, drafted(module, c, country="c" * 80))["country"] == "c" * 80


def test_draft_refuses_region_outside_1_to_80_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="region must be 1-80 characters"):
        drafted(module, c, region="")
    with pytest.raises(E, match="region must be 1-80 characters"):
        drafted(module, c, region="r" * 81)
    assert policy(c, drafted(module, c, region="r" * 80))["region"] == "r" * 80


def test_draft_refuses_an_unknown_event_type_and_accepts_every_named_one(module, c):
    with pytest.raises(err(module), match="unknown event type"):
        drafted(module, c, event_type="HAIL")
    with pytest.raises(err(module), match="unknown event type"):
        drafted(module, c, event_type="")
    nothing_written(c)
    for et in module.EVENT_TYPES:
        pid = drafted(module, c, event_type=et.lower())
        assert policy(c, pid)["event_type"] == et
    assert int(c.policy_count) == len(module.EVENT_TYPES)


def test_draft_refuses_an_unknown_operator_and_accepts_the_four_lowercased(module, c):
    E = err(module)
    with pytest.raises(E, match="operator must be one of GTE, GT, LTE, LT"):
        drafted(module, c, operator="EQ")
    with pytest.raises(E, match="operator must be one of GTE, GT, LTE, LT"):
        drafted(module, c, operator=">=")
    nothing_written(c)
    for op in module.OPERATORS:
        assert policy(c, drafted(module, c, operator=op.lower()))["operator"] == op


def test_draft_refuses_threshold_outside_1_to_a_billion_whole_units(module, c):
    E = err(module)
    with pytest.raises(E, match="threshold must be 1-1000000000 whole units"):
        drafted(module, c, threshold=0)
    with pytest.raises(E, match="threshold must be 1-1000000000 whole units"):
        drafted(module, c, threshold=module.MAX_THRESHOLD + 1)
    with pytest.raises(E, match="threshold must be 1-1000000000 whole units"):
        drafted(module, c, threshold="one fifty")
    assert policy(c, drafted(module, c, threshold=1))["threshold"] == 1
    top = policy(c, drafted(module, c, threshold=module.MAX_THRESHOLD))
    assert top["threshold"] == module.MAX_THRESHOLD


def test_draft_refuses_measurement_window_outside_1_to_720_hours(module, c):
    E = err(module)
    with pytest.raises(E, match="the measurement window must be 1-720 hours"):
        drafted(module, c, measurement_hours=0)
    with pytest.raises(E, match="the measurement window must be 1-720 hours"):
        drafted(module, c, measurement_hours=721)
    assert policy(c, drafted(module, c, measurement_hours=1))["measurement_hours"] == 1
    assert policy(c, drafted(module, c, measurement_hours=720))["measurement_hours"] == 720


def test_draft_refuses_duration_outside_0_to_720_hours(module, c):
    E = err(module)
    with pytest.raises(E, match="the required duration must be 0-720 hours"):
        drafted(module, c, duration_hours=-1)
    with pytest.raises(E, match="the required duration must be 0-720 hours"):
        drafted(module, c, duration_hours=721)
    assert policy(c, drafted(module, c, duration_hours=0))["duration_hours"] == 0
    assert policy(c, drafted(module, c, duration_hours=720))["duration_hours"] == 720


@pytest.mark.parametrize("lat,lon", [
    (90_000_001, 125_500_000),
    (-90_000_001, 125_500_000),
    (11_500_000, 180_000_001),
    (11_500_000, -180_000_001),
])
def test_draft_refuses_coordinates_outside_the_microdegree_globe(module, c, lat, lon):
    with pytest.raises(err(module), match="coordinates are microdegrees"):
        drafted(module, c, lat_e6=lat, lon_e6=lon)
    nothing_written(c)


def test_draft_accepts_coordinates_at_the_edges_of_the_globe(module, c):
    for lat, lon in ((90_000_000, 180_000_000), (-90_000_000, -180_000_000)):
        p = policy(c, drafted(module, c, lat_e6=lat, lon_e6=lon))
        assert (p["lat_e6"], p["lon_e6"]) == (lat, lon)
    with pytest.raises(err(module), match="coordinates are microdegrees"):
        drafted(module, c, lat_e6="north")


def test_plotted_coordinates_need_a_radius_but_a_named_area_needs_neither(module, c):
    E = err(module)
    with pytest.raises(E, match="plotted coordinates need a radius"):
        drafted(module, c, lat_e6=11_500_000, lon_e6=125_500_000, radius_km=0)
    with pytest.raises(E, match="plotted coordinates need a radius"):
        drafted(module, c, lat_e6=0, lon_e6=125_500_000, radius_km=0)
    with pytest.raises(E, match="plotted coordinates need a radius"):
        drafted(module, c, lat_e6=11_500_000, lon_e6=0, radius_km=0)
    nothing_written(c)
    named = policy(c, drafted(module, c, lat_e6=0, lon_e6=0, radius_km=0))
    assert (named["lat_e6"], named["lon_e6"], named["radius_km"]) == (0, 0, 0)
    assert named["region"] == "Eastern Samar"


def test_draft_refuses_radius_outside_0_to_5000_km(module, c):
    E = err(module)
    with pytest.raises(E, match="radius must be 0-5000 km"):
        drafted(module, c, radius_km=5_001)
    with pytest.raises(E, match="radius must be 0-5000 km"):
        drafted(module, c, radius_km=-1)
    assert policy(c, drafted(module, c, radius_km=5_000))["radius_km"] == 5_000


def test_draft_refuses_a_premium_below_the_floor(module, c):
    E = err(module)
    with pytest.raises(E, match="premium must be at least 1000000000000000 atto"):
        drafted(module, c, premium=module.MIN_PREMIUM_ATTO - 1)
    with pytest.raises(E, match="premium must be at least 1000000000000000 atto"):
        drafted(module, c, premium="a little")
    nothing_written(c)
    p = policy(c, drafted(module, c, premium=module.MIN_PREMIUM_ATTO))
    assert p["premium_atto"] == str(module.MIN_PREMIUM_ATTO)


def test_draft_refuses_a_premium_at_or_above_the_coverage(module, c):
    with pytest.raises(err(module), match="the premium must be below the coverage"):
        drafted(module, c, premium=COVERAGE)
    with pytest.raises(err(module), match="the premium must be below the coverage"):
        drafted(module, c, premium=COVERAGE + 1)
    nothing_written(c)
    p = policy(c, drafted(module, c, premium=COVERAGE - 1))
    assert p["premium_atto"] == str(COVERAGE - 1)
    conserve(module, c)


def test_the_deposit_is_the_coverage_and_must_be_inside_its_bounds(module, c):
    E = err(module)
    with pytest.raises(E, match="the deposit IS the coverage: send 10000000000000000-10000000000000000000000 atto"):
        drafted(module, c, coverage=module.MIN_COVERAGE_ATTO - 1, premium=module.MIN_PREMIUM_ATTO)
    with pytest.raises(E, match="the deposit IS the coverage"):
        drafted(module, c, coverage=module.MAX_COVERAGE_ATTO + 1)
    with pytest.raises(E, match="the deposit IS the coverage"):
        drafted(module, c, coverage=0)
    nothing_written(c)
    lo = policy(c, drafted(module, c, coverage=module.MIN_COVERAGE_ATTO,
                           premium=module.MIN_PREMIUM_ATTO))
    assert lo["coverage_atto"] == str(module.MIN_COVERAGE_ATTO)
    assert lo["appeal_bond_atto"] == str(module.APPEAL_BOND_FLOOR_ATTO)
    hi = policy(c, drafted(module, c, coverage=module.MAX_COVERAGE_ATTO))
    assert hi["coverage_atto"] == str(module.MAX_COVERAGE_ATTO)
    # at 10,000 GEN the 5% arm outruns the 0.05 GEN floor
    assert hi["appeal_bond_atto"] == str(module.MAX_COVERAGE_ATTO * 500 // 10_000)
    assert int(c.escrow_atto) == module.MIN_COVERAGE_ATTO + module.MAX_COVERAGE_ATTO
    conserve(module, c)


def test_draft_refuses_min_independent_outside_1_to_3(module, c):
    E = err(module)
    with pytest.raises(E, match="min_independent must be 1-3"):
        drafted(module, c, min_independent=0)
    with pytest.raises(E, match="min_independent must be 1-3"):
        drafted(module, c, min_independent=4)
    nothing_written(c)


def test_draft_refuses_claim_grace_outside_900s_to_90_days(module, c):
    E = err(module)
    with pytest.raises(E, match="the claim_grace window must be 900-7776000 seconds"):
        drafted(module, c, grace=899)
    with pytest.raises(E, match="the claim_grace window must be 900-7776000 seconds"):
        drafted(module, c, grace=module.MAX_CLAIM_GRACE + 1)
    # the grace has its own cap, wider than the other two windows
    over = module.MAX_WINDOW_SECONDS + 1
    assert policy(c, drafted(module, c, grace=over))["claim_grace"] == over
    top = policy(c, drafted(module, c, grace=module.MAX_CLAIM_GRACE))
    assert top["claim_grace"] == module.MAX_CLAIM_GRACE


def test_draft_refuses_finality_window_outside_900s_to_30_days(module, c):
    E = err(module)
    with pytest.raises(E, match="the finality window must be 900-2592000 seconds"):
        drafted(module, c, windows=(899, W))
    with pytest.raises(E, match="the finality window must be 900-2592000 seconds"):
        drafted(module, c, windows=(module.MAX_WINDOW_SECONDS + 1, W))
    p = policy(c, drafted(module, c, windows=(module.MAX_WINDOW_SECONDS, W)))
    assert p["finality_window"] == module.MAX_WINDOW_SECONDS


def test_draft_refuses_appeal_window_outside_900s_to_30_days(module, c):
    E = err(module)
    with pytest.raises(E, match="the appeal window must be 900-2592000 seconds"):
        drafted(module, c, windows=(W, 899))
    with pytest.raises(E, match="the appeal window must be 900-2592000 seconds"):
        drafted(module, c, windows=(W, module.MAX_WINDOW_SECONDS + 1))
    p = policy(c, drafted(module, c, windows=(W, module.MAX_WINDOW_SECONDS)))
    assert p["appeal_window"] == module.MAX_WINDOW_SECONDS


def test_zero_window_takes_the_protocol_default(module, c):
    p = policy(c, drafted(module, c, grace=0, windows=(0, 0)))
    assert p["claim_grace"] == module.DEFAULT_CLAIM_GRACE
    assert p["finality_window"] == module.DEFAULT_FINALITY_WINDOW
    assert p["appeal_window"] == module.DEFAULT_APPEAL_WINDOW


def test_coverage_cannot_start_in_the_past_beyond_the_clock_tolerance(module, c):
    E = err(module)
    with pytest.raises(E, match=r"coverage cannot start in the past \(clock reads %d\)" % now()):
        drafted(module, c, cover_start=now() - module.MAX_CLOCK_DIVERGENCE - 1)
    with pytest.raises(E, match="coverage cannot start in the past"):
        drafted(module, c, cover_start=now() - 86_400)
    nothing_written(c)
    edge = policy(c, drafted(module, c, cover_start=now() - module.MAX_CLOCK_DIVERGENCE))
    assert edge["coverage_start_epoch"] == now() - module.MAX_CLOCK_DIVERGENCE
    future = policy(c, drafted(module, c, cover_start=now() + 86_400))
    assert future["coverage_start_epoch"] == now() + 86_400


def test_coverage_must_run_at_least_900_seconds(module, c):
    with pytest.raises(err(module), match="coverage must run at least 900 seconds"):
        drafted(module, c, cover_len=899)
    with pytest.raises(err(module), match="coverage must run at least 900 seconds"):
        drafted(module, c, cover_len=0)
    p = policy(c, drafted(module, c, cover_len=900))
    assert p["coverage_end_epoch"] == p["coverage_start_epoch"] + 900


def test_coverage_may_run_at_most_a_year(module, c):
    with pytest.raises(err(module), match="coverage may run at most 31536000 seconds"):
        drafted(module, c, cover_len=module.MAX_COVERAGE_PERIOD + 1)
    p = policy(c, drafted(module, c, cover_len=module.MAX_COVERAGE_PERIOD))
    assert p["coverage_end_epoch"] == p["coverage_start_epoch"] + module.MAX_COVERAGE_PERIOD


def test_draft_refuses_terms_outside_100_to_12000_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="terms must be 100-12000 characters"):
        drafted(module, c, terms="x" * 99)
    with pytest.raises(E, match="terms must be 100-12000 characters"):
        drafted(module, c, terms="x" * 12_001)
    with pytest.raises(E, match="terms must be 100-12000 characters"):
        drafted(module, c, terms="x" * 99 + " ")        # stripped before measuring
    nothing_written(c)
    assert policy(c, drafted(module, c, terms="x" * 100))["terms_text"] == "x" * 100
    assert len(policy(c, drafted(module, c, terms="x" * 12_000))["terms_text"]) == 12_000


# ── the basis ────────────────────────────────────────────────────────────────

def test_basis_must_be_json(module, c):
    with pytest.raises(err(module), match="basis must be a JSON array"):
        raw_create(module, c, "not json")
    with pytest.raises(err(module), match="basis must be a JSON array"):
        raw_create(module, c, "[{kind: METEOROLOGICAL_AGENCY}]")
    nothing_written(c)


def test_basis_must_be_an_array_not_an_object_or_a_string(module, c):
    with pytest.raises(err(module), match="the evidence basis names 1-6 origins"):
        raw_create(module, c, json.dumps(AGENCY))
    with pytest.raises(err(module), match="the evidence basis names 1-6 origins"):
        raw_create(module, c, json.dumps("agency.example.org"))
    nothing_written(c)


def test_basis_names_1_to_6_origins(module, c):
    E = err(module)
    with pytest.raises(E, match="the evidence basis names 1-6 origins"):
        drafted(module, c, basis=[])
    seven = [entry("OTHER", f"s{i}.example{i}.org") for i in range(7)]
    with pytest.raises(E, match="the evidence basis names 1-6 origins"):
        drafted(module, c, basis=seven)
    nothing_written(c)
    assert len(policy(c, drafted(module, c, basis=seven[:6]))["basis"]) == 6
    assert len(policy(c, drafted(module, c, basis=[AGENCY]))["basis"]) == 1


def test_basis_entry_must_be_an_object(module, c):
    with pytest.raises(err(module), match="basis entry 1 is not an object"):
        drafted(module, c, basis=[AGENCY, "weather.example.net"])
    with pytest.raises(err(module), match="basis entry 0 is not an object"):
        drafted(module, c, basis=[["METEOROLOGICAL_AGENCY", "agency.example.org"]])
    nothing_written(c)


def test_basis_refuses_an_unknown_kind_and_uppercases_a_known_one(module, c):
    with pytest.raises(err(module), match="basis entry 0: unknown source kind"):
        drafted(module, c, basis=[entry("DRONE_FOOTAGE", "agency.example.org")])
    with pytest.raises(err(module), match="basis entry 1: unknown source kind"):
        drafted(module, c, basis=[AGENCY, {"origin": "weather.example.net", "class": "INDEPENDENT"}])
    pid = drafted(module, c, basis=[entry(" meteorological_agency ", "agency.example.org")])
    assert policy(c, pid)["basis"][0]["kind"] == "METEOROLOGICAL_AGENCY"
    for kind in module.SOURCE_KINDS:
        pid = drafted(module, c, basis=[entry(kind.lower(), "agency.example.org")])
        assert policy(c, pid)["basis"][0]["kind"] == kind


def test_basis_refuses_a_class_outside_independent_or_party(module, c):
    E = err(module)
    with pytest.raises(E, match="basis entry 0: class must be INDEPENDENT or PARTY"):
        drafted(module, c, basis=[entry("METEOROLOGICAL_AGENCY", "agency.example.org", "OPERATOR")])
    with pytest.raises(E, match="basis entry 0: class must be INDEPENDENT or PARTY"):
        drafted(module, c, basis=[{"kind": "METEOROLOGICAL_AGENCY", "origin": "agency.example.org"}])
    pid = drafted(module, c, basis=[AGENCY, entry("STATION_LOG", "station.example.com", " party ")])
    assert policy(c, pid)["basis"][1]["class"] == "PARTY"


@pytest.mark.parametrize("origin", [
    "",
    "a.b",
    ".example.org",
    "example.org.",
    "agency..example.org",
    "localhost",
    "-agency.example.org",
    "agency-.example.org",
    "agency_data.example.org",
    "https://agency.example.org",
    "agency.example.org/bulletins",
    "agency.example.org:443",
    "agency example.org",
    "agéncy.example.org",
    "a" * 117 + ".org",
])
def test_basis_refuses_an_origin_that_is_not_a_bare_hostname(module, c, origin):
    with pytest.raises(err(module), match="basis entry 0: origin must be a lowercase hostname"):
        drafted(module, c, basis=[entry("METEOROLOGICAL_AGENCY", origin)])
    nothing_written(c)


def test_basis_accepts_hostnames_at_the_edges_of_the_rule(module, c):
    for origin in ("agency-data.example.org", "s3.eu-west-1.example.org",
                   "123.example.org", "a.bc", "1.2.3.4", "a" * 116 + ".org"):
        pid = drafted(module, c, basis=[entry("METEOROLOGICAL_AGENCY", origin)])
        assert policy(c, pid)["basis"][0]["origin"] == origin


def test_basis_lowercases_and_strips_the_origin_rather_than_refusing_it(module, c):
    # uppercase is NOT a malformed origin: it is lowercased before the rule
    # runs, so one publisher has one spelling in the frozen basis
    loud = drafted(module, c, basis=[entry("METEOROLOGICAL_AGENCY", "AGENCY.EXAMPLE.ORG")])
    padded = drafted(module, c, basis=[entry("METEOROLOGICAL_AGENCY", " Agency.Example.org ")])
    quiet = drafted(module, c, basis=[AGENCY])
    assert policy(c, loud)["basis"] == [AGENCY]
    assert policy(c, padded)["basis"] == [AGENCY]
    # normalization precedes the hash: one basis, one commitment
    assert policy(c, loud)["terms_sha256"] == policy(c, quiet)["terms_sha256"]
    assert policy(c, padded)["terms_sha256"] == policy(c, quiet)["terms_sha256"]


def test_basis_refuses_a_duplicate_origin_however_it_is_cased(module, c):
    with pytest.raises(err(module), match="basis entry 1: origin agency.example.org is listed twice"):
        drafted(module, c, basis=[AGENCY, entry("NEWS_REPORT", "agency.example.org")])
    with pytest.raises(err(module), match="basis entry 1: origin agency.example.org is listed twice"):
        drafted(module, c, basis=[AGENCY, entry("NEWS_REPORT", "AGENCY.EXAMPLE.ORG")])
    # a different class does not make it a different origin
    with pytest.raises(err(module), match="origin agency.example.org is listed twice"):
        drafted(module, c, basis=[AGENCY, entry("STATION_LOG", "agency.example.org", "PARTY")])
    nothing_written(c)


def test_basis_without_an_independent_origin_is_refused(module, c):
    only_party = [STATION, entry("OTHER", "insurer.example.com", "PARTY")]
    with pytest.raises(err(module), match="needs at least one INDEPENDENT origin"):
        drafted(module, c, basis=only_party)
    nothing_written(c)
    conserve(module, c)


def test_min_independent_cannot_exceed_the_distinct_independent_publishers(module, c):
    # BASIS: example.org, example.net and example.com are three publishers;
    # the station on example.com is PARTY and never counts
    assert policy(c, drafted(module, c, min_independent=3))["min_independent"] == 3
    with pytest.raises(err(module),
                       match="min_independent is 3 but the basis has only 2 independent publisher"):
        drafted(module, c, min_independent=3, basis=[AGENCY, PROVIDER, STATION])
    with pytest.raises(err(module),
                       match="min_independent is 2 but the basis has only 1 independent publisher"):
        drafted(module, c, min_independent=2, basis=[AGENCY, STATION])
    assert policy(c, drafted(module, c, min_independent=2, basis=[AGENCY, PROVIDER]))["min_independent"] == 2


def test_two_hosts_of_one_publisher_are_one_independent_voice(module, c):
    twins = [AGENCY, entry("GOVERNMENT_RECORD", "data.agency.example.org")]
    with pytest.raises(err(module), match="has only 1 independent publisher"):
        drafted(module, c, min_independent=2, basis=twins)
    # the second-level suffix heuristic: example.co.uk is the publisher
    uk = [entry("METEOROLOGICAL_AGENCY", "metoffice.example.co.uk"),
          entry("NEWS_REPORT", "news.example.co.uk")]
    with pytest.raises(err(module), match="has only 1 independent publisher"):
        drafted(module, c, min_independent=2, basis=uk)
    # a party origin on a fresh publisher never counts toward the tally
    with pytest.raises(err(module), match="has only 1 independent publisher"):
        drafted(module, c, min_independent=2, basis=[AGENCY, STATION])
    nothing_written(c)
    assert len(policy(c, drafted(module, c, min_independent=1, basis=twins))["basis"]) == 2
    # different publishers on one suffix are distinct voices
    two = [entry("METEOROLOGICAL_AGENCY", "met.alpha.co.uk"), entry("NEWS_REPORT", "news.beta.co.uk")]
    assert policy(c, drafted(module, c, min_independent=2, basis=two))["min_independent"] == 2


def test_basis_freezes_exactly_kind_origin_and_class(module, c):
    noisy = dict(AGENCY, note="ignore me", weight=3)
    pid = drafted(module, c, basis=[noisy, STATION])
    assert policy(c, pid)["basis"] == [AGENCY, STATION]
    assert json.loads(c.basis_store[pid]) == [AGENCY, STATION]


# ── the commitment ───────────────────────────────────────────────────────────

def commitment_fields(module, **over):
    fields = {
        "insurer": INSURER, "title": "StormGuard Property Protection",
        "notional": "USD 100,000", "event_type": "WIND",
        "metric": "maximum sustained wind speed", "unit": "km/h",
        "operator": "GTE", "threshold": THRESHOLD,
        "measurement_hours": 24, "duration_hours": 0,
        "country": "Philippines", "region": "Eastern Samar",
        "lat_e6": 11_500_000, "lon_e6": 125_500_000, "radius_km": 50,
        "coverage_atto": str(COVERAGE), "premium_atto": str(PREMIUM),
        "min_independent": 1,
        "coverage_start_epoch": now(), "coverage_end_epoch": now() + COVER_LEN,
        "claim_grace": W, "finality_window": W, "appeal_window": W,
        "terms_sha256": module._sha256_hex(TERMS), "basis": BASIS,
    }
    fields.update(over)
    return fields


def commitment(module, **over):
    return module._sha256_hex(module._canonical(commitment_fields(module, **over)))


def test_terms_hash_is_the_canonical_commitment_over_trigger_money_period_and_basis(module, c):
    pid = drafted(module, c)
    assert policy(c, pid)["terms_sha256"] == commitment(module)
    # the same recomputation tracks a changed input byte for byte
    other = drafted(module, c, threshold=151, operator="gt", grace=0)
    assert policy(c, other)["terms_sha256"] == commitment(
        module, threshold=151, operator="GT", claim_grace=module.DEFAULT_CLAIM_GRACE)


def test_the_commitment_is_serialized_key_sorted_not_in_source_order(module, c):
    """One byte-stable serialization: the digest a party recomputes from the
    published policy cannot depend on the order the contract happened to
    assemble the fields in, or the commitment is only reproducible by the
    contract's own source order."""
    pid = drafted(module, c)
    fields = commitment_fields(module)
    shuffled = dict(reversed(list(fields.items())))
    assert list(shuffled) != list(fields)
    assert module._canonical(shuffled) == module._canonical(fields)
    assert policy(c, pid)["terms_sha256"] == module._sha256_hex(module._canonical(shuffled))


def test_terms_hash_commits_to_the_basis(module, c):
    full = policy(c, drafted(module, c))["terms_sha256"]
    without_station = policy(c, drafted(module, c, basis=[AGENCY, PROVIDER, NEWS]))["terms_sha256"]
    relabelled = policy(c, drafted(module, c, basis=[
        AGENCY, PROVIDER, NEWS, entry("STATION_LOG", "station.example.com", "INDEPENDENT")]))["terms_sha256"]
    rekinded = policy(c, drafted(module, c, basis=[
        AGENCY, PROVIDER, NEWS, entry("OTHER", "station.example.com", "PARTY")]))["terms_sha256"]
    reordered = policy(c, drafted(module, c, basis=[STATION, NEWS, PROVIDER, AGENCY]))["terms_sha256"]
    assert len({full, without_station, relabelled, rekinded, reordered}) == 5
    assert without_station == commitment(module, basis=[AGENCY, PROVIDER, NEWS])


def test_terms_hash_changes_with_every_trigger_money_and_period_field(module, c):
    base = policy(c, drafted(module, c))["terms_sha256"]
    variants = [
        dict(title="Other title"), dict(notional="USD 1"), dict(event_type="RAINFALL"),
        dict(metric="rainfall"), dict(unit="mm"), dict(operator="GT"),
        dict(threshold=THRESHOLD + 1), dict(measurement_hours=48), dict(duration_hours=1),
        dict(country="Viet Nam"), dict(region="Leyte"), dict(lat_e6=11_500_001),
        dict(lon_e6=125_500_001), dict(radius_km=51), dict(coverage=COVERAGE + 1),
        dict(premium=PREMIUM + 1), dict(min_independent=2), dict(cover_start=now() + 1),
        dict(cover_len=COVER_LEN + 1), dict(grace=W + 1), dict(windows=(W + 1, W)),
        dict(windows=(W, W + 1)), dict(terms=TERMS + " Amended."),
    ]
    hashes = {base}
    for kw in variants:
        hashes.add(policy(c, drafted(module, c, **kw))["terms_sha256"])
    assert len(hashes) == len(variants) + 1
    conserve(module, c)


def test_same_inputs_give_the_same_hash_under_different_ids_and_a_different_insurer_differs(module, c):
    a = drafted(module, c)
    b = drafted(module, c)
    assert a != b
    assert policy(c, a)["terms_sha256"] == policy(c, b)["terms_sha256"]
    other = raw_create(module, c, json.dumps(BASIS), who=STRANGER)
    assert policy(c, other)["insurer"] == STRANGER
    assert policy(c, other)["terms_sha256"] == commitment(module, insurer=STRANGER)
    assert policy(c, other)["terms_sha256"] != policy(c, a)["terms_sha256"]


# ── escrow, ids, index and views ─────────────────────────────────────────────

def test_the_deposit_is_locked_at_drafting(module, c):
    pid = drafted(module, c)
    assert int(c.escrow_atto) == COVERAGE
    assert c.get_claimable(INSURER) == "0"
    stats = json.loads(c.get_stats())
    assert stats["policies"] == 1 and stats["active"] == 0
    assert stats["escrow_atto"] == str(COVERAGE) and stats["premiums_atto"] == "0"
    conserve(module, c)
    drafted(module, c, coverage=3 * COVERAGE)
    assert int(c.escrow_atto) == 4 * COVERAGE
    assert policy(c, pid)["coverage_atto"] == str(COVERAGE)
    conserve(module, c)


def test_a_refused_draft_locks_nothing_and_consumes_no_id(module, c):
    with pytest.raises(err(module), match="title must be"):
        drafted(module, c, title="")
    nothing_written(c)
    conserve(module, c)
    assert drafted(module, c) == "trg-000001"


def test_the_insurer_is_indexed_at_drafting(module, c):
    a = drafted(module, c)
    b = drafted(module, c)
    assert ids_for(c, INSURER) == [a, b]
    assert ids_for(c, HOLDER) == [] and ids_for(c, STRANGER) == []
    stranger_pid = raw_create(module, c, json.dumps(BASIS), who=STRANGER)
    assert ids_for(c, STRANGER) == [stranger_pid]
    assert ids_for(c, INSURER) == [a, b]


def test_get_policies_paginates_newest_first(module, c):
    for _ in range(3):
        drafted(module, c)
    first = json.loads(c.get_policies(0, 2))
    assert first["total"] == 3
    assert [p["policy_id"] for p in first["policies"]] == ["trg-000003", "trg-000002"]
    second = json.loads(c.get_policies(2, 2))
    assert second["total"] == 3
    assert [p["policy_id"] for p in second["policies"]] == ["trg-000001"]
    assert json.loads(c.get_policies(3, 2))["policies"] == []
    assert json.loads(c.get_policies(99, 2))["policies"] == []
    # The page carries the evidence basis — which publishers the panel may
    # read is how a reader judges a policy at all, so it is not held back for
    # the detail view. The frozen policy TEXT is, being unbounded.
    assert "terms_text" not in first["policies"][0]
    assert [b["origin"] for b in first["policies"][0]["basis"]] == [
        b["origin"] for b in BASIS]
    assert first["policies"][0]["coverage_atto"] == str(COVERAGE)


def test_get_policies_handles_zero_negative_and_garbage_paging(module, c):
    for _ in range(3):
        drafted(module, c)
    empty = json.loads(c.get_policies(0, 0))
    assert empty["total"] == 3 and empty["policies"] == []
    assert json.loads(c.get_policies(0, -5))["policies"] == []
    clamped = json.loads(c.get_policies(-1, 1))
    assert [p["policy_id"] for p in clamped["policies"]] == ["trg-000003"]
    garbage = json.loads(c.get_policies("x", "y"))       # offset 0, limit 20
    assert [p["policy_id"] for p in garbage["policies"]] == [
        "trg-000003", "trg-000002", "trg-000001"]


def test_get_policies_caps_a_page_at_50(module, c):
    for _ in range(52):
        drafted(module, c)
    page = json.loads(c.get_policies(0, 100))
    assert page["total"] == 52 and len(page["policies"]) == 50
    assert page["policies"][0]["policy_id"] == "trg-000052"
    assert page["policies"][-1]["policy_id"] == "trg-000003"
    rest = json.loads(c.get_policies(50, 100))
    assert [p["policy_id"] for p in rest["policies"]] == ["trg-000002", "trg-000001"]
    default = json.loads(c.get_policies(0, "abc"))
    assert len(default["policies"]) == 20
    assert int(c.escrow_atto) == 52 * COVERAGE
    conserve(module, c)


def test_get_policies_for_lists_the_policy_for_insurer_and_later_policyholder(module, c):
    pid = drafted(module, c)
    assert ids_for(c, HOLDER) == []
    as_(module, HOLDER, PREMIUM)
    c.activate(pid)
    other = drafted(module, c)
    assert ids_for(c, INSURER) == [pid, other]
    assert ids_for(c, HOLDER) == [pid]
    assert ids_for(c, STRANGER) == []
    view = json.loads(c.get_policies_for(HOLDER))[0]
    assert view["status"] == "ACTIVE" and view["policyholder"] == HOLDER
    assert "terms_text" not in view


def test_get_policies_for_accepts_the_cli_address_object_and_any_hex_case(module, c):
    pid = activated(module, c)
    by_object = json.loads(c.get_policies_for(_CliAddress(HOLDER)))
    by_upper = json.loads(c.get_policies_for(HOLDER.upper()))
    by_padded = json.loads(c.get_policies_for("  " + INSURER + "  "))
    assert [p["policy_id"] for p in by_object] == [pid]
    assert by_upper == by_object
    assert [p["policy_id"] for p in by_padded] == [pid]
    assert c.get_claimable(_CliAddress(INSURER)) == str(PREMIUM)
    assert c.get_claimable(INSURER.upper()) == str(PREMIUM)


def test_get_policy_unknown_is_empty(module, c):
    assert c.get_policy("trg-000001") == ""
    drafted(module, c)
    assert c.get_policy("trg-000002") == ""
    assert c.get_policy("") == ""
    assert c.get_policy("TRG-000001") == ""
    assert c.get_policy(1) == ""


def test_get_policy_carries_the_frozen_terms_text_and_basis(module, c):
    p = policy(c, drafted(module, c))
    assert p["terms_text"] == TERMS
    assert p["basis"] == BASIS
    assert c.terms_store["trg-000001"] == TERMS


def test_get_config_reports_the_bounds_the_writes_enforce(module, c):
    cfg = json.loads(c.get_config())
    assert cfg["min_coverage_atto"] == str(module.MIN_COVERAGE_ATTO)
    assert cfg["max_coverage_atto"] == str(module.MAX_COVERAGE_ATTO)
    assert cfg["min_premium_atto"] == str(module.MIN_PREMIUM_ATTO)
    assert cfg["threshold"] == [module.MIN_THRESHOLD, module.MAX_THRESHOLD]
    assert cfg["measurement_hours"] == [module.MIN_MEASUREMENT_HOURS, module.MAX_MEASUREMENT_HOURS]
    assert cfg["duration_hours"] == [0, module.MAX_DURATION_HOURS]
    assert cfg["radius_km"] == [0, module.MAX_RADIUS_KM]
    assert cfg["min_independent"] == [module.MIN_INDEPENDENT, module.MAX_INDEPENDENT]
    assert cfg["terms_chars"] == [module.MIN_TERMS_CHARS, module.MAX_TERMS_CHARS]
    assert cfg["title_chars"] == [1, module.MAX_TITLE_CHARS]
    assert cfg["notional_chars"] == [0, module.MAX_NOTIONAL_CHARS]
    assert cfg["place_chars"] == [1, module.MAX_PLACE_CHARS]
    assert cfg["metric_chars"] == [1, module.MAX_METRIC_CHARS]
    assert cfg["unit_chars"] == [1, module.MAX_UNIT_CHARS]
    assert cfg["basis_entries"] == [1, module.MAX_BASIS_ENTRIES]
    assert cfg["window_seconds"] == [module.MIN_WINDOW_SECONDS, module.MAX_WINDOW_SECONDS]
    assert cfg["claim_grace_seconds"] == [module.MIN_WINDOW_SECONDS, module.MAX_CLAIM_GRACE]
    assert cfg["coverage_period_seconds"] == [module.MIN_WINDOW_SECONDS, module.MAX_COVERAGE_PERIOD]
    assert cfg["default_windows"] == {
        "claim_grace": module.DEFAULT_CLAIM_GRACE,
        "finality": module.DEFAULT_FINALITY_WINDOW,
        "appeal": module.DEFAULT_APPEAL_WINDOW}
    assert cfg["appeal_bond_bps"] == module.APPEAL_BOND_BPS
    assert cfg["appeal_bond_floor_atto"] == str(module.APPEAL_BOND_FLOOR_ATTO)
    assert cfg["event_types"] == list(module.EVENT_TYPES)
    assert cfg["operators"] == ["GTE", "GT", "LTE", "LT"]
    assert cfg["source_kinds"] == list(module.SOURCE_KINDS)
    assert cfg["source_classes"] == ["INDEPENDENT", "PARTY"]
    assert cfg["statuses"] == list(module.STATUSES)
    assert cfg["outcomes"] == list(module.OUTCOMES)
    assert cfg["hold_reasons"] == list(module.HOLD_REASONS)


def test_get_config_floors_are_the_enforced_floors(module, c):
    cfg = json.loads(c.get_config())
    with pytest.raises(err(module), match="the deposit IS the coverage"):
        drafted(module, c, coverage=int(cfg["min_coverage_atto"]) - 1,
                premium=int(cfg["min_premium_atto"]))
    with pytest.raises(err(module), match="premium must be at least"):
        drafted(module, c, premium=int(cfg["min_premium_atto"]) - 1)
    with pytest.raises(err(module), match="threshold must be"):
        drafted(module, c, threshold=cfg["threshold"][1] + 1)
    with pytest.raises(err(module), match="radius must be"):
        drafted(module, c, radius_km=cfg["radius_km"][1] + 1)
    nothing_written(c)
    drafted(module, c, coverage=int(cfg["min_coverage_atto"]),
            premium=int(cfg["min_premium_atto"]))
    conserve(module, c)


# ── cancel ───────────────────────────────────────────────────────────────────

def test_cancel_marks_the_draft_cancelled_and_credits_the_coverage(module, c):
    pid = drafted(module, c)
    advance(10)
    as_(module, INSURER, 0)
    assert c.cancel_policy(pid) == "cancelled"
    p = policy(c, pid)
    assert p["status"] == "CANCELLED"
    assert p["cancelled_epoch"] == now() and p["cancelled_epoch"] == p["created_epoch"] + 10
    assert p["policyholder"] == "" and p["activated_epoch"] == 0
    # the coverage moved from the lock to the ledger; nothing left custody
    assert int(c.get_claimable(INSURER)) == COVERAGE
    assert int(c.escrow_atto) == COVERAGE
    assert json.loads(c.get_stats())["active"] == 0
    conserve(module, c)


def test_cancelled_coverage_leaves_only_through_claim(module, c):
    pid = drafted(module, c)
    as_(module, INSURER, 0)
    c.cancel_policy(pid)
    assert sent() == []
    c.claim()
    assert sent() == [(INSURER, COVERAGE)]
    assert int(c.escrow_atto) == 0 and c.get_claimable(INSURER) == "0"
    conserve(module, c)


def test_cancel_is_insurer_only(module, c):
    pid = drafted(module, c)
    for who in (HOLDER, STRANGER):
        as_(module, who, 0)
        with pytest.raises(err(module), match="only the insurer cancels a draft"):
            c.cancel_policy(pid)
    p = policy(c, pid)
    assert p["status"] == "DRAFT" and p["cancelled_epoch"] == 0
    assert c.get_claimable(HOLDER) == "0" and c.get_claimable(STRANGER) == "0"
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)


def test_cancel_only_from_draft(module, c):
    pid = activated(module, c)
    as_(module, INSURER, 0)
    with pytest.raises(err(module), match="only an unactivated draft cancels — this one is ACTIVE"):
        c.cancel_policy(pid)
    assert policy(c, pid)["status"] == "ACTIVE"
    assert int(c.get_claimable(INSURER)) == PREMIUM        # the premium only
    other = drafted(module, c)
    c.cancel_policy(other)
    with pytest.raises(err(module), match="this one is CANCELLED"):
        c.cancel_policy(other)
    assert int(c.get_claimable(INSURER)) == PREMIUM + COVERAGE     # credited once
    conserve(module, c)


def test_cancel_unknown_policy_refused(module, c):
    as_(module, INSURER, 0)
    with pytest.raises(err(module), match=r"\[EXPECTED\] unknown policy"):
        c.cancel_policy("trg-000009")
    drafted(module, c)
    with pytest.raises(err(module), match="unknown policy"):
        c.cancel_policy("trg-000002")


def test_dead_clock_refuses_cancel_and_leaves_the_draft_exactly_as_it_was(module, c):
    pid = drafted(module, c)
    before = policy(c, pid)
    clock_drift("DEAD")
    as_(module, INSURER, 0)
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock is available"):
        c.cancel_policy(pid)
    assert policy(c, pid) == before
    assert c.get_claimable(INSURER) == "0"
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)
    clock_drift()
    assert c.cancel_policy(pid) == "cancelled"
    assert int(c.get_claimable(INSURER)) == COVERAGE
    conserve(module, c)


# ── activate ─────────────────────────────────────────────────────────────────

def test_activation_is_exactly_the_premium(module, c):
    pid = drafted(module, c)
    for value in (PREMIUM - 1, PREMIUM + 1, 0, 2 * PREMIUM):
        as_(module, HOLDER, value)
        with pytest.raises(err(module), match="activation is exactly the premium: send %d atto" % PREMIUM):
            c.activate(pid)
    p = policy(c, pid)
    assert p["status"] == "DRAFT" and p["policyholder"] == "" and p["activated_epoch"] == 0
    assert int(c.escrow_atto) == COVERAGE
    assert c.get_claimable(INSURER) == "0"
    assert ids_for(c, HOLDER) == []
    stats = json.loads(c.get_stats())
    assert stats["active"] == 0 and stats["premiums_atto"] == "0"
    conserve(module, c)


def test_the_insurer_cannot_insure_itself(module, c):
    pid = drafted(module, c)
    as_(module, INSURER, PREMIUM)
    with pytest.raises(err(module), match="the insurer cannot insure itself"):
        c.activate(pid)
    p = policy(c, pid)
    assert p["status"] == "DRAFT" and p["policyholder"] == ""
    assert int(c.escrow_atto) == COVERAGE and c.get_claimable(INSURER) == "0"
    conserve(module, c)


def test_a_stranger_may_activate_and_becomes_the_policyholder(module, c):
    pid = drafted(module, c)
    as_(module, STRANGER, PREMIUM)
    assert c.activate(pid) == "active"
    p = policy(c, pid)
    assert p["status"] == "ACTIVE" and p["policyholder"] == STRANGER
    assert ids_for(c, STRANGER) == [pid]
    assert int(c.escrow_atto) == COVERAGE + PREMIUM
    conserve(module, c)


def test_activation_credits_the_premium_at_once_and_moves_the_stats(module, c):
    pid = drafted(module, c)
    advance(100)
    as_(module, HOLDER, PREMIUM)
    c.activate(pid)
    p = policy(c, pid)
    assert p["activated_epoch"] == now() and p["activated_epoch"] == p["created_epoch"] + 100
    assert p["policyholder"] == HOLDER
    assert int(c.get_claimable(INSURER)) == PREMIUM
    assert c.get_claimable(HOLDER) == "0"
    stats = json.loads(c.get_stats())
    assert stats["active"] == 1 and stats["premiums_atto"] == str(PREMIUM)
    assert stats["escrow_atto"] == str(COVERAGE + PREMIUM)
    assert stats["policies"] == 1 and stats["paid_atto"] == "0"
    conserve(module, c)
    # the premium is the insurer's to withdraw while the coverage stays locked
    as_(module, INSURER, 0)
    c.claim()
    assert sent() == [(INSURER, PREMIUM)]
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)


def test_second_activation_is_refused_and_the_first_policyholder_stays_s30(module, c):
    pid = activated(module, c)
    as_(module, STRANGER, PREMIUM)
    with pytest.raises(err(module), match="nothing to activate in ACTIVE"):
        c.activate(pid)
    p = policy(c, pid)
    assert p["policyholder"] == HOLDER and p["status"] == "ACTIVE"
    assert int(c.get_claimable(INSURER)) == PREMIUM          # a single premium
    assert int(c.escrow_atto) == COVERAGE + PREMIUM
    stats = json.loads(c.get_stats())
    assert stats["active"] == 1 and stats["premiums_atto"] == str(PREMIUM)
    assert ids_for(c, STRANGER) == [] and ids_for(c, HOLDER) == [pid]
    conserve(module, c)


def test_activate_refused_on_a_cancelled_draft(module, c):
    pid = drafted(module, c)
    as_(module, INSURER, 0)
    c.cancel_policy(pid)
    as_(module, HOLDER, PREMIUM)
    with pytest.raises(err(module), match="nothing to activate in CANCELLED"):
        c.activate(pid)
    p = policy(c, pid)
    assert p["status"] == "CANCELLED" and p["policyholder"] == ""
    assert int(c.get_claimable(INSURER)) == COVERAGE
    assert ids_for(c, HOLDER) == []
    conserve(module, c)


def test_activate_refused_at_and_after_the_coverage_end(module, c):
    early = drafted(module, c)
    late = drafted(module, c)
    advance(COVER_LEN - 1)
    as_(module, HOLDER, PREMIUM)
    c.activate(early)
    advance(1)
    as_(module, HOLDER, PREMIUM)
    with pytest.raises(err(module), match="the coverage period has ended"):
        c.activate(late)
    assert policy(c, late)["status"] == "DRAFT"
    assert policy(c, early)["status"] == "ACTIVE"
    assert int(c.get_claimable(INSURER)) == PREMIUM
    assert int(c.escrow_atto) == 2 * COVERAGE + PREMIUM
    assert ids_for(c, HOLDER) == [early]
    conserve(module, c)


def test_activate_is_allowed_before_the_coverage_starts(module, c):
    pid = drafted(module, c, cover_start=now() + 86_400)
    as_(module, HOLDER, PREMIUM)
    c.activate(pid)
    p = policy(c, pid)
    assert p["status"] == "ACTIVE"
    assert p["activated_epoch"] == now() and p["coverage_start_epoch"] == now() + 86_400
    conserve(module, c)


def test_activate_unknown_policy_refused(module, c):
    as_(module, HOLDER, PREMIUM)
    with pytest.raises(err(module), match="unknown policy"):
        c.activate("trg-000001")
    assert int(c.escrow_atto) == 0
    assert ids_for(c, HOLDER) == []


def test_dead_clock_refuses_draft_and_activate_as_transient_and_writes_nothing(module, c):
    pid = drafted(module, c)
    clock_drift("DEAD")
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock is available"):
        drafted(module, c)
    # every static wall passed; the refusal consumed no id and locked nothing
    assert int(c.policy_count) == 1 and len(c.policy_ids) == 1
    assert int(c.escrow_atto) == COVERAGE
    as_(module, HOLDER, PREMIUM)
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock is available"):
        c.activate(pid)
    p = policy(c, pid)
    assert p["status"] == "DRAFT" and p["policyholder"] == "" and p["activated_epoch"] == 0
    assert int(c.escrow_atto) == COVERAGE
    assert c.get_claimable(INSURER) == "0"
    assert ids_for(c, HOLDER) == []
    assert json.loads(c.get_stats())["active"] == 0
    conserve(module, c)
    clock_drift()
    assert drafted(module, c) == "trg-000002"
    as_(module, HOLDER, PREMIUM)
    c.activate(pid)
    assert policy(c, pid)["status"] == "ACTIVE"
    assert int(c.get_claimable(INSURER)) == PREMIUM
    conserve(module, c)


# ── unknown ids everywhere ───────────────────────────────────────────────────

@pytest.mark.parametrize("method,args", [
    ("cancel_policy", ()),
    ("activate", ()),
    ("file_claim", (0, 1, 157, "[]")),
    ("investigate", ()),
    ("promote", ()),
    ("appeal", ("these are my grounds for appeal", "", "")),
    ("re_investigate", ()),
    ("lapse_appeal", ()),
    ("settle", ()),
    ("expire", ()),
])
def test_every_write_refuses_an_unknown_policy_before_anything_else(module, c, method, args):
    drafted(module, c)
    for who in (INSURER, HOLDER, STRANGER):
        as_(module, who, 0)
        with pytest.raises(err(module), match=r"\[EXPECTED\] unknown policy"):
            getattr(c, method)("trg-000002", *args)
        with pytest.raises(err(module), match="unknown policy"):
            getattr(c, method)("", *args)
    assert policy(c, "trg-000001")["status"] == "DRAFT"
    assert int(c.escrow_atto) == COVERAGE
    conserve(module, c)


def test_every_view_answers_an_unknown_policy_or_address_with_an_empty_value(module, c):
    assert c.get_policy("trg-000001") == ""
    assert c.get_package("trg-000001", 1) == ""
    assert c.get_decision("trg-000001", 1) == ""
    assert c.get_decision("trg-000001", "x") == ""
    assert json.loads(c.get_policies_for(STRANGER)) == []
    assert json.loads(c.get_policies_for("")) == []
    assert c.get_claimable(STRANGER) == "0"
    assert json.loads(c.get_policies(0, 20)) == {"total": 0, "policies": []}
    drafted(module, c)
    assert c.get_package("trg-000001", 0) == ""
    assert c.get_package("trg-000001", 1) == ""
    assert c.get_decision("trg-000001", 1) == ""
