import test from "node:test";
import assert from "node:assert/strict";
import {
  measureFocusRingCoverage,
  validateHudVisualState
} from "../scripts/visual-regression-assertions.mjs";

const focusBlue = [23, 105, 224];

function createBitmap(width, height, color = [255, 255, 255]) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    bitmap[offset] = color[2];
    bitmap[offset + 1] = color[1];
    bitmap[offset + 2] = color[0];
    bitmap[offset + 3] = 255;
  }
  return bitmap;
}

function setPixel(bitmap, width, x, y, color = focusBlue) {
  const offset = (y * width + x) * 4;
  bitmap[offset] = color[2];
  bitmap[offset + 1] = color[1];
  bitmap[offset + 2] = color[0];
  bitmap[offset + 3] = 255;
}

function drawRing(bitmap, width, rect, edges = ["left", "right", "top", "bottom"]) {
  if (edges.includes("left") || edges.includes("right")) {
    for (let y = rect.top; y <= rect.bottom; y += 1) {
      if (edges.includes("left")) setPixel(bitmap, width, rect.left, y);
      if (edges.includes("right")) setPixel(bitmap, width, rect.right, y);
    }
  }
  if (edges.includes("top") || edges.includes("bottom")) {
    for (let x = rect.left; x <= rect.right; x += 1) {
      if (edges.includes("top")) setPixel(bitmap, width, x, rect.top);
      if (edges.includes("bottom")) setPixel(bitmap, width, x, rect.bottom);
    }
  }
}

function measure(bitmap, width, height, rect) {
  return measureFocusRingCoverage({
    bitmap,
    imageWidth: width,
    imageHeight: height,
    rect,
    bandX: 3,
    bandY: 3,
    expectedColor: focusBlue,
    colorTolerance: 36,
    minimumEdgeCoverage: 0.5
  });
}

test("focus coverage accepts a complete four-edge ring", () => {
  const width = 96;
  const height = 72;
  const rect = { left: 18, top: 14, right: 77, bottom: 57 };
  const bitmap = createBitmap(width, height);
  drawRing(bitmap, width, rect);

  const result = measure(bitmap, width, height, rect);

  assert.equal(result.passed, true);
  assert.deepEqual(result.failedEdges, []);
  for (const edge of Object.values(result.edges)) {
    assert.ok(edge.coverage >= 0.5);
    assert.ok(edge.matchedPositions >= edge.requiredPositions);
  }
});

test("focus coverage rejects eight nearby blue pixels without a ring", () => {
  const width = 96;
  const height = 72;
  const rect = { left: 18, top: 14, right: 77, bottom: 57 };
  const bitmap = createBitmap(width, height);
  for (let index = 0; index < 8; index += 1) {
    setPixel(bitmap, width, rect.left + (index % 2), rect.top + Math.floor(index / 2));
  }

  const result = measure(bitmap, width, height, rect);

  assert.equal(result.passed, false);
  assert.ok(result.failedEdges.includes("right"));
  assert.ok(result.failedEdges.includes("bottom"));
});

test("focus coverage rejects a single near-blue edge", () => {
  const width = 96;
  const height = 72;
  const rect = { left: 18, top: 14, right: 77, bottom: 57 };
  const bitmap = createBitmap(width, height);
  drawRing(bitmap, width, rect, ["top"]);

  const result = measure(bitmap, width, height, rect);

  assert.equal(result.passed, false);
  assert.deepEqual(result.failedEdges.sort(), ["bottom", "left", "right"]);
});

test("HUD state requires exact visible IDs with no clipping or overlap", () => {
  const recordingIds = [
    "hudWaveform",
    "hudTitle",
    "hudMessage",
    "hudTimer",
    "hudCancel",
    "hudStop"
  ];
  const warningIds = [
    "hudWaveform",
    "hudTitle",
    "hudMessage",
    "hudOpenMain"
  ];

  assert.deepEqual(
    validateHudVisualState({
      visibleRegionIds: recordingIds,
      clipped: [],
      overlaps: []
    }, recordingIds),
    { passed: true, errors: [] }
  );
  assert.deepEqual(
    validateHudVisualState({
      visibleRegionIds: warningIds,
      clipped: [],
      overlaps: []
    }, warningIds),
    { passed: true, errors: [] }
  );
});

test("HUD state rejects a warning layout that never measured open-main", () => {
  const expectedIds = [
    "hudWaveform",
    "hudTitle",
    "hudMessage",
    "hudOpenMain"
  ];
  const result = validateHudVisualState({
    visibleRegionIds: ["hudWaveform", "hudTitle", "hudMessage"],
    clipped: [],
    overlaps: []
  }, expectedIds);

  assert.equal(result.passed, false);
  assert.ok(result.errors.some((error) => error.includes("visibleRegionIds")));
});

test("HUD state rejects exact regions with clipping or overlap", () => {
  const expectedIds = ["hudWaveform", "hudTitle", "hudMessage", "hudOpenMain"];
  const result = validateHudVisualState({
    visibleRegionIds: expectedIds,
    clipped: ["hudMessage"],
    overlaps: ["hudMessage overlaps hudOpenMain"]
  }, expectedIds);

  assert.equal(result.passed, false);
  assert.ok(result.errors.some((error) => error.includes("clipped")));
  assert.ok(result.errors.some((error) => error.includes("overlaps")));
});
