import { describe, expect, it } from "vitest";
import { isUnknownChainError, toChainHex, walletErrorMessage } from "../lib/chain";

describe("isUnknownChainError — the shapes wallets actually send for EIP-3326 4902", () => {
  it("recognizes the spec's top-level code", () => {
    expect(isUnknownChainError({ code: 4902, message: "Unrecognized chain ID" })).toBe(true);
  });

  it("recognizes MetaMask's nesting: -32603 with the 4902 under data.originalError", () => {
    // Measured live against Studio Next (chain 0xf22d) on the first connection.
    const err = {
      code: -32603,
      message: 'Unrecognized chain ID "0xf22d". Try adding the chain using wallet_addEthereumChain first.',
      data: {
        originalError: {
          code: 4902,
          message: 'Unrecognized chain ID "0xf22d". Try adding the chain using wallet_addEthereumChain first.',
        },
      },
    };
    expect(isUnknownChainError(err)).toBe(true);
  });

  it("falls back to the message when no code survives the wrapping", () => {
    expect(isUnknownChainError(new Error('Unrecognized chain ID "0xf22d".'))).toBe(true);
    expect(isUnknownChainError({ cause: { code: "4902" } })).toBe(true);
  });

  it("does not mistake a user rejection or an unrelated failure for an unknown chain", () => {
    expect(isUnknownChainError({ code: 4001, message: "User rejected the request." })).toBe(false);
    expect(isUnknownChainError({ code: -32002, message: "Request already pending." })).toBe(false);
    expect(isUnknownChainError(new Error("network error"))).toBe(false);
    expect(isUnknownChainError(undefined)).toBe(false);
  });
});

describe("chain helpers", () => {
  it("renders 61997 as 0xf22d", () => {
    expect(toChainHex(61997)).toBe("0xf22d");
  });

  it("names the Studio Next add-network prompt for a bare 4902", () => {
    expect(walletErrorMessage({ code: 4902 })).toMatch(/Studio Next/);
  });
});
