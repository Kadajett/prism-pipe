import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
      "@server": resolve(__dirname, "src/server"),
      "@proxy": resolve(__dirname, "src/proxy"),
      "@config": resolve(__dirname, "src/config"),
      "@rate-limit": resolve(__dirname, "src/rate-limit"),
      "@fallback": resolve(__dirname, "src/fallback"),
      "@logging": resolve(__dirname, "src/logging"),
      "@store": resolve(__dirname, "src/store"),
      "@middleware": resolve(__dirname, "src/middleware"),
      "@cli": resolve(__dirname, "src/cli"),
    },
  },
});
