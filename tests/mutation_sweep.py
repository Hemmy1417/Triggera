"""Mutation check for Verda: break each protective rule in a scratch copy of
the repo and prove the direct suite FAILS. A mutation that survives is an
unpinned rule. A CONTROL (no mutation) runs first and must stay green, or the
sweep refuses to proceed.

Every rule the validator guards TWICE (a direct comparison against its own
derivation AND the re-derivation from the leader's stored rows) is mutated as
a MULTI mutant that removes both layers together: a single-layer mutant there
is EQUIVALENT — the sibling layer catches the same forgery — and would be
reported as a false pin.

Run from anywhere: python tests/mutation_sweep.py
"""

import pathlib
import shutil
import subprocess
import sys
import time

SRC = pathlib.Path(r"C:/Users/Pc/Desktop/Verda")
WORK = pathlib.Path(__file__).resolve().parent / "work"
CONTRACT_REL = pathlib.Path("contracts") / "verda.py"

# A sweep that silently lost entries must not report success.
EXPECTED_MIN_GUARDS = 110

IGNORE = shutil.ignore_patterns("work", "__pycache__", "node_modules", ".next",
                                ".git", "web", ".pytest_cache")

MUTATIONS = [
    ("CONTROL (no mutation — must PASS)", None, None),

    # ── draft walls ──────────────────────────────────────────────────────
    ("draft: target bounds dropped",
     "        if not (MIN_TARGET <= tgt <= MAX_TARGET):",
     "        if False:"),

    ("draft: threshold bounds dropped",
     "        if not (MIN_THRESHOLD_BPS <= thr <= MAX_THRESHOLD_BPS):",
     "        if False:"),

    ("draft: min_independent bounds dropped",
     "        if not (MIN_INDEPENDENT <= min_ind <= MAX_INDEPENDENT):",
     "        if False:"),

    ("draft: reward bounds dropped",
     "        if not (MIN_REWARD_ATTO <= reward <= MAX_REWARD_ATTO):",
     "        if False:"),

    ("draft: window bounds dropped",
     "            if not (MIN_WINDOW_SECONDS <= w <= cap):",
     "            if False:"),

    ("draft: terms length dropped",
     "        if not (MIN_TERMS_CHARS <= len(terms) <= MAX_TERMS_CHARS):",
     "        if False:"),

    ("draft: deadline-too-soon wall dropped",
     "        if deadline < now + MIN_WINDOW_SECONDS:",
     "        if False:"),

    ("draft: deadline boundary flips (< to <=)",
     "        if deadline < now + MIN_WINDOW_SECONDS:",
     "        if deadline <= now + MIN_WINDOW_SECONDS:"),

    # ── basis walls ──────────────────────────────────────────────────────
    ("basis: entry count bounds dropped",
     "        if not isinstance(entries, list) or not (1 <= len(entries) <= MAX_BASIS_ENTRIES):",
     "        if not isinstance(entries, list):"),

    ("basis: unknown source kind accepted",
     "            if kind not in SOURCE_KINDS:",
     "            if False:"),

    ("basis: class outside INDEPENDENT|OPERATOR accepted",
     "            if cls not in SOURCE_CLASSES:",
     "            if False:"),

    ("basis: origin hostname validity dropped",
     "            if not _valid_origin(origin):",
     "            if False:"),

    ("basis: duplicate origin accepted",
     "            if origin in seen:",
     "            if False:"),

    ("basis: independent-origin requirement dropped",
     "        if not independent_domains:",
     "        if False:"),

    ("basis: min_independent may exceed the independent publishers",
     "        if min_independent > len(independent_domains):",
     "        if False:"),

    # ── fund walls ───────────────────────────────────────────────────────
    ("fund: exact deposit becomes at-least",
     "        if self._value() != reward:",
     "        if self._value() < reward:"),

    ("fund: operator may fund its own draft",
     "        if funder == ag.operator:",
     "        if False:"),

    ("fund: status wall dropped (a funded agreement funds again)",
     "        if ag.status != \"DRAFT\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing to fund in {ag.status}\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing to fund in {ag.status}\")"),

    ("fund: after-the-deadline wall dropped",
     "        if now >= int(ag.deadline_epoch):",
     "        if False:"),

    ("fund: deadline boundary flips (>= to >)",
     "        if now >= int(ag.deadline_epoch):",
     "        if now > int(ag.deadline_epoch):"),

    ("fund: deposit not added to escrow",
     "        self.escrow_atto = u256(int(self.escrow_atto) + reward)",
     "        pass"),

    # ── submit walls ─────────────────────────────────────────────────────
    ("submit: stranger may submit",
     "        if self._sender() != ag.operator:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} only the operator submits evidence\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} only the operator submits evidence\")"),

    ("submit: status wall dropped",
     "        if ag.status != \"FUNDED\":\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} evidence is filed on a funded agreement with no \"",
     "        if False:\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} evidence is filed on a funded agreement with no \""),

    ("submit: open-challenge wall dropped",
     "        if ag.challenge_open == \"yes\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} a challenge is open\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} a challenge is open\")"),

    ("submit: grace wall dropped",
     "        if now > int(ag.deadline_epoch) + int(ag.submission_grace):",
     "        if False:"),

    ("submit: grace boundary flips (> to >=)",
     "        if now > int(ag.deadline_epoch) + int(ag.submission_grace):",
     "        if now >= int(ag.deadline_epoch) + int(ag.submission_grace):"),

    ("submit: version cap dropped",
     "        if version > MAX_VERSIONS:",
     "        if False:"),

    ("submit: claimed impact bounds dropped",
     "        if not (0 <= claimed <= MAX_FIGURE):",
     "        if False:"),

    ("submit: package without an independent source accepted",
     "        if not any(r[\"cls\"] == \"INDEPENDENT\" for r in rows):",
     "        if False:"),

    # ── row intake ───────────────────────────────────────────────────────
    ("rows: url validity dropped",
     "            if not _valid_url(url):",
     "            if False:"),

    ("rows: label requirement dropped",
     "            if not (1 <= len(label) <= MAX_LABEL_CHARS):",
     "            if False:"),

    ("rows: row count bounds dropped",
     "        if not isinstance(rows, list) or not (1 <= len(rows) <= MAX_SOURCES):",
     "        if not isinstance(rows, list):"),

    ("rows: an off-basis host inherits the first basis entry",
     "            if matched is None:\n"
     "                raise gl.vm.UserError(",
     "            if matched is None:\n"
     "                matched = basis[0]\n"
     "            if False:\n"
     "                raise gl.vm.UserError("),

    ("rows: the longest matching origin no longer wins",
     "                    if matched is None or len(b[\"origin\"]) > len(matched[\"origin\"]):",
     "                    if matched is None:"),

    ("S35: normalized duplicate accepted",
     "            if norm in seen:",
     "            if False:"),

    ("origin: subdomain boundary removed ('.' + origin)",
     "    return host == origin or host.endswith(\".\" + origin)",
     "    return host == origin or host.endswith(origin)"),

    ("origin: subdomain match dropped",
     "    return host == origin or host.endswith(\".\" + origin)",
     "    return host == origin"),

    ("S35: normalize keeps the trailing slash",
     "    if len(path) > 1 and path.endswith(\"/\"):",
     "    if False:"),

    ("S35: normalize keeps the default port",
     "    if port and not ((scheme == \"https\" and port == \"443\") or\n"
     "                     (scheme == \"http\" and port == \"80\")):",
     "    if port:"),

    ("S35: split_url keeps the host's case",
     "    return scheme.lower(), host.lower(), port, path, (query if q else \"\")",
     "    return scheme.lower(), host, port, path, (query if q else \"\")"),

    ("publisher: second-level suffix heuristic dropped",
     "    if len(parts[-1]) == 2 and parts[-2] in _SECOND_LEVEL:",
     "    if False:"),

    # ── adjudicate walls ─────────────────────────────────────────────────
    ("adjudicate: status wall dropped",
     "        if ag.status != \"FUNDED\":\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} adjudication runs on a funded agreement, not {ag.status}\")",
     "        if False:\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} adjudication runs on a funded agreement, not {ag.status}\")"),

    ("adjudicate: open-challenge wall dropped",
     "        if ag.challenge_open == \"yes\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} use re_adjudicate for a challenge\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} use re_adjudicate for a challenge\")"),

    ("adjudicate: no-evidence wall dropped",
     "        if version == 0:",
     "        if False:"),

    ("adjudicate: a judged version may be re-run",
     "        if self.dossiers.get(f\"{ag.agreement_id}|{version}\") is not None:",
     "        if False:"),

    ("adjudicate: before-deadline wall dropped",
     "        if now <= int(ag.deadline_epoch):",
     "        if False:"),

    ("adjudicate: deadline boundary flips (<= to <)",
     "        if now <= int(ag.deadline_epoch):",
     "        if now < int(ag.deadline_epoch):"),

    # ── promote ──────────────────────────────────────────────────────────
    ("promote: open-challenge wall dropped",
     "        if ag.challenge_open == \"yes\":\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} a challenge is open — re-adjudication decides\")",
     "        if False:\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} a challenge is open — re-adjudication decides\")"),

    ("promote: finality window dropped",
     "        if now <= int(ag.pending_until_epoch):",
     "        if False:"),

    ("promote: finality boundary flips (<= to <)",
     "        if now <= int(ag.pending_until_epoch):",
     "        if now < int(ag.pending_until_epoch):"),

    ("S22: promote's defense-in-depth dropped",
     "        if dossier.get(\"evidence_flag\") != \"SUFFICIENT\" and verdict != \"INCONCLUSIVE\":\n"
     "            verdict = \"INCONCLUSIVE\"",
     "        if False:\n"
     "            verdict = \"INCONCLUSIVE\""),

    ("promote: a verdict outside the enum becomes state",
     "        if verdict not in VERDICTS:\n"
     "            verdict = \"INCONCLUSIVE\"",
     "        if False:\n"
     "            verdict = \"INCONCLUSIVE\""),

    ("promote: an inconclusive hold no longer returns to FUNDED",
     "            ag.status = \"FUNDED\"\n"
     "            ag.verified_impact = u256(0)\n"
     "            return \"inconclusive\"",
     "            ag.verified_impact = u256(0)\n"
     "            return \"inconclusive\""),

    ("promote: judged_version not advanced",
     "        ag.judged_version = u256(version)\n"
     "        ag.pending_version = u256(0)",
     "        ag.pending_version = u256(0)"),

    # ── challenge walls and economics ────────────────────────────────────
    ("challenge: stranger may challenge",
     "        if sender not in (ag.operator, ag.funder):",
     "        if False:"),

    ("challenge: second filing while one is open accepted",
     "        if ag.challenge_open == \"yes\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} a challenge is already open\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} a challenge is already open\")"),

    ("challenge: status wall dropped",
     "        if ag.status != \"FINAL\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing challengeable in {ag.status}\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing challengeable in {ag.status}\")"),

    ("challenge: window wall dropped",
     "        if now > int(ag.challenge_until_epoch):",
     "        if False:"),

    ("challenge: window boundary flips (> to >=)",
     "        if now > int(ag.challenge_until_epoch):",
     "        if now >= int(ag.challenge_until_epoch):"),

    ("challenge: grounds bounds dropped",
     "        if not (MIN_GROUNDS_CHARS <= len(grounds) <= MAX_REASON_CHARS):",
     "        if False:"),

    ("challenge: exact bond becomes at-least",
     "        if self._value() != bond:",
     "        if self._value() < bond:"),

    ("challenge: version cap dropped",
     "        if new_version > MAX_VERSIONS:",
     "        if False:"),

    ("challenge: bond stops entering escrow",
     "        self.escrow_atto = u256(int(self.escrow_atto) + bond)",
     "        pass"),

    ("bond: the 0.05 GEN floor dropped",
     "        return max(CHALLENGE_BOND_FLOOR_ATTO,\n"
     "                   int(ag.max_reward) * CHALLENGE_BOND_BPS // 10_000)",
     "        return int(ag.max_reward) * CHALLENGE_BOND_BPS // 10_000"),

    ("bond: the 5% share dropped",
     "        return max(CHALLENGE_BOND_FLOOR_ATTO,\n"
     "                   int(ag.max_reward) * CHALLENGE_BOND_BPS // 10_000)",
     "        return CHALLENGE_BOND_FLOOR_ATTO"),

    # ── re-adjudication ──────────────────────────────────────────────────
    ("re_adjudicate: runs without an open challenge",
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} no challenge is open\")\n"
     "        version = int(ag.challenge_new_version)",
     "            pass\n"
     "        version = int(ag.challenge_new_version)"),

    ("S28: _dossier_intact check removed before the re-read",
     "        if not _dossier_intact(recorded.get(\"rows\", [])):",
     "        if False:"),

    ("re_adjudicate: a changed figure alone no longer counts as changed",
     "        changed = (recorded.get(\"verdict\") != dossier[\"verdict\"] or\n"
     "                   _as_int(recorded.get(\"verified_impact\"), -1) != dossier[\"verified_impact\"])",
     "        changed = (recorded.get(\"verdict\") != dossier[\"verdict\"])"),

    ("re_adjudicate: bond routing flips (unchanged verdict pays the challenger)",
     "        if changed:\n"
     "            self._credit(ag.challenger, bond)\n"
     "        else:\n"
     "            other = ag.operator if ag.challenger == ag.funder else ag.funder\n"
     "            self._credit(other, bond)",
     "        self._credit(ag.challenger, bond)"),

    ("re_adjudicate: the bond stays counted after conclusion",
     "        ag.challenge_bond_atto = u256(0)\n"
     "        ag.challenge_snapshot = \"\"\n"
     "        # The new verdict arms its own finality window",
     "        ag.challenge_snapshot = \"\"\n"
     "        # The new verdict arms its own finality window"),

    # ── lapse ────────────────────────────────────────────────────────────
    ("lapse: stale window dropped",
     "        if now <= int(ag.challenge_filed_epoch) + STALE_CHALLENGE_SECONDS:",
     "        if False:"),

    ("lapse: stale boundary flips (<= to <)",
     "        if now <= int(ag.challenge_filed_epoch) + STALE_CHALLENGE_SECONDS:",
     "        if now < int(ag.challenge_filed_epoch) + STALE_CHALLENGE_SECONDS:"),

    ("lapse: bond not returned to the challenger",
     "        bond = int(ag.challenge_bond_atto)\n"
     "        self._credit(ag.challenger, bond)\n"
     "        ag.status = snap.get(\"status\", ag.status)",
     "        bond = int(ag.challenge_bond_atto)\n"
     "        ag.status = snap.get(\"status\", ag.status)"),

    # Restoring status/verdict alone is EQUIVALENT (only a FINAL agreement
    # files a challenge and nothing rewrites its verdict while one is open);
    # the restore is pinned through the field a challenge actually drifts.
    ("S29: lapse keeps the challenge's appended evidence version",
     "        ag.evidence_version = u256(_as_int(snap.get(\"evidence_version\"),\n"
     "                                           int(ag.evidence_version)))\n"
     "        ag.evidence_root = snap.get(\"evidence_root\", ag.evidence_root)",
     "        pass"),

    # ── settle ───────────────────────────────────────────────────────────
    ("settle: runs twice",
     "        if ag.status != \"FINAL\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing to settle in {ag.status}\")",
     "        if ag.status not in (\"FINAL\", \"SETTLED\"):\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing to settle in {ag.status}\")"),

    ("settle: open challenge ignored",
     "        if ag.challenge_open == \"yes\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} a challenge is open — resolve it first\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} a challenge is open — resolve it first\")"),

    ("settle: challenge window dropped",
     "        if now <= int(ag.challenge_until_epoch):\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} the challenge window is still open\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} the challenge window is still open\")"),

    ("settle: window boundary flips (<= to <)",
     "        if now <= int(ag.challenge_until_epoch):\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} the challenge window is still open\")",
     "        if now < int(ag.challenge_until_epoch):\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} the challenge window is still open\")"),

    ("settle: conclusive-verdict requirement dropped",
     "        if ag.verdict not in (\"QUALIFIED\", \"NOT_QUALIFIED\"):",
     "        if False:"),

    ("S22: settle's insufficient-record refusal dropped",
     "        if ag.evidence_flag != \"SUFFICIENT\":\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} a verdict over an insufficient record cannot settle\")",
     "        if False:\n"
     "            raise gl.vm.UserError(\n"
     "                f\"{ERROR_EXPECTED} a verdict over an insufficient record cannot settle\")"),

    ("settle: NOT_QUALIFIED pays the operator too",
     "        if ag.verdict == \"QUALIFIED\":\n"
     "            payout = _payout_atto(int(ag.verified_impact), int(ag.target), reward)",
     "        if ag.verdict in (\"QUALIFIED\", \"NOT_QUALIFIED\"):\n"
     "            payout = _payout_atto(int(ag.verified_impact), int(ag.target), reward)"),

    ("settle: the funder's remainder not credited",
     "        self._credit(ag.operator, payout)\n"
     "        self._credit(ag.funder, refund)",
     "        self._credit(ag.operator, payout)"),

    ("settle: the operator's payout not credited",
     "        self._credit(ag.operator, payout)\n"
     "        self._credit(ag.funder, refund)",
     "        self._credit(ag.funder, refund)"),

    ("payout: cap at the reward removed",
     "    return min(max_reward, verified * max_reward // target)",
     "    return verified * max_reward // target"),

    # ── reclaim ──────────────────────────────────────────────────────────
    ("reclaim: status wall dropped",
     "        if ag.status != \"FUNDED\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing to reclaim in {ag.status}\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} nothing to reclaim in {ag.status}\")"),

    ("reclaim: open challenge ignored",
     "        if ag.challenge_open == \"yes\":\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} resolve the open challenge first\")",
     "        if False:\n"
     "            raise gl.vm.UserError(f\"{ERROR_EXPECTED} resolve the open challenge first\")"),

    ("reclaim: grace wall dropped",
     "        if now <= grace_end:",
     "        if False:"),

    ("reclaim: grace boundary flips (<= to <)",
     "        if now <= grace_end:",
     "        if now < grace_end:"),

    ("reclaim: patience guard for an unjudged submission dropped",
     "        if int(ag.evidence_version) > int(ag.judged_version):",
     "        if False:"),

    ("reclaim: patience boundary flips (<= to <)",
     "            if now <= patience_end:",
     "            if now < patience_end:"),

    ("reclaim: funder not credited",
     "        self._credit(ag.funder, reward)\n"
     "        ag.refund_atto = u256(reward)",
     "        ag.refund_atto = u256(reward)"),

    # ── claim ────────────────────────────────────────────────────────────
    ("claim: ledger not zeroed before the transfer",
     "        self.claimable[sender] = u256(0)\n"
     "        self.escrow_atto = u256(int(self.escrow_atto) - amount)",
     "        self.escrow_atto = u256(int(self.escrow_atto) - amount)"),

    ("claim: escrow not decremented",
     "        self.claimable[sender] = u256(0)\n"
     "        self.escrow_atto = u256(int(self.escrow_atto) - amount)",
     "        self.claimable[sender] = u256(0)"),

    # ── _usable_rows ─────────────────────────────────────────────────────
    ("usable: INDEPENDENT class no longer required",
     "        if r.get(\"cls\") != \"INDEPENDENT\":\n"
     "            continue",
     "        if False:\n"
     "            continue"),

    ("usable: readable no longer required",
     "        if r.get(\"readable\") is not True:\n"
     "            continue",
     "        if False:\n"
     "            continue"),

    ("usable: scope_ok no longer required",
     "        if r.get(\"scope_ok\") is not True or r.get(\"kind_matches\") is not True:",
     "        if r.get(\"kind_matches\") is not True:"),

    ("usable: kind_matches no longer required",
     "        if r.get(\"scope_ok\") is not True or r.get(\"kind_matches\") is not True:",
     "        if r.get(\"scope_ok\") is not True:"),

    ("usable: figure type check loosened to not-null",
     "        if isinstance(fig, bool) or not isinstance(fig, int):\n"
     "            continue",
     "        if fig is None:\n"
     "            continue"),

    ("usable: figure range dropped",
     "        if not (0 <= fig <= MAX_FIGURE):\n"
     "            continue",
     "        if False:\n"
     "            continue"),

    # ── _derive_verdict (the heart) ──────────────────────────────────────
    ("S22: the sufficiency gate dropped",
     "    if evidence_flag != \"SUFFICIENT\":\n"
     "        return \"INCONCLUSIVE\", 0, \"EVIDENCE_INSUFFICIENT\"",
     "    if False:\n"
     "        return \"INCONCLUSIVE\", 0, \"EVIDENCE_INSUFFICIENT\""),

    ("S34/S35: min_independent comparison flips (< to <=)",
     "    if len(domains) < min_independent:",
     "    if len(domains) <= min_independent:"),

    ("S34/S35: min_independent comparison dropped",
     "    if len(domains) < min_independent:",
     "    if len(domains) < 0:"),

    ("derive: contradiction tolerance flips (> to >=)",
     "    if hi > 0 and (hi - lo) * 10_000 > hi * CONTRADICTION_TOLERANCE_BPS:",
     "    if hi > 0 and (hi - lo) * 10_000 >= hi * CONTRADICTION_TOLERANCE_BPS:"),

    ("derive: contradiction check dropped",
     "    if hi > 0 and (hi - lo) * 10_000 > hi * CONTRADICTION_TOLERANCE_BPS:",
     "    if False:"),

    ("derive: verified takes the highest figure (min to max)",
     "    verified = min(lo, max(0, claimed), target)",
     "    verified = min(hi, max(0, claimed), target)"),

    ("derive: the operator's claim no longer caps verified",
     "    verified = min(lo, max(0, claimed), target)",
     "    verified = min(lo, target)"),

    ("derive: the target no longer caps verified",
     "    verified = min(lo, max(0, claimed), target)",
     "    verified = min(lo, max(0, claimed))"),

    ("derive: threshold comparison flips (< to <=)",
     "    if verified * 10_000 < target * threshold_bps:",
     "    if verified * 10_000 <= target * threshold_bps:"),

    ("S35: publishers counted per host, not per registrable domain",
     "        domains.add(_registrable_domain(str(r.get(\"host\", \"\"))))",
     "        domains.add(str(r.get(\"host\", \"\")))"),

    # ── the judge (leader side) ──────────────────────────────────────────
    ("judge: an unreadable row keeps the model's figure",
     "                if not r[\"readable\"]:\n"
     "                    # An unreadable page states nothing",
     "                if False:\n"
     "                    # An unreadable page states nothing"),

    ("judge: excerpt cap removed",
     "                        body = _defang(str(raw or \"\"))[:MAX_EXCERPT_CHARS]",
     "                        body = _defang(str(raw or \"\"))"),

    ("S19: the defang sanitizer goes half (opener only)",
     "    return str(s or \"\").replace(\"<<<\", \"\u2039\u2039\u2039\").replace(\">>>\", \"\u203a\u203a\u203a\")",
     "    return str(s or \"\").replace(\"<<<\", \"\u2039\u2039\u2039\")"),

    ("S16: figure range check at the boundary dropped",
     "                    if not (0 <= figure <= MAX_FIGURE):",
     "                    if False:"),

    ("S16: evidence enum check dropped",
     "            if evidence_flag not in EVIDENCE_FLAGS:",
     "            if False:"),

    ("S16: boolean check on scope_ok/kind_matches dropped",
     "                if not isinstance(scope_ok, bool) or not isinstance(kind_matches, bool):",
     "                if False:"),

    ("S36: recorded rows refetched on appeal",
     "                if rec is not None and rec.get(\"url\") == it[\"url\"]:",
     "                if False:"),

    ("S36: a recorded row's fetch_epoch replaced by now",
     "                    row[\"fetch_epoch\"] = _as_int(rec.get(\"fetch_epoch\"), 0)",
     "                    row[\"fetch_epoch\"] = now"),

    ("S21: the digest stops covering the stored bytes",
     "                row[\"digest\"] = _sha256_hex(row[\"excerpt\"])",
     "                row[\"digest\"] = _sha256_hex(row[\"url\"])"),

    # ── validator comparison ─────────────────────────────────────────────
    # verdict, verified and hold_reason are each guarded twice: the direct
    # comparison against this validator's own derivation, and the
    # re-derivation from the leader's stored rows. Either layer alone catches
    # every forgery the other would, so each pair falls together.
    ("validator loses BOTH verdict layers (compare + re-derivation)",
     "MULTI",
     [("            if mine[\"verdict\"] != theirs.get(\"verdict\"):\n"
       "                return False",
       "            if False:\n"
       "                return False"),
      ("            if re_verdict != theirs.get(\"verdict\"):\n"
       "                return False",
       "            if False:\n"
       "                return False")]),

    ("validator loses BOTH verified_impact layers (compare + re-derivation)",
     "MULTI",
     [("            if mine[\"verified_impact\"] != _as_int(theirs.get(\"verified_impact\"), -1):\n"
       "                return False",
       "            if False:\n"
       "                return False"),
      ("            if re_verified != _as_int(theirs.get(\"verified_impact\"), -1):\n"
       "                return False",
       "            if False:\n"
       "                return False")]),

    ("validator loses BOTH hold_reason layers (compare + re-derivation)",
     "MULTI",
     [("            if mine[\"hold_reason\"] != theirs.get(\"hold_reason\"):\n"
       "                return False",
       "            if False:\n"
       "                return False"),
      ("            if re_hold != theirs.get(\"hold_reason\"):\n"
       "                return False",
       "            if False:\n"
       "                return False")]),

    ("validator: evidence_flag compare dropped",
     "            if mine[\"evidence_flag\"] != theirs.get(\"evidence_flag\"):\n"
     "                return False",
     "            if False:\n"
     "                return False"),

    ("validator: score band widened to any distance",
     "            if abs(my_sb - their_sb) > 1:",
     "            if abs(my_sb - their_sb) > 999:"),

    ("validator: row count compare dropped",
     "            if not isinstance(t_rows, list) or len(t_rows) != len(mine[\"rows\"]):",
     "            if not isinstance(t_rows, list):"),

    ("validator: readable compare dropped",
     "                if me[\"readable\"] != them.get(\"readable\"):\n"
     "                    return False",
     "                if False:\n"
     "                    return False"),

    ("S21: validator stops checking digest-covers-excerpt",
     "                if _sha256_hex(str(them.get(\"excerpt\", \"\"))) != them.get(\"digest\"):\n"
     "                    return False",
     "                if False:\n"
     "                    return False"),

    ("S36: validator stops comparing RECORDED excerpts",
     "                    if them.get(\"excerpt\") != me[\"excerpt\"]:\n"
     "                        return False",
     "                    if False:\n"
     "                        return False"),

    ("S36: validator stops comparing RECORDED fetch_epoch",
     "                    if _as_int(them.get(\"fetch_epoch\"), -1) != me[\"fetch_epoch\"]:\n"
     "                        return False",
     "                    if False:\n"
     "                        return False"),

    ("validator: independent figure compare dropped",
     "                    if me[\"figure\"] != them.get(\"figure\"):\n"
     "                        return False",
     "                    if False:\n"
     "                        return False"),

    ("validator: independent scope_ok compare dropped",
     "                    if me[\"scope_ok\"] != them.get(\"scope_ok\"):\n"
     "                        return False",
     "                    if False:\n"
     "                        return False"),

    ("validator: independent kind_matches compare dropped",
     "                    if me[\"kind_matches\"] != them.get(\"kind_matches\"):\n"
     "                        return False",
     "                    if False:\n"
     "                        return False"),

    ("validator: basis tag no longer compared",
     "                for key in (\"id\", \"url\", \"host\", \"domain\", \"kind\", \"cls\",\n"
     "                            \"basis\", \"basis_round\"):",
     "                for key in (\"id\", \"url\", \"host\", \"domain\", \"kind\", \"cls\",\n"
     "                            \"basis_round\"):"),

    ("validator: row class no longer compared",
     "                for key in (\"id\", \"url\", \"host\", \"domain\", \"kind\", \"cls\",\n"
     "                            \"basis\", \"basis_round\"):",
     "                for key in (\"id\", \"url\", \"host\", \"domain\", \"kind\",\n"
     "                            \"basis\", \"basis_round\"):"),

    ("validator: row url no longer compared",
     "                for key in (\"id\", \"url\", \"host\", \"domain\", \"kind\", \"cls\",\n"
     "                            \"basis\", \"basis_round\"):",
     "                for key in (\"id\", \"host\", \"domain\", \"kind\", \"cls\",\n"
     "                            \"basis\", \"basis_round\"):"),

    ("validator: a VM-level leader failure is endorsed",
     "                if not isinstance(leaders_res, gl.vm.UserError):\n"
     "                    return False",
     "                if not isinstance(leaders_res, gl.vm.UserError):\n"
     "                    return True"),

    ("validator: its own failed rerun endorses the leader",
     "                # disagreement, which rotates the round.\n"
     "                return False",
     "                # disagreement, which rotates the round.\n"
     "                mine = dict(theirs)"),

    # ── the clock ────────────────────────────────────────────────────────
    ("clock: divergent trace sources accepted",
     "            if len(cands) >= 2 and (max(cands) - min(cands)) > MAX_CLOCK_DIVERGENCE:\n"
     "                return \"0\"",
     "            if False:\n"
     "                return \"0\""),

    ("S20: beacon ceiling dropped",
     "            if now > max(witnesses) + MAX_CLOCK_DIVERGENCE:\n"
     "                return \"0\"",
     "            if False:\n"
     "                return \"0\""),

    ("clock: validator accepts any drift",
     "            return abs(theirs - mine) <= MAX_CLOCK_DIVERGENCE",
     "            return True"),
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
