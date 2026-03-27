import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

const REQUIRED_FIELDS = ["name", "version", "description", "type", "main", "types"];
const REQUIRED_SCRIPTS = ["lint", "build", "test"];

interface Issue {
  package: string;
  level: "error" | "warn";
  message: string;
}

const issues: Issue[] = [];

const dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(PACKAGES_DIR, d.name));

for (const dir of dirs) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    issues.push({ package: dir, level: "error", message: "Missing package.json" });
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const name = pkg.name || dir.split("/").pop();

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!pkg[field]) {
      issues.push({ package: name, level: "error", message: `Missing required field: ${field}` });
    }
  }

  // Required scripts
  for (const script of REQUIRED_SCRIPTS) {
    if (!pkg.scripts?.[script]) {
      issues.push({ package: name, level: "error", message: `Missing required script: ${script}` });
    }
  }

  // Scope check
  if (pkg.name && !pkg.name.startsWith("@wopr-network/")) {
    issues.push({ package: name, level: "error", message: `Missing @wopr-network/ scope in name` });
  }

  // Module type
  if (pkg.type !== "module") {
    issues.push({ package: name, level: "warn", message: `Expected "type": "module", got "${pkg.type}"` });
  }

  // Workspace dependency on plugin-types
  if (name !== "@wopr-network/plugin-types") {
    const ptDep = pkg.dependencies?.["@wopr-network/plugin-types"]
      || pkg.peerDependencies?.["@wopr-network/plugin-types"];
    if (ptDep && ptDep !== "workspace:*") {
      issues.push({ package: name, level: "warn", message: `plugin-types should use "workspace:*", found "${ptDep}"` });
    }
  }

  // tsconfig exists
  if (!existsSync(join(dir, "tsconfig.json"))) {
    issues.push({ package: name, level: "error", message: "Missing tsconfig.json" });
  }

  // src/ exists
  if (!existsSync(join(dir, "src"))) {
    issues.push({ package: name, level: "error", message: "Missing src/ directory" });
  }

  // wopr metadata (warn if missing, not error)
  if (name !== "@wopr-network/plugin-types" && !pkg.wopr?.plugin) {
    issues.push({ package: name, level: "warn", message: "Missing wopr.plugin metadata — category/capabilities will be inferred" });
  }
}

const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warn");

console.log(`Validated ${dirs.length} packages`);
if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} warnings:`);
  for (const w of warnings) console.log(`  ${w.package}: ${w.message}`);
}
if (errors.length) {
  console.log(`\n✗ ${errors.length} errors:`);
  for (const e of errors) console.log(`  ${e.package}: ${e.message}`);
  process.exit(1);
}

console.log("\n✓ All packages valid.");
