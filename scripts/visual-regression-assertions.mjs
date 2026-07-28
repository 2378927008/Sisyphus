const edgeNames = ["left", "right", "top", "bottom"];

export function measureFocusRingCoverage({
  bitmap,
  imageWidth,
  imageHeight,
  rect,
  bandX,
  bandY,
  expectedColor,
  colorTolerance,
  minimumEdgeCoverage
}) {
  const matchesExpectedColor = (x, y) => {
    if (x < 0 || x >= imageWidth || y < 0 || y >= imageHeight) return false;
    const offset = (y * imageWidth + x) * 4;
    const actual = [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
    return actual.every(
      (channel, index) => Math.abs(channel - expectedColor[index]) <= colorTolerance
    );
  };
  const measureEdge = (edge) => {
    const vertical = edge === "left" || edge === "right";
    const start = vertical ? rect.top : rect.left;
    const end = vertical ? rect.bottom : rect.right;
    const fixed = edge === "left"
      ? rect.left
      : edge === "right"
        ? rect.right
        : edge === "top"
          ? rect.top
          : rect.bottom;
    const band = vertical ? bandX : bandY;
    let matchedPositions = 0;

    for (let position = start; position <= end; position += 1) {
      let positionMatched = false;
      for (let offset = -band; offset <= band && !positionMatched; offset += 1) {
        const x = vertical ? fixed + offset : position;
        const y = vertical ? position : fixed + offset;
        positionMatched = matchesExpectedColor(x, y);
      }
      if (positionMatched) matchedPositions += 1;
    }

    const totalPositions = Math.max(0, end - start + 1);
    const requiredPositions = Math.ceil(totalPositions * minimumEdgeCoverage);
    return {
      matchedPositions,
      totalPositions,
      requiredPositions,
      coverage: totalPositions === 0 ? 0 : matchedPositions / totalPositions,
      passed: totalPositions > 0 && matchedPositions >= requiredPositions
    };
  };

  const edges = Object.fromEntries(edgeNames.map((edge) => [edge, measureEdge(edge)]));
  const failedEdges = edgeNames.filter((edge) => !edges[edge].passed);
  return {
    passed: failedEdges.length === 0,
    minimumEdgeCoverage,
    failedEdges,
    edges
  };
}

export function validateHudVisualState(state, expectedRegionIds) {
  const errors = [];
  if (JSON.stringify(state.visibleRegionIds) !== JSON.stringify(expectedRegionIds)) {
    errors.push(
      `visibleRegionIds expected ${JSON.stringify(expectedRegionIds)}, got ${JSON.stringify(state.visibleRegionIds)}`
    );
  }
  if (state.clipped.length > 0) {
    errors.push(`clipped expected [], got ${JSON.stringify(state.clipped)}`);
  }
  if (state.overlaps.length > 0) {
    errors.push(`overlaps expected [], got ${JSON.stringify(state.overlaps)}`);
  }
  return {
    passed: errors.length === 0,
    errors
  };
}
