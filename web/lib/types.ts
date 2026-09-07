/** Shapes the contract's views return, and the composer mirrors. */
export type BasisEntry = {
  kind: string;
  origin: string;
  class: "INDEPENDENT" | "PARTY";
};

export type { ClaimPackage, Decision, DecisionRow, Policy, Stats } from "./read";
