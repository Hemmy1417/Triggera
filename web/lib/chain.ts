/**
 * Chain constants and pure helpers — no browser, no provider, fully testable.
 * The wallet layer builds on these; nothing in this file can touch a network.
 */
import { studioDevnet } from "genlayer-js/chains";
import { GENLAYER_CHAIN_ID, GENLAYER_EXPLORER_URL, GENLAYER_RPC_URL } from "./config";

export const CHAIN_ID = GENLAYER_CHAIN_ID;

/** EIP-695 hex chain id: lowercase, no leading zeros. 61997 -> "0xf22d". */
export function toChainHex(id: number): `0x${string}` {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`bad chain id: ${id}`);
  return `0x${id.toString(16)}` as `0x${string}`;
}

export const CHAIN_HEX = toChainHex(CHAIN_ID);

/**
 * GenLayer Studio Next as a genlayer-js chain.
 *
 * The SDK ships `studioDevnet` — chain id 61997, the preview Studio — pointed
 * at studio-dev.genlayer.com. Studio Next answers at studio-next.genlayer.com
 * on the same chain id with the same embedded consensus contracts, so this is
 * that definition with the RPC swapped and named for what it is. The id
 * follows lib/config rather than the SDK so the client's chain, the wallet's
 * network check and wallet_addEthereumChain can never disagree; by default
 * they are all 61997. It is a CLONE, never the SDK's singleton: createClient's
 * `endpoint` option writes into whatever chain object it is handed, and
 * lib/read.ts clones this again to point reads at the proxy.
 *
 * WHERE EACH RPC METHOD GOES — read from the SDK's transport
 * (dist/index.js, getCustomTransportConfig), not assumed. The client hands
 * exactly six methods to the wallet provider: eth_accounts,
 * eth_requestAccounts, eth_sendTransaction, eth_signTransaction,
 * personal_sign and eth_signTypedData_v4. EVERYTHING ELSE is POSTed to
 * `chain.rpcUrls.default.http[0]`, and that includes the fee machinery a
 * Studio Next write cannot do without: sim_getFeeConfig (the fee policy),
 * sim_estimateTransactionFees (the simulated write that yields the deposit
 * and the message allocations), and, around signing, the SDK's own
 * eth_getTransactionCount / eth_estimateGas / eth_gasPrice / eth_blockNumber /
 * eth_getTransactionReceipt. So the write client in lib/wallet.tsx is built on
 * THIS chain — the real RPC — and never on the read layer's proxy clone: the
 * proxy's allowlist forwards gen_call reads and eth_getTransactionByHash only,
 * and would refuse sim_getFeeConfig with -32601 before any estimate could be
 * made. tests/signed-write.test.ts pins the split: fee RPCs over fetch to this
 * URL, eth_sendTransaction to the provider.
 *
 * Two more things ride on the spread of studioDevnet and cannot be seen from
 * here. `isStudio: true` is what selects the sim_* fee path at all
 * (readCurrentFeePolicy → sim_getFeeConfig; estimateTransactionFeesForWrite →
 * sim_estimateTransactionFees), and it is also what makes the SDK SKIP its own
 * eth_chainId check before eth_sendTransaction (assertChainMatch returns early
 * for Studio chains) — so the chainOk flag in lib/wallet.tsx is the only
 * network guard a write has, and the wallet broadcasts to whatever network it
 * is on. The embedded consensusMainContract is the `to` of every write, with
 * defaultNumberOfInitialValidators 5 and defaultConsensusMaxRotations 3
 * sizing the deposit.
 *
 * Measured on Studio Next (probe against the deployed contract): a write the
 * contract refuses fails at sim_estimateTransactionFees as JSON-RPC error
 * -32000 "execution failed", with the contract's own "[EXPECTED] …" sentence
 * base64-encoded behind one tag byte in data.receipt.result; viem re-raises
 * that as InvalidInputRpcError with the raw error on `cause`. lib/tx.ts
 * decodes it so the user reads the contract's sentence, not viem's.
 */
export const STUDIO_NEXT = {
  ...studioDevnet,
  id: CHAIN_ID,
  name: "GenLayer Studio Next",
  rpcUrls: { default: { http: [GENLAYER_RPC_URL] } },
  blockExplorers: {
    default: { name: "GenLayer Studio Next", url: GENLAYER_EXPLORER_URL },
  },
};

/** wallet_addEthereumChain params for GenLayer Studio Next. */
export const STUDIO_NEXT_PARAMS = {
  chainId: CHAIN_HEX,
  chainName: "GenLayer Studio Next",
  rpcUrls: [GENLAYER_RPC_URL],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
} as const;

/**
 * Did the wallet just say "I have never heard of this chain"?
 *
 * EIP-3326 assigns that answer code 4902, and a wallet that already knows a
 * network never sends it — which is why every sibling app, whose users had
 * StudioNet installed long ago, could check `err.code === 4902` and never
 * notice that MetaMask does NOT put the code at the top level. Measured on
 * MetaMask against Studio Next (a chain nobody's wallet has yet): the switch
 * request rejects with `code: -32603` and the 4902 nested under
 * `data.originalError`, with the message "Unrecognized chain ID "0xf22d".
 * Try adding the chain using wallet_addEthereumChain first." Checking the
 * top-level code alone let that message reach the user verbatim and the
 * add-network prompt never opened. Rabby and Coinbase Wallet each spell the
 * nesting slightly differently, so the code is looked for at every level the
 * major wallets use and the message is the last resort.
 */
export function isUnknownChainError(err: unknown): boolean {
  const e = err as {
    code?: unknown;
    message?: unknown;
    data?: { originalError?: { code?: unknown; message?: unknown }; code?: unknown };
    cause?: { code?: unknown; message?: unknown };
  } | undefined;
  const codes = [e?.code, e?.data?.originalError?.code, e?.data?.code, e?.cause?.code];
  if (codes.some((c) => c === 4902 || c === "4902")) return true;
  const text = [e?.message, e?.data?.originalError?.message, e?.cause?.message]
    .filter((m) => typeof m === "string")
    .join(" ");
  return /unrecognized chain|wallet_addEthereumChain|\b4902\b/i.test(text);
}

/** 0x1234ab…cdef — the display form of a connected identity. */
export function truncAddr(addr: string): string {
  return addr.length > 13 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}

/**
 * Map raw EIP-1193 errors to words a person can act on.
 *
 * The UI standard forbids "Something went wrong": every failure must say what
 * happened, why, and what to do next. These are the four the wallet actually
 * produces; anything else falls through with its own message rather than
 * being flattened into a generic string.
 */
export function walletErrorMessage(err: unknown): string {
  const e = err as { code?: number; message?: string } | undefined;
  if (e?.code === 4001) {
    return "You declined the request in your wallet. Nothing was sent.";
  }
  if (e?.code === -32002) {
    return "Your wallet already has a request open. Finish or dismiss it, then try again.";
  }
  if (e?.code === 4902) {
    return "GenLayer Studio Next isn't in this wallet yet. Approve the prompt to add it.";
  }
  if (e?.code === 4900 || e?.code === 4901) {
    return "Your wallet is disconnected from the network. Reconnect and try again.";
  }
  return e?.message ? e.message.slice(0, 160) : "The wallet call failed.";
}

/** Transient RPC noise that should be retried rather than surfaced. */
const TRANSIENT =
  /\[transient\]|rate limit|429|-32029|failed to fetch|fetch failed|unreachable|doctype|not valid json|unexpected token|502|503|504|timeout|econnreset|socket|server busy|execution slots|retry later/i;

export function isTransient(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");
  return TRANSIENT.test(msg);
}

/**
 * Do two addresses refer to the same account?
 *
 * They are never spelled the same way. The contract normalises every address
 * to LOWERCASE hex before storing it, while the wallet layer runs connected
 * accounts through viem's getAddress, which returns EIP-55 mixed case. So
 * `agreement.operator === address` is false for the operator's own agreement,
 * every time. Comparing raw strings would hide the operator's controls from
 * the operator and show "your agreement" to nobody.
 *
 * Every ownership check in the app goes through this.
 */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
