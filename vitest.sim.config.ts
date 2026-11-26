import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/sim/**/*.sim.ts"],
      testTimeout: 300000,
      hookTimeout: 60000,
    },
  }),
);
