/**
 * Checks OpenUI Lang files against the app's component library.
 *
 *   npm run validate -- db/seed/country-profile.openui
 */
import { createParser } from "@openuidev/lang-core";
import { readFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(new URL("../src/generated/spec.json", import.meta.url), "utf-8"));
let failed = false;

for (const file of process.argv.slice(2)) {
  const { root, meta, queryStatements } = createParser(spec.schema, spec.root).parse(readFileSync(file, "utf-8"));
  const ok = root !== null && !meta.incomplete && !meta.errors.length && !meta.unresolved.length;
  failed ||= !ok;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${file}: ${meta.statementCount} statements, ${queryStatements.length} queries, ` +
      `${meta.errors.length} errors, ${meta.unresolved.length} unresolved, ${meta.orphaned.length} orphaned`,
  );
  for (const e of meta.errors.slice(0, 20)) console.log(`  ${e.code} ${e.component ?? ""} ${e.path ?? ""}: ${e.message}`);
  if (meta.unresolved.length) console.log(`  unresolved: ${meta.unresolved.join(", ")}`);
  if (meta.orphaned.length) console.log(`  orphaned: ${meta.orphaned.join(", ")}`);
}
process.exit(failed ? 1 : 0);
