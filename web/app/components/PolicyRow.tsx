"use client";

import Link from "next/link";
import { formatGen } from "../../lib/config";
import type { Policy } from "../../lib/read";
import { Status } from "./bits";

const OP_WORDS: Record<string, string> = {
  GTE: "at or above",
  GT: "above",
  LTE: "at or below",
  LT: "below",
};

/** The trigger as the sentence the two parties signed. This is the row's
 *  headline, the way a rate is a vault's headline: the one fact a reader
 *  came for. */
export function triggerSentence(p: Policy): string {
  return `${p.metric} ${OP_WORDS[p.operator] ?? p.operator} ${p.threshold} ${p.unit}`;
}

function windowWords(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) {
    const d = hours / 24;
    return d === 1 ? "24 hours" : `${d} days`;
  }
  return `${hours} hours`;
}

/** What the record currently says about the trigger, in words. A hue is
 *  attached to it and to nothing else on the row. */
function determination(p: Policy): { state: string; label: string } {
  if (p.outcome === "SATISFIED") return { state: "satisfied", label: "trigger met" };
  if (p.outcome === "NOT_SATISFIED") return { state: "not-satisfied", label: "trigger not met" };
  if (p.outcome === "UNDETERMINED") return { state: "undetermined", label: "undetermined" };
  if (p.status === "INVESTIGATING") return { state: "investigating", label: "reading evidence" };
  if (p.status === "PENDING_FINALITY") return { state: "pending-finality", label: "awaiting finality" };
  return { state: p.status.toLowerCase(), label: "no claim filed" };
}

/**
 * One policy, whole. Everything a reader needs to judge it is here — the
 * trigger, the money, how many publishers must agree, the period, who the
 * evidence may come from and what the record currently says — so the detail
 * page is where you go to READ the evidence, not to learn the basics.
 */
export function PolicyRow({ policy: p }: { policy: Policy }) {
  const d = determination(p);
  const publishers = (p.basis ?? []).filter((b) => b.class === "INDEPENDENT");
  return (
    <Link href={`/policies/${p.policy_id}`} className="policyrow">
      <div className="policyrow-head">
        <div style={{ minWidth: 0 }}>
          <div className="policyrow-title">{triggerSentence(p)}</div>
          <div className="policyrow-sub">
            {p.title} · {p.region}, {p.country}
          </div>
        </div>
        <div className="policyrow-badges">
          <span className="badge">{p.event_type.toLowerCase()}</span>
          <Status state={d.state} label={d.label} />
        </div>
      </div>

      <dl className="policyrow-metrics">
        <div className="rowmetric">
          <dt>Coverage</dt>
          <dd className="figure">{formatGen(p.coverage_atto)} GEN</dd>
        </div>
        <div className="rowmetric">
          <dt>Premium</dt>
          <dd className="figure">{formatGen(p.premium_atto)} GEN</dd>
        </div>
        <div className="rowmetric">
          <dt>Measured over</dt>
          <dd className="figure">{windowWords(p.measurement_hours)}</dd>
        </div>
        <div className="rowmetric">
          <dt>Publishers required</dt>
          <dd className="figure">
            {p.min_independent} of {publishers.length || "—"}
          </dd>
        </div>
        <div className="rowmetric wide">
          <dt>Evidence may come from</dt>
          <dd>
            {publishers.length === 0 ? (
              <span className="faint">not read</span>
            ) : (
              <span className="publisherlist">
                {publishers.map((b) => (
                  <span key={b.origin} className="ident">
                    {b.origin}
                  </span>
                ))}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
