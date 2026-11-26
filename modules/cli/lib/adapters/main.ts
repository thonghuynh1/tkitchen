#!/usr/bin/env node
import { runCli } from "./run.ts";

const ARGV_COMMAND_INDEX = 2;

runCli(process.argv.slice(ARGV_COMMAND_INDEX))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
