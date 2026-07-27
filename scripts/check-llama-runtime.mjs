import { validateEmbeddedLlmRuntime } from "../src/main/embedded-llm-assets.js";
import path from "node:path";

const cliPathArg = process.argv[2];

if (!cliPathArg) {
  console.error("Usage: node scripts/check-llama-runtime.mjs <llama-cli-path>");
  process.exit(2);
}

const cliPath = path.resolve(cliPathArg);

const result = await validateEmbeddedLlmRuntime(cliPath, {
  runtimeValidationTimeoutMs: 10_000
});

if (!result.ready) {
  console.error(result.error || "llama-cli runtime validation failed.");
  process.exit(1);
}

console.log("llama-cli runtime validation passed.");
