import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js"],
    alias: [
      {
        find: /^(\.\.?\/.*)\.js$/,
        replacement: "$1",
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 10000,
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
