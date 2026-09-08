/** Build-time configuration. The contract address compiles into the bundle,
 * so a deployment that changes it must rebuild — set it in the host's env
 * BEFORE the first build, not after. */

export const CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? ""
).trim();

export const CONTRACT_CONFIGURED = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS);

/** GenLayer Studio Next. Chain id 61997 — the SDK's `studioDevnet` id — on
 *  its own RPC host; see STUDIO_NEXT in lib/chain.ts for the wiring. */
export const GENLAYER_RPC_URL = (
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api"
).trim();

export const GENLAYER_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID ?? "61997",
);

/**
 * Studio Next's block explorer, which serves /tx/<hash> and /address/<addr>.
 * Links in the app go to those routes directly; the hash or address is still
 * shown whole beside every link, so a reader can check the destination
 * against the value rather than trusting the anchor.
 */
export const GENLAYER_EXPLORER_URL = (
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL ?? "https://explorer-studio-dev.genlayer.com"
)
  .trim()
  .replace(/\/+$/, "");

const ATTO = 10n ** 18n;

/** "0.100" — GEN with three decimals, from an atto string. Display only. */
export function formatGen(atto: string | bigint, decimals = 3): string {
  let v: bigint;
  try {
    v = typeof atto === "bigint" ? atto : BigInt(String(atto || "0"));
  } catch {
    return "0";
  }
  const negative = v < 0n;
  if (negative) v = -v;
  const whole = v / ATTO;
  const frac = ((v % ATTO) * 10n ** BigInt(decimals)) / ATTO;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole.toString()}${decimals ? "." + fracStr : ""}`;
}

/** basis points → "85%" or "8.5%" — trailing zeros trimmed. */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** Seconds → "14 days" / "3 hours" / "15 minutes": the largest whole unit
 *  that reads as a human span. Windows are shown this way everywhere; the
 *  raw seconds live only in technical folds. */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 172_800) return `${Math.floor(s / 86_400)} days`;
  if (s >= 86_400) return "1 day";
  if (s >= 7_200) return `${Math.floor(s / 3_600)} hours`;
  if (s >= 3_600) return "1 hour";
  if (s >= 120) return `${Math.floor(s / 60)} minutes`;
  if (s >= 60) return "1 minute";
  return `${s} seconds`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Epoch → "5 Sep 2026, 13:52 UTC". UTC and a fixed month table so the same
 *  epoch renders identically on every machine; "not recorded" for zero, the
 *  contract's value for an event that has not happened. */
export function formatStamp(epoch: number): string {
  if (!epoch) return "not recorded";
  const d = new Date(epoch * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** Epoch → "5 Sep 2026": the date alone, for columns where the time is noise. */
export function formatDate(epoch: number): string {
  if (!epoch) return "not recorded";
  const d = new Date(epoch * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "in 12 minutes" / "3 hours ago" / "now": the distance from `now`, in the
 *  largest unit that stays honest. Both arguments are epoch seconds. */
export function formatRelative(epoch: number, now: number): string {
  const diff = epoch - now;
  const abs = Math.abs(diff);
  if (abs < 60) return "now";
  let n: number;
  let unit: string;
  if (abs < 3_600) {
    n = Math.floor(abs / 60);
    unit = "minute";
  } else if (abs < 172_800) {
    n = Math.floor(abs / 3_600);
    unit = "hour";
  } else {
    n = Math.floor(abs / 86_400);
    unit = "day";
  }
  const span = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

/** "5 Sep 2026, 13:52 UTC (in 12 minutes)": the stamp with its distance. */
export function formatWhen(epoch: number, now: number): string {
  if (!epoch) return "not recorded";
  return `${formatStamp(epoch)} (${formatRelative(epoch, now)})`;
}
