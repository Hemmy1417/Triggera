/**
 * TypeScript mirrors of the contract's pure URL rules (contracts/verda.py:
 * _valid_url, _valid_origin, _split_url, _host_of, _normalize_url,
 * _registrable_domain, _matches_origin), so the composer can refuse locally
 * exactly what the contract would refuse — before a wallet opens, with the
 * same answer. tests/urls.test.ts pins each one against the tables in
 * tests/direct/test_evidence.py; a rule that drifts from the Python fails
 * there, not in a reverted transaction.
 *
 * Nothing here decides anything on-chain. The contract re-runs every rule at
 * intake, and its answer is the only one that counts.
 */
import type { BasisEntry } from "./types";

export const MIN_URL_CHARS = 12;
export const MAX_URL_CHARS = 400;
export const MIN_ORIGIN_CHARS = 4;
export const MAX_ORIGIN_CHARS = 120;

const FENCE_FORGERS = ["<", ">", '"', "'", "`", "|", "\\"];

/** Printable ASCII only, no character that could forge fence structure. The
 *  scheme is matched case-sensitively, as the contract matches it. */
export function validUrl(u: unknown): boolean {
  if (typeof u !== "string") return false;
  if (!(u.startsWith("https://") || u.startsWith("http://"))) return false;
  for (let i = 0; i < u.length; i++) {
    const c = u.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  for (const ch of FENCE_FORGERS) if (u.includes(ch)) return false;
  return u.length >= MIN_URL_CHARS && u.length <= MAX_URL_CHARS;
}

/** A hostname: lowercase letters, digits, dots and hyphens, at least one dot,
 *  no empty labels, no label opening or closing with a hyphen. Lowercases
 *  nothing — the contract lowercases before it checks, and the form does too. */
export function validOrigin(o: string): boolean {
  if (o.length < MIN_ORIGIN_CHARS || o.length > MAX_ORIGIN_CHARS) return false;
  if (!o.includes(".") || o.startsWith(".") || o.endsWith(".") || o.includes("..")) return false;
  for (let i = 0; i < o.length; i++) {
    const ch = o[i];
    const ok = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "." || ch === "-";
    if (!ok) return false;
  }
  for (const label of o.split(".")) {
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  return true;
}

export type SplitUrl = { scheme: string; host: string; port: string; path: string; query: string };

/**
 * A small, total parser for the ASCII URLs validUrl admits.
 *
 * The authority ends at the FIRST of '/', '?' or '#' (RFC 3986), not at '/'
 * alone: cutting at '/' only let `https://evil.io?x=@sat.example.org` strip
 * its "userinfo" inside the query and report the basis host while every node
 * fetched evil.io. Userinfo is then stripped at the LAST '@' of the authority.
 */
export function splitUrl(u: string): SplitUrl {
  const sep = u.indexOf("://");
  const scheme = sep >= 0 ? u.slice(0, sep) : u;
  let rest = sep >= 0 ? u.slice(sep + 3) : "";
  const hash = rest.indexOf("#");
  if (hash >= 0) rest = rest.slice(0, hash);
  let cut = rest.length;
  for (const s of ["/", "?"]) {
    const i = rest.indexOf(s);
    if (i >= 0 && i < cut) cut = i;
  }
  let hostport = rest.slice(0, cut);
  const tail = rest.slice(cut);
  const pathQ = tail.startsWith("?") ? "/" + tail : tail.startsWith("/") ? tail : "/";
  const q = pathQ.indexOf("?");
  const path = q >= 0 ? pathQ.slice(0, q) : pathQ;
  const query = q >= 0 ? pathQ.slice(q + 1) : "";
  const at = hostport.lastIndexOf("@");
  if (at >= 0) hostport = hostport.slice(at + 1);
  const colon = hostport.indexOf(":");
  const host = colon >= 0 ? hostport.slice(0, colon) : hostport;
  const port = colon >= 0 ? hostport.slice(colon + 1) : "";
  return { scheme: scheme.toLowerCase(), host: host.toLowerCase(), port, path, query };
}

export function hostOf(u: string): string {
  return splitUrl(u).host;
}

/** S35: two spellings of one page are one page. Lowercase scheme and host,
 *  default port dropped, fragment dropped, one trailing slash dropped, query
 *  kept as written. */
export function normalizeUrl(u: string): string {
  const parsed = splitUrl(u.trim());
  const { scheme, port, query } = parsed;
  let { host, path } = parsed;
  const defaultPort = (scheme === "https" && port === "443") || (scheme === "http" && port === "80");
  if (port && !defaultPort) host = `${host}:${port}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${scheme}://${host}${path}${query ? `?${query}` : ""}`;
}

const SECOND_LEVEL = ["co", "com", "org", "net", "gov", "edu", "ac", "or", "ne", "go"];

/** The publisher behind a host: 'data.example.org' → 'example.org',
 *  'a.example.co.uk' → 'example.co.uk'. The same small suffix heuristic the
 *  contract states; independence is counted per publisher. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split(":")[0].split(".");
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1];
  if (tld.length === 2 && SECOND_LEVEL.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/** A host is inside an origin when it equals it or sits under it at a dot
 *  boundary — `notsat.example.org` is outside `sat.example.org`. */
export function matchesOrigin(host: string, origin: string): boolean {
  return host === origin || host.endsWith("." + origin);
}

/** The basis entry a URL inherits kind and class from: the LONGEST matching
 *  origin, whatever order the basis lists them in. Null when the host is
 *  outside the basis — the contract refuses the whole package for that. */
export function matchBasis(url: string, basis: BasisEntry[]): BasisEntry | null {
  const host = hostOf(url);
  let matched: BasisEntry | null = null;
  for (const b of basis) {
    if (matchesOrigin(host, b.origin) && (!matched || b.origin.length > matched.origin.length)) {
      matched = b;
    }
  }
  return matched;
}

/** How many publishers these hosts belong to. Two pages on one publisher are
 *  one voice, however many there are. */
export function distinctPublishers(hosts: string[]): number {
  return new Set(hosts.map(registrableDomain)).size;
}
