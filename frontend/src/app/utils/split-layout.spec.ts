import {
  clampSplitWidthToContainerPx,
  computeDragSplitWidthPx,
  computeSplitGridTemplateColumns,
  DEFAULT_LEFT_PX,
  MIN_LEFT_PX,
  MIN_RIGHT_PX,
  SPLITTER_COL_WIDTH_PX
} from './split-layout';

describe('split-layout', () => {
  it('computes grid template columns string', () => {
    expect(computeSplitGridTemplateColumns(520)).toBe('minmax(0, 520px) 10px minmax(0, 1fr)');
  });

  it('clamps left width to min/max based on container', () => {
    const containerWidth = MIN_LEFT_PX + MIN_RIGHT_PX + SPLITTER_COL_WIDTH_PX;

    expect(clampSplitWidthToContainerPx(containerWidth, 1)).toBe(MIN_LEFT_PX);
    expect(clampSplitWidthToContainerPx(containerWidth, 10_000)).toBe(MIN_LEFT_PX);

    expect(clampSplitWidthToContainerPx(containerWidth + 500, MIN_LEFT_PX + 100)).toBe(MIN_LEFT_PX + 100);
  });

  it('computes drag width with clamping and rounding', () => {
    const containerWidth = 2000;

    expect(computeDragSplitWidthPx(containerWidth, DEFAULT_LEFT_PX, 0)).toBe(DEFAULT_LEFT_PX);
    expect(computeDragSplitWidthPx(containerWidth, DEFAULT_LEFT_PX, -10_000)).toBe(MIN_LEFT_PX);

    const dx = 33.4;
    const w = computeDragSplitWidthPx(containerWidth, 500.2, dx);
    expect(Number.isInteger(w)).toBe(true);
  });
});
