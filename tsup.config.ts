import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/worker-wrapper.ts"],
  dts: true,
  sourcemap: true,
  format: ["cjs", "esm"],
  external: ["ava-typescript-worker"],
})
