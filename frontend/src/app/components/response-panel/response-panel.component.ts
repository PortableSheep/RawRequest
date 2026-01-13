import { Component, OnDestroy, effect, input, signal, untracked, HostListener, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VirtualResponseBodyComponent } from '../virtual-response-body/virtual-response-body.component';
import { AssertionResult, ChainEntryPreview, Request, RequestPreview, ResponseData, ResponsePreview } from '../../models/http.models';

import {
  formatBytesForResponsePanel,
  getChainItemsForResponsePanel,
  getStatusClassForEntry,
  getStatusLabelForEntry
} from './response-panel.logic';

type EntryTab = 'response' | 'request';

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

@Component({
  selector: 'app-response-panel',
  standalone: true,
  imports: [CommonModule, VirtualResponseBodyComponent],
  templateUrl: './response-panel.component.html',
  styleUrls: ['./response-panel.component.scss']
})
export class ResponsePanelComponent implements OnDestroy {
  responseData = input<ResponseData | null>(null);
  request = input<Request | null>(null);
  isLoading = input<boolean>(false);
  isCancelling = input<boolean>(false);
  downloadProgress = input<DownloadProgress | null>(null);

  replayRequest = output<ChainEntryPreview>();

  expandedEntryId = signal<string | null>(null);
  entryTabs = signal<Record<string, EntryTab>>({});
  copyStates = signal<Record<string, 'idle' | 'copied' | 'error'>>({});
  requestCollapsed = signal<Record<string, boolean>>({});
  assertionsCollapsed = signal<Record<string, boolean>>({});
  private copyTimers = new Map<string, any>();

  // Tooltip state
  tooltipText = signal<string | null>(null);
  tooltipPosition = signal<{ top: number; left: number } | null>(null);
  private tooltipShowTimer: any = null;
  private tooltipElement: HTMLElement | null = null;

  @HostListener('mouseover', ['$event'])
  onMouseOver(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const chip = target.closest('[data-tooltip]') as HTMLElement;
    if (chip) {
      const tooltip = chip.getAttribute('data-tooltip');
      if (tooltip) {
        // Clear any existing timer
        if (this.tooltipShowTimer) {
          clearTimeout(this.tooltipShowTimer);
        }
        // Delay showing tooltip by 500ms
        this.tooltipShowTimer = setTimeout(() => {
          const rect = chip.getBoundingClientRect();
          this.tooltipText.set(tooltip);
          this.tooltipPosition.set({
            top: rect.top - 8,
            left: rect.left + rect.width / 2
          });
          this.showTooltipElement();
        }, 500);
      }
    }
  }

  @HostListener('mouseout', ['$event'])
  onMouseOut(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const relatedTarget = event.relatedTarget as HTMLElement;
    const chip = target.closest('[data-tooltip]');
    // Only hide if we're actually leaving the chip
    if (chip && (!relatedTarget || !chip.contains(relatedTarget))) {
      this.hideTooltip();
    }
  }

  private showTooltipElement() {
    if (!this.tooltipElement) {
      this.tooltipElement = document.createElement('div');
      this.tooltipElement.className = 'global-tooltip';
      document.body.appendChild(this.tooltipElement);
    }
    const text = this.tooltipText();
    const pos = this.tooltipPosition();
    if (text && pos) {
      this.tooltipElement.textContent = text;
      this.tooltipElement.style.top = `${pos.top}px`;
      this.tooltipElement.style.left = `${pos.left}px`;
      this.tooltipElement.classList.add('visible');
    }
  }

  private hideTooltip() {
    if (this.tooltipShowTimer) {
      clearTimeout(this.tooltipShowTimer);
      this.tooltipShowTimer = null;
    }
    this.tooltipText.set(null);
    this.tooltipPosition.set(null);
    if (this.tooltipElement) {
      this.tooltipElement.classList.remove('visible');
    }
  }

  constructor() {
    effect(() => {
      const entries = this.getChainItems();
      const current = untracked(() => this.expandedEntryId());
      const currentTabs = untracked(() => this.entryTabs());
      if (!entries.length) {
        if (current !== null) {
          this.expandedEntryId.set(null);
        }
        if (Object.keys(currentTabs).length) {
          this.entryTabs.set({});
        }
        return;
      }
      const normalizedTabs: Record<string, EntryTab> = {};
      let tabsChanged = false;
      for (const entry of entries) {
        const existing = currentTabs[entry.id] ?? 'response';
        normalizedTabs[entry.id] = existing;
        if (currentTabs[entry.id] !== existing) {
          tabsChanged = true;
        }
      }
      if (tabsChanged || Object.keys(currentTabs).length !== Object.keys(normalizedTabs).length) {
        this.entryTabs.set(normalizedTabs);
      }
      const stillValid = current ? entries.some(entry => entry.id === current) : false;
      if (stillValid) {
        return;
      }
      const preferred = entries.find(entry => entry.isPrimary) ?? entries[entries.length - 1];
      if (preferred) {
        this.expandedEntryId.set(preferred.id);
      }
    });
  }

  ngOnDestroy(): void {
    this.copyTimers.forEach(timer => clearTimeout(timer));
    this.copyTimers.clear();
    // Clean up tooltip
    if (this.tooltipShowTimer) {
      clearTimeout(this.tooltipShowTimer);
    }
    if (this.tooltipElement) {
      this.tooltipElement.remove();
      this.tooltipElement = null;
    }
  }

  getChainItems(): ChainEntryPreview[] {
    return getChainItemsForResponsePanel(this.responseData(), this.request());
  }

  toggleEntry(id: string) {
    this.expandedEntryId.set(this.expandedEntryId() === id ? null : id);
  }

  onReplay(entry: ChainEntryPreview, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.replayRequest.emit(entry);
  }

  getEntryTab(id: string): EntryTab {
    return this.entryTabs()[id] ?? 'response';
  }

  setEntryTab(id: string, tab: EntryTab) {
    this.entryTabs.update(current => ({ ...current, [id]: tab }));
  }

  getStatusClass(entry: ChainEntryPreview): string {
    return getStatusClassForEntry(entry);
  }

  getStatusLabel(entry: ChainEntryPreview): string {
    return getStatusLabelForEntry(entry);
  }

  formatSize(bytes: number): string {
    return formatBytesForResponsePanel(bytes);
  }

  countAssertionsPassed(assertions: AssertionResult[] | null | undefined): number {
    if (!assertions?.length) {
      return 0;
    }
    return assertions.reduce((acc, a) => acc + (a?.passed ? 1 : 0), 0);
  }

  countAssertionsFailed(assertions: AssertionResult[] | null | undefined): number {
    if (!assertions?.length) {
      return 0;
    }
    return assertions.reduce((acc, a) => acc + (!a?.passed ? 1 : 0), 0);
  }

  isRequestCollapsed(entryId: string): boolean {
    // Default to collapsed (true)
    return this.requestCollapsed()[entryId] ?? true;
  }

  toggleRequestSection(entryId: string): void {
    this.requestCollapsed.update(current => ({
      ...current,
      [entryId]: !this.isRequestCollapsed(entryId)
    }));
  }

  isAssertionsCollapsed(entryId: string): boolean {
    // Default to collapsed (true)
    return this.assertionsCollapsed()[entryId] ?? true;
  }

  toggleAssertionsSection(entryId: string): void {
    this.assertionsCollapsed.update(current => ({
      ...current,
      [entryId]: !this.isAssertionsCollapsed(entryId)
    }));
  }

  getCopyState(entryId: string): 'idle' | 'copied' | 'error' {
    return this.copyStates()[entryId] ?? 'idle';
  }

  async copyResponseBody(entryId: string, body?: string | null) {
    if (!body) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      this.setCopyState(entryId, 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      this.setCopyState(entryId, 'copied');
    } catch (error) {
      console.error('Copy failed', error);
      this.setCopyState(entryId, 'error');
    }
  }

  private setCopyState(entryId: string, state: 'idle' | 'copied' | 'error') {
    this.copyStates.update(current => ({ ...current, [entryId]: state }));
    if (state === 'idle') {
      const timer = this.copyTimers.get(entryId);
      if (timer) {
        clearTimeout(timer);
        this.copyTimers.delete(entryId);
      }
      return;
    }

    const existing = this.copyTimers.get(entryId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.copyStates.update(current => ({ ...current, [entryId]: 'idle' }));
      this.copyTimers.delete(entryId);
    }, 1500);
    this.copyTimers.set(entryId, timer);
  }

  formatBytes(bytes: number): string {
    return formatBytesForResponsePanel(bytes);
  }

}
