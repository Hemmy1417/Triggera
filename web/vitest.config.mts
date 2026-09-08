import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // The deployment of record, so the suite runs against the address the
      // app ships with rather than a placeholder. Tests that care about a
      // particular configuration still stub the variable themselves.
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0xF83CB718eb3Eb09bcc8b24cEC902687116D68c42",
      // The platform the suite is written against — GenLayer Studio Next —
      // pinned so a developer's shell env cannot move the chain id or the RPC
      // URL under the tests that assert where each RPC method is sent.
      NEXT_PUBLIC_GENLAYER_RPC_URL: "https://studio-next.genlayer.com/api",
      NEXT_PUBLIC_GENLAYER_CHAIN_ID: "61997",
      NEXT_PUBLIC_GENLAYER_EXPLORER_URL: "https://explorer-studio-dev.genlayer.com",
    },
  },
});
