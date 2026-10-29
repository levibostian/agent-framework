// The spec is authored once in SPEC.md at the repo root and embedded here at build
// time, so `agent spec` and the repository document can never disagree.
import spec from "../../SPEC.md" with { type: "text" };
import { EXIT_OK } from "../errors.ts";

/** Print the agent spec verbatim. Read-only and offline. */
export function specCommand(): number {
  process.stdout.write(spec.endsWith("\n") ? spec : `${spec}\n`);
  return EXIT_OK;
}
