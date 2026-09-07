"use client";

import { STUDIO_NEXT } from "../../lib/chain";
import { useWallet } from "../../lib/wallet";
import { Hex } from "./bits";

/** "GenLayer Studio Next" → "Studio Next": the pill has one line. */
const CHAIN_SHORT = STUDIO_NEXT.name.replace(/^GenLayer\s+/, "");

/**
 * The network state, beside the wallet. Nothing while no wallet is
 * connected (there is no network to be on); the chain's name with a filled
 * hexagon when the wallet is on Studio Next; otherwise a warning pill that
 * IS the switch action, because the SDK skips its own chain check on Studio
 * chains and the wallet would broadcast to whatever network it is on.
 */
export function NetworkPill() {
  const { address, chainOk, switchNetwork } = useWallet();
  if (!address) return null;
  if (chainOk) {
    return (
      <span className="netpill" title={`Connected on ${STUDIO_NEXT.name}`}>
        <Hex fill />
        {CHAIN_SHORT}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="netpill warn"
      onClick={() => void switchNetwork()}
      title={`Switch your wallet to ${STUDIO_NEXT.name}`}
    >
      <Hex />
      Wrong network, switch
    </button>
  );
}
