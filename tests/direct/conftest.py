"""Direct-mode harness: the real contract module run against a stub
`genlayer` that is AS STRICT AS the runtime where it matters — DynArray
refuses user construction, unknown gl attributes raise, validator functions
actually run, and a validator returning False surfaces as a failed round
rather than a settled state.

The stub mirrors the v0.6 SDK the contract targets (`import genlayer as gl`,
`gl.contract.Contract`, `gl.storage.allow`, `gl.vm.run_nondet`, UserError
carrying its text in `.data`).

Two things are mocked with intent:

  THE WEB. `gl.nondet.web.render(url)` answers the consensus clock sources
  from a controllable test clock, and every other URL from a page table the
  test fills (`page(url, text)`). A URL not in the table is unreachable. Every
  fetch is LOGGED (`fetches()`), so a test can prove that an appeal round
  re-read the recorded snapshot and did NOT refetch the original sources.

  THE PANEL. Successive exec_prompt calls walk a queue and the last entry
  repeats, so a test can hand the leader and the validator different answers
  and prove the comparison logic notices.
"""

import importlib.util
import json
import pathlib
import sys
import types

import pytest

CONTRACT_PATH = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "triggera.py"

INSURER = "0x1111111111111111111111111111111111111111"
HOLDER = "0x2222222222222222222222222222222222222222"
STRANGER = "0x5555555555555555555555555555555555555555"

GEN = 10**18
COVERAGE = 10**17           # the canonical test coverage: 0.1 GEN
PREMIUM = 10**16            # 0.01 GEN
BOND = 5 * 10**16           # bond floor dominates at this coverage size
THRESHOLD = 150             # km/h
W = 900                     # every window at the enforced minimum
COVER_LEN = 7_200           # coverage period in the canonical draft
EVENT_LEN = 600             # the canonical event window

TERMS = (
    "STORMGUARD PROPERTY PROTECTION — parametric wind cover for the insured "
    "premises in Eastern Samar, Philippines. TRIGGER: the maximum sustained "
    "wind speed, as published for the insured area by the agreed sources, at "
    "or above 150 km/h over any 24-hour window inside the event window named "
    "in the claim. Gusts are read as sustained speed only where the source "
    "states the sustained figure; forecasts, warnings and outlooks do not "
    "count. PAYOUT: the whole coverage once the trigger is finalized. No "
    "damage assessment is made and none is required."
)

BASIS = [
    {"kind": "METEOROLOGICAL_AGENCY", "origin": "agency.example.org", "class": "INDEPENDENT"},
    {"kind": "WEATHER_PROVIDER", "origin": "weather.example.net", "class": "INDEPENDENT"},
    {"kind": "NEWS_REPORT", "origin": "news.example.com", "class": "INDEPENDENT"},
    {"kind": "STATION_LOG", "origin": "station.example.com", "class": "PARTY"},
]

AGENCY_URL = "https://agency.example.org/bulletins/2026/typhoon-07/samar.txt"
PROVIDER_URL = "https://weather.example.net/history/eastern-samar/2026-09-03"
NEWS_URL = "https://news.example.com/2026/09/04/typhoon-strikes-samar"
STATION_URL = "https://station.example.com/logs/premises-01/2026-09-03"
AGENCY_URL_TWIN = "https://agency.example.org/bulletins/2026/typhoon-07/samar-summary.txt"

AGENCY_PAGE = (
    "TROPICAL CYCLONE BULLETIN 07 — Eastern Samar. 24-hour summary ending "
    "2026-09-03 18:00 UTC. Maximum sustained wind speed observed at Guiuan "
    "station: 157 km/h. Peak gust: 191 km/h. Official observation."
)
PROVIDER_PAGE = (
    "WEATHER HISTORY — Eastern Samar, 2026-09-03. Highest 24-hour maximum "
    "sustained wind speed from our station network: 149 km/h at Borongan. "
    "Gusts to 178 km/h."
)
NEWS_PAGE = (
    "Typhoon strikes Samar: the provincial disaster office reported sustained "
    "winds of 161 km/h across Eastern Samar through the night of 3 September, "
    "the strongest in a decade."
)
STATION_PAGE = (
    "PREMISES STATION LOG — insured site, Eastern Samar. 2026-09-03: "
    "10-minute sustained wind maximum 153 km/h at 14:40 local; gust 182 km/h."
)

# Test wall-clock. Tests advance it to pass real time.
_NOW = [1_760_000_000]
_SKEW = {}
_DEAD = set()
_PAGES = {}
_FETCHES = []
_PANEL = []
_PANEL_CALLS = [0]
_SENT = []
_PROMPTS = []
_RUN_DRIFT = []
_RUN_INDEX = [-1]


class _UserError(Exception):
    """v0.6 shape: the text lives in .data; str() returns it so that
    pytest.raises(match=...) reads the message."""
    def __init__(self, data):
        super().__init__(data)
        self.data = data

    def __str__(self):
        return str(self.data)


class _VMError:
    def __init__(self, message):
        self.message = message


class _Return:
    def __init__(self, calldata):
        self.calldata = calldata


def _run_nondet(leader_fn, validator_fn):
    """gl.vm.run_nondet: the leader runs; the validator sees Return(value)
    or the leader's UserError instance and answers a bool. False (or an
    escaping exception) is a disagreement — the round fails and nothing is
    written. A leader failure the validator endorses propagates as that
    same error."""
    try:
        value = leader_fn()
    except _UserError as e:
        try:
            agreed = validator_fn(e)
        except Exception:
            agreed = False
        if agreed:
            raise _UserError(e.data)
        raise _UserError("[LLM_ERROR] validators disagreed with the leader's failure")
    except Exception as e:
        try:
            agreed = validator_fn(_VMError(str(e)))
        except Exception:
            agreed = False
        if agreed:
            raise _UserError(str(e))
        raise _UserError("[LLM_ERROR] validators disagreed with the leader's failure")
    try:
        ok = validator_fn(_Return(value))
    except Exception:
        ok = False
    if not ok:
        raise _UserError("[LLM_ERROR] validators did not agree with the leader")
    return value


class _TreeMap(dict):
    def get(self, k, default=None):
        return super().get(k, default)


class _U256(int):
    def __new__(cls, v):
        return super().__new__(cls, int(v))


class _I256(int):
    def __new__(cls, v):
        return super().__new__(cls, int(v))


class _DynArrayMeta(type):
    def __getitem__(cls, item):
        return cls


class _DynArray(list, metaclass=_DynArrayMeta):
    """Refuses user construction exactly like the runtime."""

    def __init__(self, *args, **kwargs):
        raise TypeError("this class can't be instantiated by user")

    @classmethod
    def _from_storage(cls, items=()):
        obj = list.__new__(cls)
        list.__init__(obj, items)
        return obj


class _TreeMapType(_TreeMap):
    """gl.TreeMap[K, V] in an annotation and gl.TreeMap() in a fixture."""
    def __class_getitem__(cls, item):
        return cls


class _Address(str):
    def __new__(cls, v):
        return super().__new__(cls, str(v))

    @property
    def as_hex(self):
        return str(self)


class _CliAddress:
    """What the genlayer CLI delivers for a 40-hex argument: an Address
    OBJECT with .as_hex and no str methods."""
    def __init__(self, hex_str):
        self.as_hex = hex_str

    def __repr__(self):
        return f"<Address {self.as_hex}>"


class _ViewDeco:
    def __call__(self, fn):
        return fn


class _WriteDeco:
    payable = staticmethod(lambda fn: fn)

    def __call__(self, fn):
        return fn


class _Public:
    view = _ViewDeco()
    write = _WriteDeco()


class _EvmProxyInstance:
    """The v0.6 runner's EVM proxy: emit_transfer(value) and nothing else —
    an `on=` keyword is a TypeError on-chain, so it is one here too."""
    def __init__(self, addr):
        self._addr = addr

    def emit_transfer(self, value):
        _SENT.append((str(self._addr).lower(), int(value)))


def _contract_interface(cls):
    return lambda addr: _EvmProxyInstance(addr)


class _NondetWeb:
    @staticmethod
    def post(url, body=None, headers=None):
        raise AssertionError(f"unexpected POST: {url}")

    @staticmethod
    def get(url, **kw):
        raise AssertionError(f"unexpected GET: {url}")

    @staticmethod
    def render(url, mode="text"):
        for dead in _DEAD:
            if dead in url:
                raise RuntimeError("source unreachable")
        is_clock = ("cdn-cgi/trace" in url or "blockscout" in url
                    or "headers/head" in url)
        if not is_clock:
            _FETCHES.append(url)
            if url in _PAGES:
                return _PAGES[url]
            raise RuntimeError("source unreachable")
        skew = next((v for k, v in _SKEW.items() if k in url), 0)
        if "cloudflare.com/cdn-cgi/trace" in url:
            _RUN_INDEX[0] += 1
        drift = 0
        if _RUN_DRIFT:
            drift = _RUN_DRIFT[min(max(_RUN_INDEX[0], 0), len(_RUN_DRIFT) - 1)]
        if drift == "DEAD":
            raise RuntimeError("source unreachable")
        now = _NOW[0] + skew + (drift if isinstance(drift, int) else 0)
        if "cdn-cgi/trace" in url:
            return f"fl=1\nts={now}.000\n"
        if "blockscout" in url:
            import datetime as _dt
            t = _dt.datetime.fromtimestamp(now, _dt.timezone.utc)
            return json.dumps([{"timestamp": t.strftime("%Y-%m-%dT%H:%M:%S.000000Z")}])
        if "headers/head" in url:
            slot = (now - 1606824023) // 12
            return json.dumps({"data": {"header": {"message": {"slot": str(slot)}}}})
        return ""


def _exec_prompt(prompt, response_format=None):
    _PROMPTS.append(prompt)
    if not _PANEL:
        raise AssertionError("test ran the panel without panel_says()")
    idx = min(_PANEL_CALLS[0], len(_PANEL) - 1)
    _PANEL_CALLS[0] += 1
    answer = _PANEL[idx]
    if isinstance(answer, BaseException):
        raise answer
    return answer


def _install():
    """Build the `genlayer` package the contract imports: `import genlayer as
    gl` plus `from genlayer.types import *`."""
    gl = types.ModuleType("genlayer")
    gl.IS_IN_VM = False
    gl.TreeMap = _TreeMapType
    gl.DynArray = _DynArray
    gl.public = _Public()

    gl.contract = types.SimpleNamespace(Contract=type("Contract", (), {}))
    gl.storage = types.SimpleNamespace(allow=lambda cls: cls, TreeMap=_TreeMapType,
                                       DynArray=_DynArray)
    gl.vm = types.SimpleNamespace(UserError=_UserError, VMError=_VMError,
                                  Return=_Return, run_nondet=_run_nondet)
    gl.nondet = types.SimpleNamespace(web=_NondetWeb(), exec_prompt=_exec_prompt)
    gl.evm = types.SimpleNamespace(contract_interface=_contract_interface)
    gl.message = types.SimpleNamespace(sender_address=INSURER, value=0)

    gl_types = types.ModuleType("genlayer.types")
    gl_types.u256 = _U256
    gl_types.i256 = _I256
    gl_types.Address = _Address
    gl_types.__all__ = ["u256", "i256", "Address"]
    gl.types = gl_types

    sys.modules["genlayer"] = gl
    sys.modules["genlayer.types"] = gl_types
    return gl


def _load():
    _install()
    spec = importlib.util.spec_from_file_location("triggera_contract", CONTRACT_PATH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def module():
    return _load()


@pytest.fixture
def c(module):
    _NOW[0] = 1_760_000_000
    _SKEW.clear()
    _DEAD.clear()
    _PAGES.clear()
    _FETCHES.clear()
    _SENT.clear()
    _PROMPTS.clear()
    _PANEL.clear()
    _PANEL_CALLS[0] = 0
    _RUN_DRIFT.clear()
    _RUN_INDEX[0] = -1

    page(AGENCY_URL, AGENCY_PAGE)
    page(PROVIDER_URL, PROVIDER_PAGE)
    page(NEWS_URL, NEWS_PAGE)
    page(STATION_URL, STATION_PAGE)
    page(AGENCY_URL_TWIN, AGENCY_PAGE)

    as_(module, INSURER, 0)
    inst = module.Triggera()
    for name in ("policies", "terms_store", "basis_store", "packages",
                 "decisions", "actor_index", "claimable"):
        setattr(inst, name, module.gl.TreeMap())
    inst.policy_ids = _DynArray._from_storage()
    return inst


# ── helpers ──────────────────────────────────────────────────────────────────

def as_(module, who, value=0):
    module.gl.message.sender_address = who
    module.gl.message.value = value


def now():
    return _NOW[0]


def advance(seconds):
    _NOW[0] += seconds


def sent():
    return list(_SENT)


def prompts():
    return list(_PROMPTS)


def fetches():
    """Every non-clock URL the panel fetched, in order, across all rounds."""
    return list(_FETCHES)


def clear_fetches():
    _FETCHES.clear()


def page(url, text):
    _PAGES[url] = text


def clock_drift(*offsets):
    _RUN_DRIFT.clear()
    _RUN_INDEX[0] = -1
    _RUN_DRIFT.extend(offsets)


def skew(fragment, seconds):
    _SKEW[fragment] = seconds


def dead(fragment):
    _DEAD.add(fragment)


def err(module):
    return module.gl.vm.UserError


LOCKED_STATUSES = ("DRAFT", "ACTIVE", "INVESTIGATING", "PENDING_FINALITY", "FINAL")


def conserve(module, c):
    """The wei invariant: everything the contract physically holds is either
    a locked coverage (from the insurer's deposit at drafting until PAID,
    EXPIRED or CANCELLED), an unclaimed ledger balance, or an undecided
    appeal bond. Premiums enter the ledger the moment they are paid."""
    locked = sum(int(p.coverage) for p in c.policies.values()
                 if p.status in LOCKED_STATUSES)
    ledger = sum(int(v) for v in c.claimable.values())
    bonds = sum(int(p.appeal_bond_atto) for p in c.policies.values())
    assert int(c.escrow_atto) == locked + ledger + bonds, (
        f"conservation broken: escrow={int(c.escrow_atto)} "
        f"locked={locked} ledger={ledger} bonds={bonds}")


def source(url, label="Source"):
    return {"url": url, "label": label}


def demo_sources():
    """The canonical claim: three independent publishers reading 157, 149
    and 161 km/h against a 150 km/h trigger, and the policyholder's own
    station log (153). Two of three independent voices qualify -> SATISFIED
    with one contradicting; the station informs only."""
    return [source(AGENCY_URL, "Agency bulletin 07"),
            source(PROVIDER_URL, "Weather provider daily history"),
            source(NEWS_URL, "Provincial press report"),
            source(STATION_URL, "Premises station log")]


DEMO_READINGS = {"EV-001": 157, "EV-002": 149, "EV-003": 161, "EV-004": 153}


def answer(readings=None, evidence="SUFFICIENT", conflicts=None, score=86,
           reason="the agency bulletin and the press report state sustained speeds past the threshold",
           window_ok=True, geo_ok=True, kind_matches=True, **over):
    """A complete, valid panel answer. Defaults describe demo_sources(). A
    reading given as a dict overrides window_ok / geo_ok / kind_matches for
    that one source."""
    readings = readings if readings is not None else dict(DEMO_READINGS)
    srcs = []
    for sid, val in readings.items():
        entry = {"id": sid, "reading": val, "window_ok": window_ok,
                 "geo_ok": geo_ok, "kind_matches": kind_matches}
        if isinstance(val, dict):
            entry = {"id": sid, "reading": val.get("reading"),
                     "window_ok": val.get("window_ok", window_ok),
                     "geo_ok": val.get("geo_ok", geo_ok),
                     "kind_matches": val.get("kind_matches", kind_matches)}
        srcs.append(entry)
    ans = {"sources": srcs, "evidence": evidence, "conflicts": conflicts or [],
           "score": score, "reason": reason}
    ans.update(over)
    return ans


def panel_says(ans):
    _PANEL.clear()
    _PANEL_CALLS[0] = 0
    _PANEL.append(ans)


def panel_sequence(*answers):
    _PANEL.clear()
    _PANEL_CALLS[0] = 0
    _PANEL.extend(answers)


# ── lifecycle helpers ────────────────────────────────────────────────────────

def drafted(module, c, coverage=COVERAGE, premium=PREMIUM, threshold=THRESHOLD,
            operator="GTE", min_independent=1, cover_len=COVER_LEN, grace=W,
            windows=(W, W), terms=TERMS, basis=None, title="StormGuard Property Protection",
            notional="USD 100,000", event_type="WIND",
            metric="maximum sustained wind speed", unit="km/h",
            measurement_hours=24, duration_hours=0, country="Philippines",
            region="Eastern Samar", lat_e6=11_500_000, lon_e6=125_500_000,
            radius_km=50, cover_start=None):
    as_(module, INSURER, coverage)
    start = now() if cover_start is None else cover_start
    return c.create_policy(
        title, notional, event_type, metric, unit, operator, threshold,
        measurement_hours, duration_hours, country, region, lat_e6, lon_e6,
        radius_km, str(premium), min_independent, start, start + cover_len,
        grace, windows[0], windows[1], terms,
        json.dumps(basis if basis is not None else BASIS))


def activated(module, c, **kw):
    premium = kw.get("premium", PREMIUM)
    pid = drafted(module, c, **kw)
    as_(module, HOLDER, premium)
    c.activate(pid)
    return pid


def event_window(c, pid):
    """The canonical event window: the first EVENT_LEN seconds of coverage."""
    p = policy(c, pid)
    return p["coverage_start_epoch"], p["coverage_start_epoch"] + EVENT_LEN


def claimed(module, c, sources=None, claimed_reading=157, **kw):
    """Activate, let the canonical event window pass, and file the claim."""
    pid = activated(module, c, **kw)
    start, end = event_window(c, pid)
    if now() <= end:
        advance(end - now() + 1)
    as_(module, HOLDER, 0)
    c.file_claim(pid, start, end, claimed_reading, json.dumps(sources or demo_sources()))
    return pid


def investigated(module, c, ans=None, sources=None, claimed_reading=157, **kw):
    pid = claimed(module, c, sources=sources, claimed_reading=claimed_reading, **kw)
    panel_says(ans or answer())
    as_(module, STRANGER, 0)
    c.investigate(pid)
    return pid


def final(module, c, **kw):
    pid = investigated(module, c, **kw)
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.promote(pid)
    return pid


def settled(module, c, **kw):
    pid = final(module, c, **kw)
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(pid)
    return pid


def policy(c, pid):
    return json.loads(c.get_policy(pid))


def decision(c, pid, version):
    raw = c.get_decision(pid, version)
    return json.loads(raw) if raw else None


def package(c, pid, version):
    raw = c.get_package(pid, version)
    return json.loads(raw) if raw else None
