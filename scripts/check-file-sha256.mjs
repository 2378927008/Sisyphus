import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [filePath, expectedSha256] = process.argv.slice(2);

if (!filePath || !/^[a-f0-9]{64}$/i.test(expectedSha256 || "")) {
  process.exitCode = 2;
} else {
  try {
    const contents = await readFile(filePath);
    const actualSha256 = createHash("sha256").update(contents).digest("hex");
    process.exitCode = actualSha256 === expectedSha256.toLowerCase() ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
