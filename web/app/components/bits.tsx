"use client";

/**
 * The small pieces the whole app is built from. Two rules run through them:
 * a technical identifier is violet and monospaced (the reference's treatment
 * of email addresses, applied to policy ids, hashes and publisher domains),
 * and a hue only ever means a determination.
 */

/** A status dot. The class carries the meaning; there is no other place in
 *  the app where a colour is allowed to say something. */
export function Dot({ state }: { state: string }) {
  return <i className={`dot ${state.toLowerCase().replace(/_/g, "-")}`} aria-hidden />;
}

/** A lifecycle or determination state, as a dot and a word. */
export function Status({ state, label }: { state: string; label?: string }) {
  return (
    <span className="status">
      <Dot state={state} />
      {label ?? state.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

/** A technical identifier: whole in the DOM, truncated by CSS, one click to
 *  copy. Violet because it is a machine string, never because it matters. */
export function Ident({ value, label = "Copy" }: { value: string; label?: string }) {
  if (!value) return <span className="faint">—</span>;
  return (
    <span title={value} style={{ whiteSpace: "nowrap" }}>
      <span className="addr">{value}</span>
      <button
        className="copy-btn"
        onClick={() => void navigator.clipboard?.writeText(value)}
        aria-label={label}
      >
        copy
      </button>
    </span>
  );
}

/** The plumbing copied from the sibling imports these two names. */
export const Addr = Ident;
export function Hex({ value }: { value: string }) {
  return <Ident value={value} label="Copy hash" />;
}

/** A labelled figure. The number never renders lighter than its label. */
export function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit ? <span className="stat-unit"> {unit}</span> : null}
      </span>
    </div>
  );
}

/** loading / empty / unreachable are three states with three sentences; a
 *  failed read must never render as an empty record. */
export function StateNote({
  kind,
  children,
}: {
  kind: "loading" | "empty" | "unreachable";
  children: React.ReactNode;
}) {
  return <div className={`note${kind === "unreachable" ? " error" : ""}`}>{children}</div>;
}

/** The technical fold: every machine value the page owes the reader, and
 *  none of them in the prose above it. */
export function Technical({
  rows,
  summary = "Technical record",
}: {
  rows: Array<[string, React.ReactNode]>;
  summary?: string;
}) {
  return (
    <details className="technical">
      <summary>{summary}</summary>
      <dl className="technical-rows">
        {rows.map(([k, v]) => (
          <div className="technical-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
