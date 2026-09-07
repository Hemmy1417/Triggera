"""file_claim and the intake walls: who files and when, the event window the
claim names, how many versions the record holds, what a source row must look
like, how a URL finds its basis entry, why two spellings of one page are one
source, and what the stored package binds. Intake never fetches and never
moves an atto."""

import json
import re

import pytest

from conftest import (
    AGENCY_URL, AGENCY_URL_TWIN, COVER_LEN, HOLDER, INSURER, NEWS_URL,
    PROVIDER_URL, STATION_URL, STRANGER, W, activated, advance, answer, as_,
    claimed, conserve, demo_sources, drafted, err, event_window, fetches,
    final, investigated, now, package, panel_says, policy, settled, source,
)

AGENCY_SUB = "https://data.agency.example.org/tables/2026-09-03"
STATION_CDN = "https://cdn.station.example.com/logs/premises-01/2026-09-03"
STATION_URL_2 = "https://station.example.com/logs/premises-01/2026-09-04"

A = "https://agency.example.org"

# One origin nested inside another: a host under agency.example.org matches
# both entries and must take the LONGEST, whatever order the insurer listed
# them in.
NESTED_BASIS = [
    {"kind": "OTHER", "origin": "example.org", "class": "INDEPENDENT"},
    {"kind": "STATION_LOG", "origin": "agency.example.org", "class": "PARTY"},
]

UK_BASIS = [
    {"kind": "METEOROLOGICAL_AGENCY", "origin": "metoffice.example.co.uk",
     "class": "INDEPENDENT"},
]


# ── helpers ──────────────────────────────────────────────────────────────────

def ready(module, c, **kw):
    """An ACTIVE policy whose canonical event window has already passed."""
    pid = activated(module, c, **kw)
    start, end = event_window(c, pid)
    if now() <= end:
        advance(end - now() + 1)
    return pid


def submit(module, c, pid, sources=None, claimed_reading=157, start=None,
           end=None, who=HOLDER):
    s, e = event_window(c, pid)
    as_(module, who, 0)
    return json.loads(c.file_claim(
        pid, s if start is None else start, e if end is None else end,
        claimed_reading,
        json.dumps(demo_sources() if sources is None else sources)))


def refused(module, c, pid, sources, match, claimed_reading=157, start=None,
            end=None, who=HOLDER, raw=None):
    s, e = event_window(c, pid)
    as_(module, who, 0)
    body = raw if raw is not None else json.dumps(
        demo_sources() if sources is None else sources)
    with pytest.raises(err(module), match=match) as ei:
        c.file_claim(pid, s if start is None else start,
                     e if end is None else end, claimed_reading, body)
    return str(ei.value)


def untouched(c, pid, version=0, status="ACTIVE"):
    """A refused claim writes nothing: no version, no root, no window, no
    package, and the status the policy already had."""
    p = policy(c, pid)
    assert p["status"] == status
    assert p["evidence_version"] == version
    if version == 0:
        assert p["evidence_root"] == ""
        assert p["last_claim_epoch"] == 0
        assert p["event_start_epoch"] == 0 and p["event_end_epoch"] == 0
        assert p["claimed_reading"] == 0
    assert c.get_package(pid, version + 1) == ""


def _investigating(module, c):
    return claimed(module, c)


def _pending(module, c):
    return investigated(module, c)


def _final(module, c):
    return final(module, c)


def _paid(module, c):
    return settled(module, c)


def _expired(module, c):
    pid = activated(module, c)
    p = policy(c, pid)
    advance(p["coverage_end_epoch"] + p["claim_grace"] - now() + 1)
    as_(module, STRANGER, 0)
    c.expire(pid)
    return pid


# ── who files, and when ──────────────────────────────────────────────────────

def test_only_the_policyholder_files_a_claim(module, c):
    pid = ready(module, c)
    for who in (INSURER, STRANGER):
        refused(module, c, pid, demo_sources(),
                "only the policyholder files a claim", who=who)
    untouched(c, pid)
    assert submit(module, c, pid)["version"] == 1
    assert policy(c, pid)["evidence_version"] == 1
    conserve(module, c)


def test_a_draft_has_no_policyholder_so_the_sender_wall_speaks_first(module, c):
    # DRAFT and CANCELLED never reach the status wall through file_claim:
    # nobody is the policyholder yet, so the sender wall — the stricter of the
    # two — refuses every wallet including the insurer's.
    pid = drafted(module, c)
    assert policy(c, pid)["policyholder"] == ""
    for who in (INSURER, HOLDER, STRANGER):
        refused(module, c, pid, demo_sources(),
                "only the policyholder files a claim", who=who)
    assert policy(c, pid)["status"] == "DRAFT"
    as_(module, INSURER, 0)
    c.cancel_policy(pid)
    refused(module, c, pid, demo_sources(), "only the policyholder files a claim")
    assert policy(c, pid)["status"] == "CANCELLED"
    assert c.get_package(pid, 1) == ""
    conserve(module, c)


@pytest.mark.parametrize("status,reach", [
    ("INVESTIGATING", _investigating),
    ("PENDING_FINALITY", _pending),
    ("FINAL", _final),
    ("PAID", _paid),
    ("EXPIRED", _expired),
], ids=["INVESTIGATING", "PENDING_FINALITY", "FINAL", "PAID", "EXPIRED"])
def test_a_claim_is_filed_only_on_an_active_policy_and_the_refusal_names_the_status(
        module, c, status, reach):
    pid = reach(module, c)
    before = policy(c, pid)
    assert before["status"] == status
    refused(module, c, pid, demo_sources(), f"this one is {status}")
    assert policy(c, pid) == before
    assert c.get_package(pid, before["evidence_version"] + 1) == ""
    conserve(module, c)


def test_an_unknown_policy_is_refused_before_anything_else(module, c):
    ready(module, c)
    as_(module, HOLDER, 0)
    with pytest.raises(err(module), match=r"\[EXPECTED\] unknown policy"):
        c.file_claim("trg-000099", 0, 1, 157, json.dumps(demo_sources()))
    conserve(module, c)


def test_the_claim_grace_boundary_is_inclusive_and_closed_one_second_later(module, c):
    a = activated(module, c)
    b = activated(module, c)
    p = policy(c, a)
    grace_end = p["coverage_end_epoch"] + p["claim_grace"]
    advance(grace_end - now())
    assert now() == grace_end and now() > p["coverage_end_epoch"]
    assert submit(module, c, a)["version"] == 1
    assert policy(c, a)["last_claim_epoch"] == grace_end
    advance(1)
    refused(module, c, b, demo_sources(),
            "the claim grace after the coverage period has passed")
    untouched(c, b)
    conserve(module, c)


def test_intake_fetches_nothing(module, c):
    claimed(module, c)
    assert fetches() == []


# ── the event window ─────────────────────────────────────────────────────────

def test_an_event_window_starting_before_the_coverage_period_is_refused(module, c):
    pid = ready(module, c)
    start, end = event_window(c, pid)
    refused(module, c, pid, demo_sources(),
            "the event window must lie inside the coverage period", start=start - 1)
    untouched(c, pid)
    conserve(module, c)


def test_an_event_window_ending_after_the_coverage_period_is_refused(module, c):
    pid = ready(module, c)
    p = policy(c, pid)
    refused(module, c, pid, demo_sources(),
            "the event window must lie inside the coverage period",
            start=p["coverage_start_epoch"], end=p["coverage_end_epoch"] + 1)
    untouched(c, pid)


def test_an_event_window_at_the_edges_of_the_coverage_period_is_accepted(module, c):
    pid = activated(module, c)
    p = policy(c, pid)
    advance(COVER_LEN)
    assert now() == p["coverage_end_epoch"]
    submit(module, c, pid, start=p["coverage_start_epoch"],
           end=p["coverage_end_epoch"])
    q = policy(c, pid)
    assert q["event_start_epoch"] == p["coverage_start_epoch"]
    assert q["event_end_epoch"] == p["coverage_end_epoch"]
    conserve(module, c)


def test_an_event_window_must_end_after_it_starts(module, c):
    pid = ready(module, c)
    start, _ = event_window(c, pid)
    refused(module, c, pid, demo_sources(),
            "the event window must end after it starts",
            start=start + 100, end=start + 100)
    refused(module, c, pid, demo_sources(),
            "the event window must end after it starts",
            start=start + 200, end=start + 100)
    untouched(c, pid)


def test_an_event_window_longer_than_thirty_days_is_refused(module, c):
    assert module.MAX_EVENT_WINDOW_SECONDS == 2_592_000
    pid = activated(module, c, cover_len=2_600_000)
    p = policy(c, pid)
    start = p["coverage_start_epoch"]
    refused(module, c, pid, demo_sources(),
            "the event window may span at most 2592000 seconds",
            start=start, end=start + module.MAX_EVENT_WINDOW_SECONDS + 1)
    untouched(c, pid)
    conserve(module, c)


def test_an_event_window_of_exactly_thirty_days_is_accepted(module, c):
    pid = activated(module, c, cover_len=2_600_000)
    p = policy(c, pid)
    start = p["coverage_start_epoch"]
    advance(module.MAX_EVENT_WINDOW_SECONDS)
    submit(module, c, pid, start=start,
           end=start + module.MAX_EVENT_WINDOW_SECONDS)
    q = policy(c, pid)
    assert q["event_end_epoch"] - q["event_start_epoch"] == module.MAX_EVENT_WINDOW_SECONDS
    conserve(module, c)


def test_an_event_window_that_is_not_over_is_refused_and_the_clock_is_echoed(module, c):
    pid = activated(module, c)
    start, end = event_window(c, pid)
    assert end > now()
    msg = refused(module, c, pid, demo_sources(),
                  r"the event window is not over yet \(clock reads %d\)" % now())
    assert str(now()) in msg
    untouched(c, pid)
    conserve(module, c)


def test_an_event_window_ending_exactly_now_is_accepted(module, c):
    pid = activated(module, c)
    start, end = event_window(c, pid)
    advance(end - now())
    assert now() == end
    assert submit(module, c, pid)["version"] == 1
    assert policy(c, pid)["event_end_epoch"] == now()
    conserve(module, c)


# ── versions ─────────────────────────────────────────────────────────────────

def test_after_an_undetermined_hold_the_policy_accepts_a_second_version(module, c):
    pid = investigated(module, c, ans=answer(evidence="PARTIAL"))
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert c.promote(pid) == "undetermined"
    assert policy(c, pid)["status"] == "ACTIVE"
    out = submit(module, c, pid,
                 [source(PROVIDER_URL, "provider history"), source(NEWS_URL, "press")],
                 claimed_reading=161)
    p = policy(c, pid)
    assert out["version"] == 2
    assert p["evidence_version"] == 2 and p["judged_version"] == 1
    assert p["evidence_root"] == package(c, pid, 2)["root"]
    assert p["claimed_reading"] == 161 and p["status"] == "INVESTIGATING"
    assert package(c, pid, 1)["version"] == 1
    conserve(module, c)


def test_the_record_holds_at_most_six_versions(module, c):
    assert module.MAX_VERSIONS == 6
    pid = claimed(module, c, grace=86_400)
    panel_says(answer(evidence="PARTIAL"))
    for v in range(2, 8):
        as_(module, STRANGER, 0)
        c.investigate(pid)
        advance(W + 1)
        as_(module, STRANGER, 0)
        assert c.promote(pid) == "undetermined"
        if v <= module.MAX_VERSIONS:
            assert submit(module, c, pid, claimed_reading=150 + v)["version"] == v
        else:
            refused(module, c, pid, demo_sources(), "at most 6 versions",
                    claimed_reading=150 + v)
    p = policy(c, pid)
    assert p["evidence_version"] == 6 and p["claimed_reading"] == 156
    assert [package(c, pid, v)["claimed_reading"] for v in range(2, 7)] == [
        152, 153, 154, 155, 156]
    assert c.get_package(pid, 7) == ""
    conserve(module, c)


# ── the claimed reading ──────────────────────────────────────────────────────

def test_the_claimed_reading_must_be_a_number_inside_its_bounds(module, c):
    pid = ready(module, c)
    for bad in (-1, module.MAX_READING + 1, "abc", "4.5", None):
        refused(module, c, pid, demo_sources(), "claimed reading out of bounds",
                claimed_reading=bad)
    untouched(c, pid)
    conserve(module, c)


def test_the_claimed_reading_accepts_zero_and_the_ceiling(module, c):
    low = ready(module, c)
    submit(module, c, low, claimed_reading=0)
    assert policy(c, low)["claimed_reading"] == 0
    high = ready(module, c)
    submit(module, c, high, claimed_reading=module.MAX_READING)
    assert policy(c, high)["claimed_reading"] == module.MAX_READING
    conserve(module, c)


def test_a_numeric_string_is_a_reading_because_the_cli_sends_strings(module, c):
    pid = ready(module, c)
    submit(module, c, pid, claimed_reading="157")
    assert policy(c, pid)["claimed_reading"] == 157
    assert package(c, pid, 1)["claimed_reading"] == 157


# ── the sources JSON ─────────────────────────────────────────────────────────

def test_sources_must_be_a_json_array_of_one_to_six_rows(module, c):
    pid = ready(module, c)
    refused(module, c, pid, None, "sources must be a JSON array",
            raw="not json at all")
    refused(module, c, pid, None, "sources must be a JSON array",
            raw="[{url: https://agency.example.org/x}]")
    for not_an_array in (json.dumps(source(AGENCY_URL, "an object")),
                         json.dumps(AGENCY_URL), json.dumps(7), "null"):
        refused(module, c, pid, None, "name 1-6 sources", raw=not_an_array)
    refused(module, c, pid, [], "name 1-6 sources")
    pages = [source(f"{A}/bulletins/p{i}.txt", f"page {i}") for i in range(7)]
    refused(module, c, pid, pages, "name 1-6 sources")
    untouched(c, pid)
    submit(module, c, pid, pages[:6])
    assert [r["id"] for r in package(c, pid, 1)["rows"]] == [
        "EV-001", "EV-002", "EV-003", "EV-004", "EV-005", "EV-006"]
    conserve(module, c)


def test_every_row_must_be_an_object_and_the_refusal_names_the_row(module, c):
    pid = ready(module, c)
    refused(module, c, pid, [42], "source 0 is not an object")
    refused(module, c, pid, [source(AGENCY_URL, "agency"), AGENCY_URL],
            "source 1 is not an object")
    refused(module, c, pid, [source(AGENCY_URL, "agency"), None],
            "source 1 is not an object")
    refused(module, c, pid, [source(AGENCY_URL, "agency"), [AGENCY_URL]],
            "source 1 is not an object")
    untouched(c, pid)


@pytest.mark.parametrize("bad", [
    "agency.example.org/bulletins/samar.txt",          # no scheme
    "//agency.example.org/bulletins/samar.txt",        # scheme-relative
    "ftp://agency.example.org/bulletins/samar.txt",    # not http(s)
    "HTTPS://agency.example.org/bulletins/samar.txt",  # the scheme is matched case-sensitively
    "https://agency.example.org/café",                 # non-ASCII
    "https://agency.example.org/a b",                  # space
    "https://agency.example.org/a\tb",                 # control character
    "https://agency.example.org/x'y",                  # quote
    'https://agency.example.org/x"y',                  # double quote
    "https://agency.example.org/`x`",                  # backtick
    "https://agency.example.org/<x>",                  # angle bracket
    "https://agency.example.org/a|b",                  # the fence header delimiter
    "https://agency.example.org/a\\b",                 # backslash
    "https://a.b",                                     # 11 chars, one short
    "https://agency.example.org/" + "a" * 374,         # 401 chars, one over
    12345,                                             # not even a string
], ids=["no-scheme", "scheme-relative", "ftp", "upper-scheme", "non-ascii", "space",
        "tab", "quote", "dquote", "backtick", "angle", "pipe", "backslash", "short",
        "long", "number"])
def test_url_spellings_the_intake_refuses(module, c, bad):
    pid = ready(module, c)
    # a good row ahead of the bad one saves nothing: the package is refused whole
    refused(module, c, pid, [source(AGENCY_URL, "agency"), source(bad, "some label")],
            "source 1: url must be http")
    untouched(c, pid)


def test_a_row_without_a_url_is_refused_at_the_url_wall(module, c):
    pid = ready(module, c)
    refused(module, c, pid, [{"label": "no url at all"}], "source 0: url must be http")
    untouched(c, pid)


def test_the_url_length_cap_is_inclusive(module, c):
    pid = ready(module, c)
    longest = "https://agency.example.org/" + "a" * 373
    assert len(longest) == module.MAX_URL_CHARS == 400
    assert submit(module, c, pid, [source(longest, "at the cap")])["version"] == 1
    assert package(c, pid, 1)["rows"][0]["url"] == longest


def test_every_row_needs_a_label_within_eighty_chars(module, c):
    pid = ready(module, c)
    refused(module, c, pid, [{"url": AGENCY_URL}], "source 0 needs a label")
    refused(module, c, pid, [source(AGENCY_URL, "   ")], "source 0 needs a label")
    refused(module, c, pid,
            [source(AGENCY_URL, "fine"), source(PROVIDER_URL, "x" * 81)],
            "source 1 needs a label")
    untouched(c, pid)
    submit(module, c, pid, [source(AGENCY_URL, "  " + "x" * 80 + "  ")])
    assert package(c, pid, 1)["rows"][0]["label"] == "x" * 80


# ── finding the basis entry ──────────────────────────────────────────────────

def test_a_row_inherits_kind_and_class_from_the_origin_its_host_equals(module, c):
    pid = claimed(module, c)
    agency, provider, news, station = package(c, pid, 1)["rows"]
    assert agency["host"] == "agency.example.org"
    assert agency["origin"] == "agency.example.org"
    assert agency["kind"] == "METEOROLOGICAL_AGENCY" and agency["cls"] == "INDEPENDENT"
    assert agency["domain"] == "example.org"
    assert provider["kind"] == "WEATHER_PROVIDER" and provider["cls"] == "INDEPENDENT"
    assert provider["domain"] == "example.net"
    assert news["kind"] == "NEWS_REPORT" and news["cls"] == "INDEPENDENT"
    assert station["host"] == "station.example.com"
    assert station["kind"] == "STATION_LOG" and station["cls"] == "PARTY"
    # news and the station share a publisher; only the class separates them
    assert news["domain"] == station["domain"] == "example.com"
    assert set(demo_sources()[0]) == {"url", "label"}


def test_a_row_cannot_declare_its_own_kind_or_class(module, c):
    pid = ready(module, c)
    dressed = dict(source(STATION_URL, "station log"),
                   kind="METEOROLOGICAL_AGENCY", cls="INDEPENDENT",
                   **{"class": "INDEPENDENT"})
    refused(module, c, pid, [dressed], "INDEPENDENT origin")
    submit(module, c, pid, [source(AGENCY_URL, "agency"), dressed])
    row = package(c, pid, 1)["rows"][1]
    assert row["kind"] == "STATION_LOG" and row["cls"] == "PARTY"
    assert "class" not in row
    conserve(module, c)


def test_a_subdomain_of_an_origin_is_inside_it_and_inherits_kind_and_class(module, c):
    pid = ready(module, c)
    submit(module, c, pid, [source(AGENCY_SUB, "agency data tables"),
                            source(STATION_CDN, "station mirror")])
    tables, mirror = package(c, pid, 1)["rows"]
    assert tables["host"] == "data.agency.example.org"
    assert tables["origin"] == "agency.example.org"
    assert tables["kind"] == "METEOROLOGICAL_AGENCY" and tables["cls"] == "INDEPENDENT"
    assert tables["domain"] == "example.org"
    assert mirror["host"] == "cdn.station.example.com"
    assert mirror["origin"] == "station.example.com"
    assert mirror["kind"] == "STATION_LOG" and mirror["cls"] == "PARTY"


def test_a_subdomain_of_a_party_origin_alone_cannot_carry_a_payout(module, c):
    pid = ready(module, c)
    refused(module, c, pid, [source(STATION_CDN, "station mirror")], "INDEPENDENT origin")
    untouched(c, pid)


def test_a_host_that_merely_ends_with_the_origin_text_is_outside_the_basis(module, c):
    pid = ready(module, c)
    msg = refused(module, c, pid,
                  [source("https://notagency.example.org/bulletins/samar.txt", "lookalike")],
                  "outside the agreed evidence basis")
    assert "source 0: notagency.example.org is outside" in msg
    untouched(c, pid)


@pytest.mark.parametrize("url", [
    "https://example.org/bulletins/samar.txt",             # the origin's parent
    "https://agency.example.org.evil.io/bulletins",        # the origin as a prefix
    "https://agency.example.net/bulletins",                # the origin's TLD swapped
    "https://other.example.io/bulletins",                  # unrelated publisher
    "https://agency.example.org@evil.io/bulletins",        # userinfo cannot smuggle a host
    "https://agency.example.org%40evil.io/bulletins",      # nor its encoded form
    "https://evil.io/#@agency.example.org/bulletins",      # nor a fragment
    "https://agency.example.org./bulletins",               # the FQDN spelling is not matched
], ids=["parent", "prefix", "tld-swap", "unrelated", "userinfo", "encoded-at",
        "fragment-at", "trailing-dot"])
def test_an_off_basis_host_is_refused_and_nothing_is_written(module, c, url):
    pid = ready(module, c)
    refused(module, c, pid, [source(AGENCY_URL, "agency"), source(url, "x")],
            "source 1: .* is outside the agreed evidence basis")
    untouched(c, pid)


def test_a_query_before_any_path_cannot_smuggle_an_off_basis_host(module, c):
    pid = ready(module, c)
    msg = refused(module, c, pid,
                  [source("https://evil.io?x=@agency.example.org", "smuggled")],
                  "outside the agreed evidence basis")
    assert "source 0: evil.io is outside" in msg
    untouched(c, pid)
    conserve(module, c)


def test_the_longest_matching_origin_wins_when_origins_nest(module, c):
    for basis in (NESTED_BASIS, list(reversed(NESTED_BASIS))):
        pid = ready(module, c, basis=basis)
        submit(module, c, pid, [
            source("https://data.example.org/figures", "publisher data"),
            source("https://agency.example.org/bulletin", "agency bulletin"),
            source("https://deep.agency.example.org/annex", "agency annex"),
        ])
        data, agency, deep = package(c, pid, 1)["rows"]
        assert data["origin"] == "example.org"
        assert data["kind"] == "OTHER" and data["cls"] == "INDEPENDENT"
        assert agency["origin"] == "agency.example.org"
        assert agency["kind"] == "STATION_LOG" and agency["cls"] == "PARTY"
        assert deep["origin"] == "agency.example.org" and deep["cls"] == "PARTY"
        assert {r["domain"] for r in (data, agency, deep)} == {"example.org"}
    conserve(module, c)


def test_under_a_nested_basis_the_inherited_class_decides_the_party_wall(module, c):
    pid = ready(module, c, basis=NESTED_BASIS)
    refused(module, c, pid,
            [source("https://agency.example.org/bulletin", "bulletin"),
             source("https://deep.agency.example.org/annex", "annex")],
            "INDEPENDENT origin")
    untouched(c, pid)
    submit(module, c, pid, [source("https://agency.example.org/bulletin", "bulletin"),
                            source("https://www.example.org/figures", "figures")])
    assert [r["cls"] for r in package(c, pid, 1)["rows"]] == ["PARTY", "INDEPENDENT"]


def test_the_publisher_of_a_co_uk_origin_keeps_its_second_level(module, c):
    pid = ready(module, c, basis=UK_BASIS)
    submit(module, c, pid,
           [source("https://api.metoffice.example.co.uk/bulletins/samar", "bulletins")])
    row = package(c, pid, 1)["rows"][0]
    assert row["host"] == "api.metoffice.example.co.uk"
    assert row["origin"] == "metoffice.example.co.uk"
    assert row["domain"] == "example.co.uk"


# ── S35: one page is one source ──────────────────────────────────────────────

@pytest.mark.parametrize("twin", [
    AGENCY_URL,
    "  " + AGENCY_URL + "  ",
    "https://AGENCY.EXAMPLE.ORG/bulletins/2026/typhoon-07/samar.txt",
    "https://agency.example.org:443/bulletins/2026/typhoon-07/samar.txt",
    AGENCY_URL + "#summary",
    AGENCY_URL + "/",
    "https://viewer@agency.example.org/bulletins/2026/typhoon-07/samar.txt",
    "https://Agency.Example.ORG:443/bulletins/2026/typhoon-07/samar.txt/#top",
], ids=["verbatim", "padded", "upper-host", "port-443", "fragment", "trailing-slash",
        "userinfo", "all-at-once"])
def test_a_second_spelling_of_a_page_already_in_the_package_is_refused(module, c, twin):
    pid = ready(module, c)
    msg = refused(module, c, pid,
                  [source(AGENCY_URL, "agency"), source(twin, "the same page again")],
                  "already in the record")
    assert f"source 1: {AGENCY_URL} is already in the record" in msg
    untouched(c, pid)


def test_the_odd_spelling_may_come_first_and_the_canonical_one_is_the_duplicate(module, c):
    pid = ready(module, c)
    refused(module, c, pid,
            [source(AGENCY_URL + "/#top", "first"), source(AGENCY_URL, "second")],
            re.escape(f"source 1: {AGENCY_URL} is already in the record"))
    untouched(c, pid)


def test_the_duplicate_refusal_names_the_offending_row(module, c):
    pid = ready(module, c)
    refused(module, c, pid,
            [source(PROVIDER_URL, "provider"), source(AGENCY_URL, "agency"),
             source(AGENCY_URL + "#again", "again")],
            re.escape(f"source 2: {AGENCY_URL} is already in the record"))
    untouched(c, pid)


def test_an_origin_root_with_and_without_its_slash_is_one_page(module, c):
    pid = ready(module, c)
    refused(module, c, pid, [source(A, "root"), source(A + "/", "root again")],
            re.escape("source 1: https://agency.example.org/ is already in the record"))
    submit(module, c, pid, [source(A, "root")])
    assert package(c, pid, 1)["rows"][0]["norm_url"] == "https://agency.example.org/"


def test_an_uppercase_scheme_never_reaches_the_record(module, c):
    # refused at the URL wall, so normalization never has to fold it — and
    # would, if it did
    pid = ready(module, c)
    refused(module, c, pid,
            [source("HTTPS://agency.example.org/bulletins/samar.txt", "shouted")],
            "url must be http")
    untouched(c, pid)
    assert module._normalize_url("HTTPS://agency.example.org/x") == \
        "https://agency.example.org/x"


def test_two_different_pages_on_one_origin_are_two_rows_with_one_publisher(module, c):
    pid = ready(module, c)
    submit(module, c, pid, [source(AGENCY_URL, "bulletin"),
                            source(AGENCY_URL_TWIN, "bulletin summary"),
                            source(AGENCY_SUB, "agency tables"),
                            source(PROVIDER_URL, "provider history")])
    rows = package(c, pid, 1)["rows"]
    assert [r["id"] for r in rows] == ["EV-001", "EV-002", "EV-003", "EV-004"]
    assert len({r["norm_url"] for r in rows}) == 4
    assert [r["host"] for r in rows[:3]] == [
        "agency.example.org", "agency.example.org", "data.agency.example.org"]
    assert {r["origin"] for r in rows[:3]} == {"agency.example.org"}
    assert {r["domain"] for r in rows[:3]} == {"example.org"}
    assert rows[3]["domain"] == "example.net"
    # four independent rows, two publishers: what corroboration counts
    assert len({r["domain"] for r in rows if r["cls"] == "INDEPENDENT"}) == 2


def test_a_query_string_and_a_non_default_port_distinguish_pages(module, c):
    pid = ready(module, c)
    refused(module, c, pid, [source(AGENCY_URL + "?rev=2", "a"),
                             source(AGENCY_URL + "?rev=2#x", "b")],
            "already in the record")
    submit(module, c, pid, [
        source(AGENCY_URL, "plain"),
        source(AGENCY_URL + "?rev=2", "revision two"),
        source(AGENCY_URL + "?REV=2", "revision two, shouted"),
        source("https://agency.example.org:8443/bulletins/2026/typhoon-07/samar.txt",
               "mirror port"),
    ])
    rows = package(c, pid, 1)["rows"]
    assert len(rows) == 4 and len({r["norm_url"] for r in rows}) == 4
    assert rows[1]["norm_url"] == AGENCY_URL + "?rev=2"
    assert rows[2]["norm_url"] == AGENCY_URL + "?REV=2"
    mirror = rows[3]
    assert mirror["host"] == "agency.example.org"
    assert mirror["origin"] == "agency.example.org"
    assert mirror["norm_url"] == \
        "https://agency.example.org:8443/bulletins/2026/typhoon-07/samar.txt"


# ── the independence wall at intake ──────────────────────────────────────────

def test_a_package_of_party_rows_only_cannot_carry_a_payout(module, c):
    pid = ready(module, c)
    refused(module, c, pid, [source(STATION_URL, "station log"),
                             source(STATION_URL_2, "station log, next day")],
            "INDEPENDENT origin")
    p = policy(c, pid)
    assert p["evidence_version"] == 0 and p["evidence_root"] == ""
    assert p["last_claim_epoch"] == 0 and c.get_package(pid, 1) == ""
    conserve(module, c)
    submit(module, c, pid, [source(STATION_URL, "station log"),
                            source(AGENCY_URL, "agency bulletin")])
    assert [r["cls"] for r in package(c, pid, 1)["rows"]] == ["PARTY", "INDEPENDENT"]
    conserve(module, c)


# ── the stored package ───────────────────────────────────────────────────────

def test_package_structure_binds_the_whole_claim(module, c):
    pid = activated(module, c)
    start, end = event_window(c, pid)
    advance(end - now() + 50)
    out = submit(module, c, pid)
    pkg = package(c, pid, 1)
    assert out == {"version": 1, "root": pkg["root"]}
    assert pkg["policy_id"] == pid and pkg["version"] == 1
    assert pkg["event_start_epoch"] == start and pkg["event_end_epoch"] == end
    assert pkg["claimed_reading"] == 157 and pkg["filed_by"] == "policyholder"
    assert pkg["rows"][0] == {
        "id": "EV-001", "url": AGENCY_URL, "norm_url": AGENCY_URL,
        "host": "agency.example.org", "domain": "example.org",
        "origin": "agency.example.org", "kind": "METEOROLOGICAL_AGENCY",
        "cls": "INDEPENDENT", "label": "Agency bulletin 07", "added_version": 1,
    }
    assert [r["id"] for r in pkg["rows"]] == ["EV-001", "EV-002", "EV-003", "EV-004"]
    assert pkg["rows"][3]["cls"] == "PARTY"
    assert set(pkg) == {"policy_id", "version", "event_start_epoch",
                        "event_end_epoch", "claimed_reading", "filed_by",
                        "rows", "root"}
    conserve(module, c)


def test_the_root_is_the_canonical_package_and_moves_with_a_label_or_a_reading(module, c):
    pid = claimed(module, c)
    pkg = package(c, pid, 1)
    unrooted = dict(pkg)
    root = unrooted.pop("root")
    assert len(root) == 64
    assert root == module._sha256_hex(module._canonical(unrooted))
    tampered = json.loads(json.dumps(unrooted))
    tampered["rows"][0]["label"] = "Agency bulletin 07."
    assert module._sha256_hex(module._canonical(tampered)) != root
    tampered = json.loads(json.dumps(unrooted))
    tampered["claimed_reading"] = 158
    assert module._sha256_hex(module._canonical(tampered)) != root
    tampered = json.loads(json.dumps(unrooted))
    tampered["event_end_epoch"] += 1
    assert module._sha256_hex(module._canonical(tampered)) != root


def test_the_policy_mirrors_the_package_and_moves_to_investigating(module, c):
    pid = activated(module, c)
    start, end = event_window(c, pid)
    advance(end - now() + 1)
    submit(module, c, pid, claimed_reading=161)
    pkg = package(c, pid, 1)
    p = policy(c, pid)
    assert p["status"] == "INVESTIGATING"
    assert p["evidence_version"] == 1 and p["evidence_root"] == pkg["root"]
    assert p["claimed_reading"] == 161
    assert p["event_start_epoch"] == start and p["event_end_epoch"] == end
    assert p["last_claim_epoch"] == now()
    assert p["judged_version"] == 0 and p["outcome"] == ""
    conserve(module, c)


def test_a_second_version_is_a_whole_replacement_and_the_first_stays_readable(module, c):
    pid = investigated(module, c, ans=answer(evidence="PARTIAL"))
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.promote(pid)
    v1 = package(c, pid, 1)
    advance(120)
    out = submit(module, c, pid, [source(NEWS_URL, "press report"),
                                  source(AGENCY_URL, "agency bulletin")],
                 claimed_reading=161)
    v2 = package(c, pid, 2)
    assert out == {"version": 2, "root": v2["root"]}
    assert v2["version"] == 2 and v2["claimed_reading"] == 161
    assert [r["url"] for r in v2["rows"]] == [NEWS_URL, AGENCY_URL]
    assert PROVIDER_URL not in [r["url"] for r in v2["rows"]]
    # a version is a whole package: ids restart, nothing is appended
    assert [r["id"] for r in v2["rows"]] == ["EV-001", "EV-002"]
    assert all(r["added_version"] == 2 for r in v2["rows"])
    assert package(c, pid, 1) == v1 and v1["root"] != v2["root"]
    p = policy(c, pid)
    assert p["evidence_version"] == 2 and p["evidence_root"] == v2["root"]
    assert p["last_claim_epoch"] == now()
    conserve(module, c)


def test_get_package_is_empty_for_a_version_that_does_not_exist(module, c):
    pid = ready(module, c)
    assert c.get_package(pid, 1) == "" and package(c, pid, 1) is None
    submit(module, c, pid)
    assert c.get_package(pid, 1) != ""
    for missing in (0, 2, 99, -1, "not-a-number", None):
        assert c.get_package(pid, missing) == ""
    assert c.get_package("trg-999999", 1) == ""


# ── pure helpers ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,norm", [
    ("HTTPS://AGENCY.EXAMPLE.ORG/Bul/X", "https://agency.example.org/Bul/X"),
    (A + ":443/x", A + "/x"),
    ("http://agency.example.org:80/x", "http://agency.example.org/x"),
    ("https://agency.example.org:80/x", "https://agency.example.org:80/x"),
    ("http://agency.example.org:443/x", "http://agency.example.org:443/x"),
    (A + ":8443/x", A + ":8443/x"),
    (A + "/x#frag", A + "/x"),
    (A + "/x/", A + "/x"),
    (A + "/", A + "/"),
    (A, A + "/"),
    (A + "/x?b=2&a=1", A + "/x?b=2&a=1"),
    (A + "/x?", A + "/x"),
    (A + "/x?q=1#f", A + "/x?q=1"),
    (A + "/x/?q=1", A + "/x?q=1"),
    ("  " + A + "/x  ", A + "/x"),
    ("https://user:pw@agency.example.org/x", A + "/x"),
    ("https://agency.example.org@evil.io/x", "https://evil.io/x"),
    (A + "/x@y", A + "/x@y"),
    ("https://evil.io?x=@agency.example.org", "https://evil.io/?x=@agency.example.org"),
], ids=["case", "443", "80", "80-on-https", "443-on-http", "8443", "fragment", "slash",
        "root", "no-path", "query-kept", "empty-query", "query-then-fragment",
        "slash-before-query", "padding", "userinfo", "userinfo-host", "at-in-path",
        "query-smuggle"])
def test_normalize_url_is_idempotent_over_the_spellings_it_folds(module, raw, norm):
    assert module._normalize_url(raw) == norm
    assert module._normalize_url(norm) == norm


def test_normalize_url_drops_exactly_one_trailing_slash(module):
    # "/x//" is a different path from "/x/" to an origin server; only the
    # last slash is a spelling
    assert module._normalize_url(A + "/x//") == A + "/x/"
    assert module._normalize_url(A + "/x/") == A + "/x"


def test_normalize_url_keeps_the_scheme_and_the_path_case(module):
    n = module._normalize_url
    assert n("http://agency.example.org/x") != n("https://agency.example.org/x")
    assert n(A + "/X") != n(A + "/x")
    assert n(A + "/x?Q=1") != n(A + "/x?q=1")


@pytest.mark.parametrize("url,host", [
    (A + "/x", "agency.example.org"),
    ("https://AGENCY.Example.org/x", "agency.example.org"),
    (A + ":8443/x", "agency.example.org"),
    ("https://viewer@agency.example.org/x", "agency.example.org"),
    ("https://agency.example.org@evil.io/x", "evil.io"),
    (A + "/x@y", "agency.example.org"),
    (A + "/x?u=a@agency.example.org", "agency.example.org"),
    (A, "agency.example.org"),
    (A + "#@evil.io", "agency.example.org"),
    ("https://evil.io?x=@agency.example.org", "evil.io"),
], ids=["plain", "case", "port", "userinfo", "userinfo-host", "at-in-path",
        "at-in-query", "no-path", "at-in-fragment", "query-smuggle"])
def test_host_of(module, url, host):
    assert module._host_of(url) == host


@pytest.mark.parametrize("host,domain", [
    ("data.agency.example.org", "example.org"),
    ("agency.example.org", "example.org"),
    ("deep.data.agency.example.org", "example.org"),
    ("a.b.c.example.com", "example.com"),
    ("example.com", "example.com"),
    ("a.metoffice.example.co.uk", "example.co.uk"),
    ("example.co.uk", "example.co.uk"),
    ("x.y.co.jp", "y.co.jp"),
    ("x.y.ac.uk", "y.ac.uk"),
    ("data.agency.gov.br", "agency.gov.br"),
    ("www.example.io", "example.io"),
    ("localhost", "localhost"),
    ("", ""),
    ("agency.example.org:8443", "example.org"),
    ("AGENCY.Example.ORG", "example.org"),
    ("station.example.com", "example.com"),
], ids=["sub", "agency", "deep", "deep-com", "bare", "co-uk", "bare-co-uk", "co-jp",
        "ac-uk", "gov-br", "two-letter-tld", "single-label", "empty", "port", "case",
        "station"])
def test_registrable_domain(module, host, domain):
    assert module._registrable_domain(host) == domain


def test_two_hosts_of_one_publisher_share_a_registrable_domain(module):
    rd = module._registrable_domain
    assert rd("agency.example.org") == rd("data.agency.example.org") == rd("example.org")
    assert rd("agency.example.org") != rd("weather.example.net")
    assert rd("agency.example.org") != rd("agency.example.com")
    # the basis pairs one publisher with two classes: news and the station
    assert rd("news.example.com") == rd("station.example.com")


@pytest.mark.parametrize("host,origin,ok", [
    ("agency.example.org", "agency.example.org", True),
    ("data.agency.example.org", "agency.example.org", True),
    ("a.b.agency.example.org", "agency.example.org", True),
    ("agency.example.org", "example.org", True),
    ("notagency.example.org", "agency.example.org", False),
    ("agency.example.org.evil.io", "agency.example.org", False),
    ("example.org", "agency.example.org", False),
    ("agency.example.net", "agency.example.org", False),
    ("agency.example.org.", "agency.example.org", False),
    ("AGENCY.example.org", "agency.example.org", False),   # callers lowercase first
    ("", "agency.example.org", False),
    ("evil.io", "agency.example.org", False),
], ids=["exact", "sub", "deep-sub", "sub-of-parent", "no-dot-boundary", "prefix",
        "parent-of-origin", "tld-swap", "trailing-dot", "case", "empty-host", "smuggle"])
def test_matches_origin(module, host, origin, ok):
    assert module._matches_origin(host, origin) is ok


@pytest.mark.parametrize("url,ok", [
    (A + "/x", True),
    ("http://agency.example.org/x", True),
    ("https://ab.c", True),                                      # 12 chars, the floor
    ("https://a.b", False),                                      # 11 chars
    ("https://agency.example.org/" + "a" * 373, True),           # 400 chars, the cap
    ("https://agency.example.org/" + "a" * 374, False),          # 401 chars
    (A + "/x?q=1&r=2#frag", True),
    (A + "/~user/%20x", True),
    ("https://xn--bcher-kva.example/x", True),                   # punycode is ASCII
    ("agency.example.org/x", False),
    ("//agency.example.org/x", False),
    ("ftp://agency.example.org/x", False),
    ("HTTPS://agency.example.org/x", False),
    ("Https://agency.example.org/x", False),
    (A + "/café", False),
    (A + "/a b", False),
    (A + "/a\tb", False),
    (A + "/a\nb", False),
    (A + "/x'y", False),
    (A + '/x"y', False),
    (A + "/`x`", False),
    (A + "/<x>", False),
    (A + "/a|b", False),
    (A + "/a\\b", False),
    ("", False),
], ids=["https", "http", "floor", "below-floor", "cap", "above-cap", "query-fragment",
        "tilde-percent", "punycode", "no-scheme", "scheme-relative", "ftp",
        "upper-scheme", "mixed-scheme", "non-ascii", "space", "tab", "newline",
        "quote", "dquote", "backtick", "angle", "pipe", "backslash", "empty"])
def test_valid_url(module, url, ok):
    assert module._valid_url(url) is ok


@pytest.mark.parametrize("origin,ok", [
    ("agency.example.org", True),
    ("a.bc", True),                                # 4 chars, the floor
    ("a.b", False),                                # 3 chars
    ("a" * 116 + ".org", True),                    # 120 chars, the cap
    ("a" * 117 + ".org", False),                   # 121 chars
    ("ex-am.ple.org", True),
    ("x1.y2", True),
    ("192.168.0.1", True),
    ("localhost", False),                          # no dot
    (".example.org", False),
    ("example.org.", False),
    ("example..org", False),
    ("Example.org", False),                        # the helper lowercases nothing
    ("ex_ample.org", False),
    ("-ex.example.org", False),
    ("ex-.example.org", False),
    ("agency.example.org:443", False),
    ("https://agency.example.org", False),
    ("agency.example.org/", False),
    ("agency example.org", False),
    ("", False),
], ids=["plain", "floor", "below-floor", "cap", "above-cap", "hyphen", "digits",
        "ipv4", "no-dot", "leading-dot", "trailing-dot", "empty-label", "uppercase",
        "underscore", "label-leading-hyphen", "label-trailing-hyphen", "port",
        "scheme", "slash", "space", "empty"])
def test_valid_origin(module, origin, ok):
    assert module._valid_origin(origin) is ok


def test_split_url_cuts_the_authority_at_the_first_delimiter(module):
    s = module._split_url
    assert s(A + "/bulletins?q=1#f") == ("https", "agency.example.org", "", "/bulletins", "q=1")
    assert s(A + ":8443/x") == ("https", "agency.example.org", "8443", "/x", "")
    assert s("HTTPS://AGENCY.EXAMPLE.ORG/X") == ("https", "agency.example.org", "", "/X", "")
    assert s(A) == ("https", "agency.example.org", "", "/", "")
    assert s("https://user:pw@agency.example.org/x") == (
        "https", "agency.example.org", "", "/x", "")


def test_split_url_reports_the_host_every_node_would_actually_fetch(module):
    # cutting the authority at '/' alone would let this URL strip its
    # "userinfo" inside the query and report the basis host
    assert module._split_url("https://evil.io?x=@agency.example.org") == (
        "https", "evil.io", "", "/", "x=@agency.example.org")
    assert module._host_of("https://evil.io?x=@agency.example.org") == "evil.io"
    assert module._matches_origin("evil.io", "agency.example.org") is False
