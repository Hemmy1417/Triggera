/** The mark's palette, matching the tokens in globals.css. Violet is the
 *  brand accent and belongs to a publisher that carried past the trigger;
 *  the threshold itself is white, and a publisher short of it stays in the
 *  neutral scale. */
export const VOID = "#07080a";
export const IRIS = "#9281f7";
export const IRON = "#6e727a";
export const THRESHOLD = "#ffffff";

/**
 * The mark: the determination itself.
 *
 * Three bars are three publishers; the white vertical rule is the agreed
 * threshold. Two bars run past it, one stops short — two of three, which is
 * the majority that pays. The picture IS the derivation, and it is the app's
 * own ThresholdScale reduced to one glyph.
 *
 * The threshold is VERTICAL on purpose. ThresholdScale draws it that way,
 * with readings placed left and right of the line, and an earlier mark that
 * put a rising curve through a HORIZONTAL rule contradicted the app's own
 * diagram — besides reading as a stock chart, which this product is not.
 * Nothing here is a value or an average: the mark counts, as the contract
 * does.
 *
 * At 16px the three bars and the rule survive as distinct blocks (rendered
 * and checked at 16, 32 and 64). The dark plate is carried by the mark itself
 * so a light browser tab strip renders it identically to a dark one.
 *
 * app/icon.svg is the same drawing as a static file; keep the two in step.
 */
export function Logo({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="64" height="64" rx="13" fill={VOID} />
      {/* two publishers past the trigger */}
      <rect x="8" y="9" width="44" height="13" rx="3" fill={IRIS} />
      <rect x="8" y="27" width="44" height="13" rx="3" fill={IRIS} />
      {/* one short of it */}
      <rect x="8" y="45" width="15" height="13" rx="3" fill={IRON} />
      {/* the agreed threshold */}
      <rect x="30" y="2" width="7" height="60" rx="3" fill={THRESHOLD} />
    </svg>
  );
}
