import { createRequire } from "node:module";

import App from "../dist/index.js";

const require = createRequire(import.meta.url);
const { prepareApp, validateApp } = require("zapier-platform-core/src/tools/schema");
const errors = validateApp(prepareApp(App));
if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`${error.property}: ${error.message}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("Axora Zapier definition is schema-valid.\n");
}
