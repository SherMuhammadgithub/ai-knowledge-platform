import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC compiles the TypeScript so NestJS decorators and their emitted metadata (needed for
// dependency injection) work the same as under tsc.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.spec.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false, // tests share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
