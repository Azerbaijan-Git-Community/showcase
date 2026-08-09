import { defineConfig } from "greenly";
import { validate } from "./scripts/validate";

export default defineConfig({
  name: "Azerbaijan GitHub Community - Showcase",
  checks: [
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
    { name: "Validate projects", command: validate },
  ],
});
