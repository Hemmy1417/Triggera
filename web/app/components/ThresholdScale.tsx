"use client";

/**
 * THE THRESHOLD SCALE — the determination, drawn.
 *
 * Every reading the panel took is a node on one axis, with the agreed
 * threshold as the only vertical line. Nodes past it are green, nodes short
 * of it red, and a party's own source is hollow because it never counts
 * toward anything. The determination is then visible before it is read: how
 * many solid nodes sit on the paying side of the line.
 *
 * This is deliberately NOT a chart of an average. There is no bar, no mean
 * marker and no trend, because the contract never averages: it counts
 * publishers. A picture that implied otherwise would be lying about the
 * mechanism.
 */

export type ScaleNode = {
  publisher: string;
  reading: number | null;
  /** counted and past the threshold */
  qualifying?: boolean;
  /** counted and short of it */
  contradicting?: boolean;
  /** a party's own instrument: shown, never counted */
  party?: boolean;
};

function classOf(n: ScaleNode): string {
  if (n.party) return "party";
  if (n.qualifying) return "qualifying";
  if (n.contradicting) return "contradicting";
  return "unusable";
}

export function ThresholdScale({
  nodes,
  threshold,
  unit,
  operator,
}: {
  nodes: ScaleNode[];
  threshold: number;
  unit: string;
  operator: string;
}) {
  const readings = nodes
    .map((n) => n.reading)
    .filter((r): r is number => typeof r === "number");
  if (readings.length === 0) {
    return (
      <p className="body-sm muted" style={{ marginTop: 12 }}>
        No source stated a usable reading, so there is nothing to place against the
        threshold.
      </p>
    );
  }

  /* The axis spans the readings and the threshold with a margin, so the
     threshold is always on screen even when every reading sits far from it. */
  const lo = Math.min(...readings, threshold);
  const hi = Math.max(...readings, threshold);
  const pad = Math.max((hi - lo) * 0.18, Math.max(hi, 1) * 0.04);
  const min = lo - pad;
  const max = hi + pad;
  const at = (v: number) => ((v - min) / (max - min)) * 100;

  const paysAbove = operator === "GTE" || operator === "GT";
  const tPos = at(threshold);
  /* Alternation only separates neighbours if it follows the order they are
     drawn in, so the nodes are sorted by reading, not by arrival. */
  const placed = nodes
    .filter((n): n is ScaleNode & { reading: number } => typeof n.reading === "number")
    .sort((a, b) => a.reading - b.reading);

  return (
    <>
      <p className="scale-caption">
        {paysAbove
          ? "Each publisher speaks once. The trigger is met when a majority sit right of the line."
          : "Each publisher speaks once. The trigger is met when a majority sit left of the line."}
      </p>
      <div className="scale">
      <div className="scale-axis">
        <div
          className="scale-pays"
          style={paysAbove ? { left: `${tPos}%`, right: 0 } : { left: 0, right: `${100 - tPos}%` }}
        />
        <div
          className="scale-threshold"
          data-label={`threshold ${threshold} ${unit}`}
          style={{ left: `${tPos}%` }}
        />
        {placed.map((n, i) => (
          <span key={n.publisher + i}>
            <i
              className={`scale-node ${classOf(n)}`}
              style={{ left: `${at(n.reading)}%` }}
              aria-hidden
            />
            <span
              className={`scale-tag ${i % 2 === 0 ? "below" : "above"}`}
              style={{ left: `${at(n.reading)}%` }}
            >
              <span className="v">
                {n.reading} {unit}
              </span>
              <span className="who">{n.publisher}</span>
            </span>
          </span>
        ))}
      </div>
      <div className="scale-ends">
        <span>{Math.round(min)}</span>
        <span>{Math.round(max)}</span>
      </div>
      </div>
    </>
  );
}
