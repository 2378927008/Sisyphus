import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const [url, outputPath] = process.argv.slice(2);
const maxRedirects = 8;
const maxAttempts = 3;
const timeoutMs = 120000;
const stallTimeoutMs = 30000;

if (!url || !outputPath) {
  console.error("Usage: node scripts/download-file.mjs <url> <output-path>");
  process.exit(2);
}

await mkdir(path.dirname(outputPath), { recursive: true });

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const tempPath = `${outputPath}.part`;

  try {
    await download(url, tempPath, { redirectsLeft: maxRedirects });
    await rename(tempPath, outputPath);
    console.log(`Downloaded ${url}`);
    console.log(`Saved to ${outputPath}`);
    process.exit(0);
  } catch (error) {
    if (attempt === maxAttempts) {
      console.error(`Download failed after ${attempt} attempts: ${error.message}`);
      process.exit(1);
    }

    console.error(`Download attempt ${attempt} failed: ${error.message}`);
    await wait(attempt * 1500);
  }
}

async function download(inputUrl, outputFile, { redirectsLeft }) {
  const existingBytes = await getExistingSize(outputFile);

  return new Promise((resolve, reject) => {
    const parsed = new URL(inputUrl);
    const client = parsed.protocol === "http:" ? http : https;
    const headers = {
      "user-agent": "local-flow-dictation"
    };

    if (existingBytes > 0) {
      headers.range = `bytes=${existingBytes}-`;
      console.error(`Resuming ${path.basename(outputFile)} from ${formatBytes(existingBytes)}...`);
    }

    const request = client.get(
      parsed,
      {
        timeout: timeoutMs,
        headers
      },
      async (response) => {
        const status = response.statusCode || 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();

          if (redirectsLeft <= 0) {
            reject(new Error("too many redirects"));
            return;
          }

          const nextUrl = new URL(response.headers.location, parsed).toString();
          try {
            await download(nextUrl, outputFile, { redirectsLeft: redirectsLeft - 1 });
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (status === 416 && existingBytes > 0) {
          response.resume();
          await rm(outputFile, { force: true });
          reject(new Error("server rejected resume range; removed partial file"));
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        const append = status === 206 && existingBytes > 0;
        if (existingBytes > 0 && status === 200) {
          console.error("Server did not support resume; restarting download.");
          await rm(outputFile, { force: true });
        }

        let received = append ? existingBytes : 0;
        let lastReported = received;
        const totalHeader = Number(response.headers["content-length"] || 0);
        const expectedTotal = append && totalHeader ? existingBytes + totalHeader : totalHeader;
        const stallTimer = createStallTimer(() => {
          request.destroy(new Error(`no download progress for ${stallTimeoutMs}ms`));
        });

        response.on("data", (chunk) => {
          received += chunk.length;
          stallTimer.bump();

          if (received - lastReported >= 5 * 1024 * 1024) {
            lastReported = received;
            const totalText = expectedTotal ? ` / ${formatBytes(expectedTotal)}` : "";
            console.error(`Downloaded ${formatBytes(received)}${totalText}`);
          }
        });

        try {
          stallTimer.bump();
          await pipeline(response, createWriteStream(outputFile, { flags: append ? "a" : "w" }));
          stallTimer.stop();
          resolve();
        } catch (error) {
          stallTimer.stop();
          reject(error);
        }
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error(`connection timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getExistingSize(filePath) {
  try {
    const file = await stat(filePath);
    return file.isFile() ? file.size : 0;
  } catch {
    return 0;
  }
}

function createStallTimer(onStall) {
  let timer;

  return {
    bump() {
      clearTimeout(timer);
      timer = setTimeout(onStall, stallTimeoutMs);
    },
    stop() {
      clearTimeout(timer);
    }
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
