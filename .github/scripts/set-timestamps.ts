import { readFileSync, writeFileSync } from "fs";
import yaml from "js-yaml";

type ProjectYaml = {
  repo?: string;
  submittedBy?: string;
  banner?: string;
  npm?: string;
  website?: string;
  addedAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

const changedFiles = process.argv.slice(2).filter((f) => f.endsWith(".yaml"));
const now = new Date().toISOString();

const FIELD_ORDER = [
  "repo",
  "submittedBy",
  "banner",
  "npm",
  "website",
  "addedAt",
  "updatedAt",
] as const;

for (const filePath of changedFiles) {
  const content = readFileSync(filePath, "utf8");
  const data = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as ProjectYaml | null;

  if (!data || typeof data !== "object") {
    console.log(`Skipping ${filePath} — not a valid YAML object`);
    continue;
  }

  const isNew = !data.addedAt;
  if (isNew) data.addedAt = now;
  data.updatedAt = now;

  // Serialize with consistent field order
  const ordered: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) {
    if (key in data && data[key] != null) {
      ordered[key] = data[key];
    }
  }

  writeFileSync(
    filePath,
    yaml.dump(ordered, { lineWidth: -1, quotingType: '"', forceQuotes: true }),
  );
  console.log(`${isNew ? "Added" : "Updated"} timestamps for ${filePath}`);
}
