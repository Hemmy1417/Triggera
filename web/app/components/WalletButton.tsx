"use client";

import { useEffect, useRef, useState } from "react";
import { truncAddr } from "../../lib/chain";
import { useWallet } from "../../lib/wallet";

/** The wallet control: a quiet pill that connects, or the connected address
 *  with a small menu. The network state lives in the pill beside it. */
export function WalletButton() {
  const { address, chainOk, connecting, wallets, error, connect, disconnect, switchNetwork } =
    useWallet();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (address) {
    return (
      <div className="wallet-pop" ref={boxRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="pill quiet mono"
          title={address}
          aria-expanded={open}
        >
          {truncAddr(address)}
        </button>
        {open && (
          <div className="wallet-menu">
            {!chainOk && (
              <button onClick={() => void switchNetwork()}>
                Switch to GenLayer Studio Next
              </button>
            )}
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(address);
                setOpen(false);
              }}
            >
              Copy address
            </button>
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-pop" ref={boxRef}>
      <button
        type="button"
        className="pill quiet"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {connecting ? "Connecting" : "Connect wallet"}
      </button>
      {open && (
        <div className="wallet-menu">
          {wallets.length === 0 && (
            <button disabled>No wallet extension found</button>
          )}
          {wallets.map((w) => (
            <button
              key={w.info.uuid}
              onClick={() => {
                void connect(w).then(() => setOpen(false)).catch(() => {});
              }}
            >
              {w.info.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.info.icon} alt="" />
              ) : null}
              {w.info.name}
            </button>
          ))}
          {error && <button disabled>{error}</button>}
        </div>
      )}
    </div>
  );
}
