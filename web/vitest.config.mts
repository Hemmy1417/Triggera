import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // The suite's baseline contract. A placeholder until the deployment of
      // record exists; nothing in the suite reads it yet, and tests that care
      // about a particular configuration stub the variable themselves.
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
      // The platform the suite is written against — GenLayer Studio Next —
      // pinned so a developer's shell env cannot move the chain id or the RPC
      // URL under the tests that assert where each RPC method is sent.
      NEXT_PUBLIC_GENLAYER_RPC_URL: "https://studio-next.genlayer.com/api",
      NEXT_PUBLIC_GENLAYER_CHAIN_ID: "61997",
      NEXT_PUBLIC_GENLAYER_EXPLORER_URL: "https://studio-next.genlayer.com",
    },
  },
});
