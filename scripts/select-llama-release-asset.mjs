import { selectLlamaReleaseAsset } from "../src/main/embedded-llm-assets.js";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const assets = JSON.parse(input || "[]");
    const asset = selectLlamaReleaseAsset(assets);
    if (!asset) {
      console.error("No suitable Windows x64 llama.cpp runtime asset found.");
      process.exit(1);
    }
    console.log(JSON.stringify(asset));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
});
