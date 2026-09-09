import { describe, expect, it } from "vitest";
import { availableActs, offered, withheld, type Act, type ActId } from "../lib/acts";
import { formatGenExact } from "../lib/config";
import type { Policy } from "../lib/read";

/**
 * WHICH ACTS A WALLET IS OFFERED, against every status and both roles.
 *
 * availableActs mirrors the gates in contracts/triggera.py. These tests are
 * the check that it still does — every case below names the contract's own
 * refusal, and the two kinds of failure they catch are opposite and equally
 * bad: an act offered that the chain would refuse (the user pays a fee to be
 * told no), and an act withheld that the chain would accept (the path dead-ends
 * in the interface while the contract is willing).
 *
 * The cases that must NOT offer anything are as load-bearing as the ones that
 * must: a stranger, a closed policy, a window that has not opened, an appeal
 * already filed.
 */

const NOW = 1_800_000_000;
const DAY = 86_400;

const INSURER = "0x1111111111111111111111111111111111111111";
const HOLDER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";

const GEN = 10n ** 18n;

/** A DRAFT with the shape get_policy actually returns, over-ridable per case.
 *  The contract stores addresses LOWERCASE, which is what makes the role
 *  checks below a real test of sameAddress rather than of string equality. */
function policy(over: Partial<Policy> = {}): Policy {
  return {
    policy_id: "PL-000001",
    insurer: INSURER.toLowerCase(),
    policyholder: "",
    status: "DRAFT",
    title: "Kericho rainfall shortfall",
    notional: "",
    event_type: "RAINFALL",
    metric: "cumulative rainfall",
    unit: "mm",
    operator: "LT",
    threshold: 40,
    measurement_hours: 24,
    duration_hours: 0,
    country: "Kenya",
    region: "Kericho",
    lat_e6: -368_000,
    lon_e6: 35_283_000,
    radius_km: 25,
    coverage_atto: (1n * GEN).toString(),
    premium_atto: (5n * 10n ** 16n).toString(),
    appeal_bond_atto: (5n * 10n ** 16n).toString(),
    min_independent: 2,
    terms_sha256: "a".repeat(64),
    coverage_start_epoch: NOW - 30 * DAY,
    coverage_end_epoch: NOW + 30 * DAY,
    claim_grace: 14 * DAY,
    finality_window: DAY,
    appeal_window: DAY,
    created_epoch: NOW - 31 * DAY,
    activated_epoch: 0,
    evidence_version: 0,
    evidence_root: "",
    last_claim_epoch: 0,
    event_start_epoch: 0,
    event_end_epoch: 0,
    claimed_reading: 0,
    judged_version: 0,
    pending_version: 0,
    pending_until_epoch: 0,
    outcome: "",
    hold_reason: "",
    evidence_flag: "",
    score: 0,
    publishers: 0,
    qualifying: 0,
    contradicting: 0,
    final_epoch: 0,
    appeal_until_epoch: 0,
    appeal_open: false,
    appellant: "",
    appeal_grounds: "",
    appeal_new_version: 0,
    appealed_version: 0,
    appeal_filed_epoch: 0,
    settled_epoch: 0,
    payout_atto: "0",
    refund_atto: "0",
    expired_epoch: 0,
    cancelled_epoch: 0,
    basis: [
      { kind: "METEOROLOGICAL_AGENCY", origin: "met.example.org", class: "INDEPENDENT" },
      { kind: "STATION_LOG", origin: "farm.example.com", class: "PARTY" },
    ],
    ...over,
  };
}

/** An ACTIVE policy: taken on, nothing claimed yet. */
function active(over: Partial<Policy> = {}): Policy {
  return policy({
    status: "ACTIVE",
    policyholder: HOLDER.toLowerCase(),
    activated_epoch: NOW - 20 * DAY,
    ...over,
  });
}

/** A FINAL policy: a decision promoted, its appeal window running. */
function final(over: Partial<Policy> = {}): Policy {
  return active({
    status: "FINAL",
    evidence_version: 1,
    judged_version: 1,
    last_claim_epoch: NOW - 3 * DAY,
    outcome: "SATISFIED",
    evidence_flag: "SUFFICIENT",
    final_epoch: NOW - 3600,
    appeal_until_epoch: NOW + DAY,
    ...over,
  });
}

const ids = (acts: Act[]): ActId[] => acts.map((a) => a.id);
const find = (acts: Act[], id: ActId): Act => {
  const a = acts.find((x) => x.id === id);
  if (!a) throw new Error(`no act ${id} in [${ids(acts).join(", ")}]`);
  return a;
};

describe("a draft: entered by anyone but the insurer, withdrawn by them", () => {
  it("offers a stranger the activation, and nothing else", () => {
    const acts = availableActs(policy(), STRANGER, NOW, 0n);
    expect(ids(acts)).toEqual(["activate"]);
    expect(find(acts, "activate").blocked).toBe("");
  });

  it("sends exactly the premium, read from the policy and never re-derived", () => {
    const p = policy({ premium_atto: "1500000000000000" });
    const act = find(availableActs(p, STRANGER, NOW, 0n), "activate");
    expect(act.cost).toBe(1_500_000_000_000_000n);
    // …and the face states all of it: 0.0015 GEN rounds to "0.001" at three
    // decimals, and one atto short of the premium is a refused write.
    expect(formatGenExact(act.cost)).toBe("0.0015");
  });

  it("withholds activation from the insurer, in the contract's own terms", () => {
    const acts = availableActs(policy(), INSURER, NOW, 0n);
    expect(ids(acts)).toEqual(["activate", "cancel_policy"]);
    expect(find(acts, "activate").blocked).toMatch(/two parties/);
    expect(find(acts, "cancel_policy").blocked).toBe("");
  });

  it("recognizes the insurer through EIP-55 against the contract's lowercase", () => {
    // The wallet hands back mixed case; the contract stored lowercase. A raw
    // string comparison hides the insurer's own controls from the insurer.
    const mixed = "0x1111111111111111111111111111111111111111".toUpperCase().replace("0X", "0x");
    expect(ids(availableActs(policy(), mixed, NOW, 0n))).toContain("cancel_policy");
  });

  it("refuses a draft whose coverage period already ran out", () => {
    const p = policy({ coverage_end_epoch: NOW - 60 });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "activate").blocked).toMatch(/period is over/);
  });

  it("offers a stranger no claim, no appeal and no cancellation", () => {
    const got = ids(availableActs(policy(), STRANGER, NOW, 0n));
    expect(got).not.toContain("file_claim");
    expect(got).not.toContain("appeal");
    expect(got).not.toContain("cancel_policy");
  });
});

describe("an active policy: the claim is the policyholder's alone", () => {
  it("offers the policyholder a claim", () => {
    const acts = availableActs(active(), HOLDER, NOW, 0n);
    expect(find(acts, "file_claim").blocked).toBe("");
    expect(find(acts, "file_claim").form).toBe("claim");
  });

  it("does not offer a claim to the insurer or to a stranger", () => {
    expect(ids(availableActs(active(), INSURER, NOW, 0n))).not.toContain("file_claim");
    expect(ids(availableActs(active(), STRANGER, NOW, 0n))).not.toContain("file_claim");
  });

  it("withholds a claim once the grace after the coverage period has passed", () => {
    const p = active({ coverage_end_epoch: NOW - 20 * DAY });
    expect(find(availableActs(p, HOLDER, NOW, 0n), "file_claim").blocked).toMatch(/claim grace/i);
  });

  it("withholds a claim at the version ceiling the record holds", () => {
    const p = active({ evidence_version: 6, judged_version: 6 });
    expect(find(availableActs(p, HOLDER, NOW, 0n), "file_claim").blocked).toMatch(/6 claim versions/);
  });

  it("withholds a claim while an appeal is open", () => {
    const p = active({ appeal_open: true, appellant: INSURER.toLowerCase() });
    expect(find(availableActs(p, HOLDER, NOW, 0n), "file_claim").blocked).toMatch(/appeal is open/);
  });
});

describe("the expiry reclaim: permissionless, and only after every window", () => {
  it("is withheld while the claim grace is still running", () => {
    const acts = availableActs(active(), STRANGER, NOW, 0n);
    expect(find(acts, "expire").blocked).toMatch(/grace ends/);
  });

  it("is offered to anyone once the period and its grace have passed", () => {
    const p = active({ coverage_end_epoch: NOW - 20 * DAY });
    const act = find(availableActs(p, STRANGER, NOW, 0n), "expire");
    expect(act.blocked).toBe("");
    expect(act.permissionless).toBe(true);
    expect(act.cost).toBe(0n);
  });

  it("waits a full finality window for an unjudged claim to be investigated", () => {
    const p = active({
      coverage_end_epoch: NOW - 20 * DAY,
      evidence_version: 1,
      judged_version: 0,
      last_claim_epoch: NOW - 3600,
    });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "expire").blocked).toMatch(/not been investigated/);
  });

  it("releases the coverage once that patience has run out too", () => {
    const p = active({
      coverage_end_epoch: NOW - 20 * DAY,
      evidence_version: 1,
      judged_version: 0,
      last_claim_epoch: NOW - 2 * DAY,
    });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "expire").blocked).toBe("");
  });

  it("refuses to expire around an open appeal", () => {
    const p = active({ coverage_end_epoch: NOW - 20 * DAY, appeal_open: true });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "expire").blocked).toMatch(/open appeal/);
  });
});

describe("the determination: open to anyone, on purpose", () => {
  it("offers a stranger the investigation of a filed claim", () => {
    const p = active({ status: "INVESTIGATING", evidence_version: 1, last_claim_epoch: NOW - 60 });
    const act = find(availableActs(p, STRANGER, NOW, 0n), "investigate");
    expect(act.blocked).toBe("");
    expect(act.slow).toBe(true);
    expect(act.permissionless).toBe(true);
  });

  it("tells the policyholder why a second claim cannot be filed mid-round", () => {
    const p = active({ status: "INVESTIGATING", evidence_version: 1 });
    expect(find(availableActs(p, HOLDER, NOW, 0n), "file_claim").blocked).toMatch(/investigating/);
  });

  it("does not offer an investigation on a policy with no claim on it", () => {
    expect(ids(availableActs(active(), STRANGER, NOW, 0n))).not.toContain("investigate");
  });

  it("holds promotion until the finality window has actually closed", () => {
    const p = active({
      status: "PENDING_FINALITY",
      evidence_version: 1,
      pending_version: 1,
      pending_until_epoch: NOW + 3600,
    });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "promote").blocked).toMatch(/finality window/);
  });

  it("offers promotion to anyone once it has", () => {
    const p = active({
      status: "PENDING_FINALITY",
      evidence_version: 1,
      pending_version: 1,
      pending_until_epoch: NOW - 60,
    });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "promote").blocked).toBe("");
  });

  it("offers nothing else on a policy pending finality", () => {
    const p = active({ status: "PENDING_FINALITY", evidence_version: 1, pending_version: 1 });
    expect(ids(availableActs(p, STRANGER, NOW, 0n))).toEqual(["promote"]);
  });
});

describe("the appeal: a party, a bond, and one window", () => {
  it("offers both parties the appeal, with the bond the view computes", () => {
    for (const who of [INSURER, HOLDER]) {
      const act = find(availableActs(final(), who, NOW, 0n), "appeal");
      expect(act.blocked).toBe("");
      expect(act.cost).toBe(5n * 10n ** 16n);
      expect(act.does).toContain("0.05 GEN");
    }
  });

  it("never offers it to a stranger", () => {
    expect(ids(availableActs(final(), STRANGER, NOW, 0n))).not.toContain("appeal");
  });

  it("closes with its window", () => {
    const p = final({ appeal_until_epoch: NOW - 3600 });
    expect(find(availableActs(p, HOLDER, NOW, 0n), "appeal").blocked).toMatch(/window closed/);
  });

  it("names an appeal already open, and whose it is", () => {
    const p = final({ appeal_open: true, appellant: HOLDER.toLowerCase(), evidence_version: 2 });
    expect(find(availableActs(p, HOLDER, NOW, 0n), "appeal").blocked).toMatch(/Your appeal/);
    expect(find(availableActs(p, INSURER, NOW, 0n), "appeal").blocked).toMatch(/An appeal is already open/);
  });

  it("offers the re-investigation to anyone while the appeal stands", () => {
    const p = final({ appeal_open: true, appellant: HOLDER.toLowerCase(), appeal_filed_epoch: NOW - 60 });
    const acts = availableActs(p, STRANGER, NOW, 0n);
    expect(find(acts, "re_investigate").blocked).toBe("");
    expect(find(acts, "re_investigate").slow).toBe(true);
  });

  it("holds the lapse until the stale window opens, then offers it", () => {
    const fresh = final({ appeal_open: true, appeal_filed_epoch: NOW - 60 });
    expect(find(availableActs(fresh, STRANGER, NOW, 0n), "lapse_appeal").blocked).toMatch(/stale window/);
    const stale = final({ appeal_open: true, appeal_filed_epoch: NOW - 7200 });
    expect(find(availableActs(stale, STRANGER, NOW, 0n), "lapse_appeal").blocked).toBe("");
  });

  it("blocks settlement for as long as the appeal is open", () => {
    const p = final({ appeal_open: true, appeal_until_epoch: NOW - 3600 });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "settle").blocked).toMatch(/appeal is open/);
  });
});

describe("settlement: after the window, and only over a record that can carry it", () => {
  it("is withheld while the appeal window is still open", () => {
    expect(find(availableActs(final(), STRANGER, NOW, 0n), "settle").blocked).toMatch(/appeal window/);
  });

  it("is offered to anyone once it closes, and names what moves", () => {
    const p = final({ appeal_until_epoch: NOW - 60 });
    const act = find(availableActs(p, STRANGER, NOW, 0n), "settle");
    expect(act.blocked).toBe("");
    expect(act.does).toContain("1 GEN");
    expect(act.cost).toBe(0n);
  });

  it("says plainly that a NOT_SATISFIED settlement moves nothing", () => {
    const p = final({ appeal_until_epoch: NOW - 60, outcome: "NOT_SATISFIED" });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "settle").does).toMatch(/nothing moves/);
  });

  it("refuses to settle a decision taken over an insufficient record", () => {
    const p = final({ appeal_until_epoch: NOW - 60, evidence_flag: "PARTIAL" });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "settle").blocked).toMatch(/insufficient record/);
  });

  it("refuses to settle where no conclusive decision stands", () => {
    const p = final({ appeal_until_epoch: NOW - 60, outcome: "UNDETERMINED" });
    expect(find(availableActs(p, STRANGER, NOW, 0n), "settle").blocked).toMatch(/No conclusive decision/);
  });
});

describe("a closed policy offers nothing at all", () => {
  for (const status of ["PAID", "EXPIRED", "CANCELLED"]) {
    it(`${status}: not to the insurer, the policyholder or a stranger`, () => {
      const p = active({ status, evidence_version: 1, judged_version: 1 });
      for (const who of [INSURER, HOLDER, STRANGER, ""]) {
        expect(availableActs(p, who, NOW, 0n)).toEqual([]);
      }
    });
  }
});

describe("the withdrawal: the only path value takes out of the contract", () => {
  it("appears exactly when this wallet has a balance, on any policy", () => {
    expect(ids(availableActs(active({ status: "PAID" }), HOLDER, NOW, 0n))).toEqual([]);
    const acts = availableActs(active({ status: "PAID" }), HOLDER, NOW, 81n * 10n ** 15n);
    expect(ids(acts)).toEqual(["claim"]);
    expect(find(acts, "claim").label).toBe("Withdraw 0.081 GEN");
    expect(find(acts, "claim").blocked).toBe("");
  });

  it("states the whole figure, not a rounded one", () => {
    const acts = availableActs(active({ status: "EXPIRED" }), INSURER, NOW, 1_234_567_890_123_456_789n);
    expect(find(acts, "claim").label).toBe("Withdraw 1.234567890123456789 GEN");
  });
});

describe("a disconnected visitor", () => {
  it("is offered the acts that belong to nobody, and none that belong to a party", () => {
    const p = final({ appeal_until_epoch: NOW - 60 });
    const got = ids(availableActs(p, "", NOW, 0n));
    expect(got).toEqual(["settle"]);
  });

  it("is not mistaken for the policyholder of an unactivated draft", () => {
    // p.policyholder is "" on a DRAFT, and so is a disconnected address.
    expect(ids(availableActs(policy(), "", NOW, 0n))).toEqual(["activate"]);
  });
});

describe("offered and withheld partition the list", () => {
  it("splits on the blocked sentence and loses nothing", () => {
    const p = active({ evidence_version: 1, judged_version: 0, last_claim_epoch: NOW - 60 });
    const acts = availableActs(p, HOLDER, NOW, 5n);
    expect([...offered(acts), ...withheld(acts)].map((a) => a.id).sort()).toEqual(
      ids(acts).sort(),
    );
    expect(offered(acts).every((a) => a.blocked === "")).toBe(true);
    expect(withheld(acts).every((a) => a.blocked !== "")).toBe(true);
  });

  it("gives every act a label, a line about what it does, and a cost", () => {
    const p = final({ appeal_open: true, appellant: HOLDER.toLowerCase(), appeal_filed_epoch: NOW - 60 });
    for (const act of availableActs(p, HOLDER, NOW, 7n)) {
      expect(act.label.length).toBeGreaterThan(0);
      expect(act.does.length).toBeGreaterThan(0);
      expect(typeof act.cost).toBe("bigint");
    }
  });

  it("keeps machine values out of every sentence it writes", () => {
    // No epochs, no atto figures, no enum spellings on the page face.
    const cases: Policy[] = [
      policy(),
      policy({ coverage_end_epoch: NOW - 60 }),
      active(),
      active({ status: "INVESTIGATING", evidence_version: 1 }),
      active({ status: "PENDING_FINALITY", pending_version: 1, pending_until_epoch: NOW + 60 }),
      final(),
      final({ appeal_open: true, appeal_filed_epoch: NOW - 60, evidence_version: 2 }),
    ];
    for (const p of cases) {
      for (const who of [INSURER, HOLDER, STRANGER]) {
        for (const act of availableActs(p, who, NOW, 25n * 10n ** 15n)) {
          const text = `${act.label} ${act.does} ${act.blocked}`;
          expect(text).not.toMatch(/\b1[78]\d{8}\b/); // an epoch
          expect(text).not.toMatch(/(?<![.\d])\d{16,}/); // an atto figure
          expect(text).not.toMatch(/[A-Z]{4,}_[A-Z]/); // an enum spelling
        }
      }
    }
  });
});

describe("formatGenExact — the figure an exact-match amount is shown as", () => {
  it("trims a round number and keeps a long one whole", () => {
    expect(formatGenExact(5n * 10n ** 16n)).toBe("0.05");
    expect(formatGenExact(10n ** 18n)).toBe("1");
    expect(formatGenExact("0")).toBe("0");
    expect(formatGenExact(1n)).toBe("0.000000000000000001");
    expect(formatGenExact("1500000000000000")).toBe("0.0015");
  });
});
