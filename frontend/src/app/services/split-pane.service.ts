import { Injectable } from '@angular/core';
import {
  clampSplitWidthToContainerPx,
  computeDragSplitWidthPx,
  computeSplitGridTemplateColumns,
  DEFAULT_LEFT_PX,
  SPLIT_LAYOUT_BREAKPOINT_PX,
} from '../utils/split-layout';
import {
  readSplitWidthPxFromStorage,
  writeSplitWidthPxToStorage,
} from '../logic/layout/split-pane-persistence.logic';

const EDITOR_SPLIT_WIDTH_KEY = 'rawrequest_editor_pane_width_px';

@Injectable({ providedIn: 'root' })
export class SplitPaneService {
  isSplitLayout = false;
  editorPaneWidthPx = DEFAULT_LEFT_PX;
  splitGridTemplateColumns: string | null = null;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartWidth = 0;

  restoreSplitState(): void {
    const n = readSplitWidthPxFromStorage(localStorage, EDITOR_SPLIT_WIDTH_KEY);
    if (n !== null) {
      this.editorPaneWidthPx = n;
    }
  }

  refreshSplitLayoutState(): void {
    this.isSplitLayout =
      typeof window !== 'undefined' &&
      window.innerWidth >= SPLIT_LAYOUT_BREAKPOINT_PX;
    this.splitGridTemplateColumns = this.computeGridTemplate();
  }

  onWindowResize(container: HTMLElement | undefined): void {
    this.refreshSplitLayoutState();
    this.clampSplitWidthToContainer(container);
  }

  onMouseMove(event: MouseEvent, container: HTMLElement | undefined): boolean {
    if (!this.isDragging) return false;
    if (!this.isSplitLayout) return false;
    event.preventDefault();
    if (!container) return false;

    const rect = container.getBoundingClientRect();
    const dx = event.clientX - this.dragStartX;
    this.editorPaneWidthPx = computeDragSplitWidthPx(
      rect.width,
      this.dragStartWidth,
      dx,
    );
    this.splitGridTemplateColumns = this.computeGridTemplate();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return true;
  }

  onMouseUp(): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    writeSplitWidthPxToStorage(
      localStorage,
      EDITOR_SPLIT_WIDTH_KEY,
      this.editorPaneWidthPx,
    );
  }

  onSplitMouseDown(event: MouseEvent): void {
    if (!this.isSplitLayout) return;
    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartWidth = this.editorPaneWidthPx;
    event.preventDefault();
  }

  resetSplit(): void {
    this.editorPaneWidthPx = DEFAULT_LEFT_PX;
    this.splitGridTemplateColumns = this.computeGridTemplate();
    writeSplitWidthPxToStorage(
      localStorage,
      EDITOR_SPLIT_WIDTH_KEY,
      this.editorPaneWidthPx,
    );
  }

  clampSplitWidthToContainer(container: HTMLElement | undefined): void {
    if (!this.isSplitLayout) return;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const clamped = clampSplitWidthToContainerPx(
      rect.width,
      this.editorPaneWidthPx,
    );
    if (clamped !== this.editorPaneWidthPx) {
      this.editorPaneWidthPx = clamped;
      this.splitGridTemplateColumns = this.computeGridTemplate();
    }
  }

  private computeGridTemplate(): string | null {
    if (!this.isSplitLayout) {
      return null;
    }
    return computeSplitGridTemplateColumns(this.editorPaneWidthPx);
  }
}
