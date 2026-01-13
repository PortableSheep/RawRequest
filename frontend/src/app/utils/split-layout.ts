export const SPLIT_LAYOUT_BREAKPOINT_PX = 1024;

export const SPLITTER_COL_WIDTH_PX = 10;
export const MIN_LEFT_PX = 340;
export const MIN_RIGHT_PX = 420;
export const DEFAULT_LEFT_PX = 520;

export function clampSplitWidthToContainerPx(containerWidthPx: number, leftWidthPx: number): number {
  const maxLeft = Math.max(MIN_LEFT_PX, containerWidthPx - MIN_RIGHT_PX - SPLITTER_COL_WIDTH_PX);
  const clamped = Math.max(MIN_LEFT_PX, Math.min(maxLeft, leftWidthPx));
  return Math.round(clamped);
}

export function computeSplitGridTemplateColumns(leftWidthPx: number): string {
  return `minmax(0, ${leftWidthPx}px) ${SPLITTER_COL_WIDTH_PX}px minmax(0, 1fr)`;
}

export function computeDragSplitWidthPx(containerWidthPx: number, dragStartWidthPx: number, dxPx: number): number {
  const maxLeft = Math.max(MIN_LEFT_PX, containerWidthPx - MIN_RIGHT_PX - SPLITTER_COL_WIDTH_PX);
  const next = Math.max(MIN_LEFT_PX, Math.min(maxLeft, dragStartWidthPx + dxPx));
  return Math.round(next);
}
