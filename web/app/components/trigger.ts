import type { Policy } from "../../lib/read";

const OP_WORDS: Record<string, string> = {
  GTE: "at or above",
  GT: "above",
  LTE: "at or below",
  LT: "below",
};

/** The trigger as the sentence the two parties signed: the one fact a reader
 *  came for, and the headline of every row and page that shows a policy. */
export function triggerSentence(p: Policy): string {
  return `${p.metric} ${OP_WORDS[p.operator] ?? p.operator} ${p.threshold} ${p.unit}`;
}
