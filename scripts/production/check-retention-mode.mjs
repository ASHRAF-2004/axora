#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const MVP_RETENTION_MODE = "mvp-conservative";

export function assertRetentionMode(env = process.env) {
  if (env.AXORA_RETENTION_MODE !== MVP_RETENTION_MODE) {
    throw new Error(`AXORA_RETENTION_MODE must be exactly ${MVP_RETENTION_MODE} for the controlled three-company pilot.`);
  }
  return MVP_RETENTION_MODE;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    assertRetentionMode();
    process.stdout.write("MVP conservative retention mode is configured.\n");
  } catch (error) {
    process.stderr.write(`Retention readiness failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
