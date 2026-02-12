import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "run-cloud": "src/cloud/run-cloud.ts",
  },
  format: ["esm"],
  target: "node22",
  sourcemap: true,
  dts: true,
  treeshake: true,
  unbundle: true,
  exports: true,
});
