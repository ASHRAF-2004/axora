import zapier, { defineApp } from "zapier-platform-core";

import packageJson from "../package.json" with { type: "json" };
import authentication from "./authentication.js";
import { creates } from "./creates.js";
import { addAxoraBearerToken } from "./middleware.js";
import { searches } from "./searches.js";
import { triggers } from "./triggers.js";

export default defineApp({
  version: packageJson.version,
  platformVersion: zapier.version,
  authentication,
  beforeRequest: [addAxoraBearerToken],
  triggers: Object.fromEntries(triggers.map((trigger) => [trigger.key, trigger])),
  searches: Object.fromEntries(searches.map((search) => [search.key, search])),
  creates: Object.fromEntries(creates.map((create) => [create.key, create])),
});
