"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CONTRACT_ADDRESS,
  CONTRACT_CONFIGURED,
  GENLAYER_EXPLORER_URL,
} from "../../lib/config";
import { Ident } from "./bits";
import { Logo } from "./Logo";
import { NetworkPill } from "./NetworkPill";
import { WalletButton } from "./WalletButton";

const DOCS = "https://github.com/Hemmy1417/Triggera/blob/main/docs";

/**
 * Explorer links into the Studio Next block explorer, which serves per-address
 * and per-transaction routes. Every call site still shows the hash or address
 * WHOLE beside the link, with copy, so the record is legible without it.
 */
export function explorerAddress(addr: string): string {
  return `${GENLAYER_EXPLORER_URL}/address/${addr}`;
}
export function explorerTx(hash: string): string {
  return `${GENLAYER_EXPLORER_URL}/tx/${hash}`;
}

const NAV: Array<{ href: string; label: string }> = [
  { href: "/create", label: "Write a policy" },
  { href: "/rules", label: "How it works" },
];

/** The persistent navbar: the mark and wordmark, sentence-case links, the
 *  network state and the wallet. The footer keeps the contract address whole
 *  with copy, the explorer and the docs. */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <Link href="/" className="brand" aria-label="Triggera home">
            <Logo size={28} />
            <span className="brand-name">Triggera</span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={path.startsWith(n.href) ? "nav-link on" : "nav-link"}
                aria-current={path.startsWith(n.href) ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="nav-tools">
            <NetworkPill />
            <WalletButton />
          </div>
        </div>
      </header>

      {children}

      <footer className="colophon">
        <div className="colophon-inner">
          <span>
            Triggera verifies parametric insurance triggers on GenLayer Studio Next.
          </span>
          <span>
            {CONTRACT_CONFIGURED ? (
              <>
                contract <Ident value={CONTRACT_ADDRESS} label="Copy contract address" />{" "}
                ·{" "}
                <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
                  Explorer
                </a>
              </>
            ) : (
              <>no contract configured</>
            )}{" "}
            · <a href={DOCS} target="_blank" rel="noreferrer">Docs</a>
          </span>
        </div>
      </footer>
    </>
  );
}
