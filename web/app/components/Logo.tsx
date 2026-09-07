/** The mark's palette. Violet is the brand accent and belongs to the record;
 *  the threshold rule and the pre-trigger reading stay in the neutral scale. */
export const IRIS = "#9281f7";
export const HAIRLINE = "#292d30";
export const ASH = "#a1a4a5";

/**
 * The mark: a threshold rule, a reading that runs beneath it in ash, and the
 * moment it crosses — a violet node — after which the reading is violet. The
 * crossing IS the determination, which is the whole product in one glyph.
 *
 * At 16px the two strokes read as one rising line breaking a bar; at 48px the
 * colour change at the node is legible as the trigger being met.
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
      <rect width="64" height="64" rx="12" fill="#000000" />
      {/* the agreed threshold */}
      <path d="M8 40h48" stroke={HAIRLINE} strokeWidth="2" strokeLinecap="round" />
      {/* the reading below it: measured, not yet triggering */}
      <path
        d="M10 50l10-4 8-6"
        fill="none" stroke={ASH} strokeWidth="4"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {/* the reading past it */}
      <path
        d="M28 40l8-14 8 6 10-18"
        fill="none" stroke={IRIS} strokeWidth="4"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {/* the crossing */}
      <circle cx="28" cy="40" r="4.5" fill={IRIS} />
    </svg>
  );
}
