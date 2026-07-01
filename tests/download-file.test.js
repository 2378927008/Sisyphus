import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("download-file fails slow trickle downloads instead of hanging indefinitely", async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-length": String(10 * 1024 * 1024) });
    const timer = setInterval(() => {
      response.write(Buffer.from([0]));
    }, 50);
    response.on("close", () => clearInterval(timer));
  });
  await listen(server);

  const tempDir = await mkdtemp(path.join(tmpdir(), "local-flow-download-"));
  try {
    const port = server.address().port;
    const outputPath = path.join(tempDir, "slow.bin");
    const result = await runDownload(`http://127.0.0.1:${port}/slow.bin`, outputPath, {
      LOCAL_FLOW_DOWNLOAD_MAX_ATTEMPTS: "1",
      LOCAL_FLOW_DOWNLOAD_MIN_PROGRESS_BYTES: "1024",
      LOCAL_FLOW_DOWNLOAD_MIN_PROGRESS_INTERVAL_MS: "250",
      LOCAL_FLOW_DOWNLOAD_STALL_TIMEOUT_MS: "5000"
    });

    assert.equal(result.signal, null);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /download too slow/i);
  } finally {
    server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function runDownload(url, outputPath, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(process.cwd(), "scripts", "download-file.mjs"),
      url,
      outputPath
    ], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
    }, 2000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
