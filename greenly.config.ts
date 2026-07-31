import { defineConfig } from "greenly";
import { validate } from "./scripts/validate";

export default defineConfig({
  name: "Azerbaijan GitHub Community - Showcase",
  checks: [
    { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Validate projects", command: validate },
  ],
});
