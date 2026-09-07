"use client";

import { STAGE_LABEL, STAGE_TRACK, stageClass, type TxProgress } from "../../lib/tx";
import { Addr } from "./bits";
import { explorerTx } from "./Shell";

/** The transaction stepper: estimating → signing → submitted → pending →
 *  accepted → finalized, one hexagon per stage — outlined ahead, filled once
 *  reached — with the chain's own hash shown the moment one exists. A
 *  terminal report names the stage it belongs to (`at`), so a refusal in the
 *  fee simulation is painted there and not on a wallet that never opened. */
export function TxFlow({ p }: { p: TxProgress | null }) {
  if (!p || p.stage === "idle") return null;
  return (
    <div className="txflow" role="status">
      <div className="txsteps">
        {STAGE_TRACK.map((s) => (
          <span key={s} className={stageClass(s, p.stage, p.at)}>
            <i className="hex" aria-hidden />
            {STAGE_LABEL[s]}
          </span>
        ))}
        {(p.stage === "failed" || p.stage === "rejected" || p.stage === "unresolved") && (
          <span className="step fail">
            <i className="hex" aria-hidden />
            {STAGE_LABEL[p.stage]}
          </span>
        )}
      </div>
      <div className="txdetail">
        {p.detail}{" "}
        {p.hash ? (
          // Studio Next has no per-transaction page, so the link opens the
          // Studio and the hash sits beside it — whole in the DOM, truncated
          // by CSS, one click to copy — for the reader to look up there.
          <>
            <a href={explorerTx(p.hash)} target="_blank" rel="noreferrer">
              open Studio Next
            </a>{" "}
            <Addr value={p.hash} label="Copy transaction hash" />
          </>
        ) : null}
      </div>
    </div>
  );
}
