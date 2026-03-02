import { Component, ChangeDetectionStrategy, HostListener, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../services/theme.service';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { FileSaveService } from '../../services/file-save.service';
import { ToastService } from '../../services/toast.service';
import { StartupService } from '../../services/startup.service';

@Component({
  selector: 'app-header',
  imports: [FormsModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  private readonly theme = inject(ThemeService);
  readonly ws = inject(WorkspaceStateService);
  readonly panels = inject(PanelVisibilityService);
  private readonly fileSave = inject(FileSaveService);
  private readonly toast = inject(ToastService);
  readonly startup = inject(StartupService);

  draggingIndex: number | null = null;
  dragOverIndex: number | null = null;

  // Context menu state
  contextMenu = {
    show: false,
    x: 0,
    y: 0,
    tabIndex: -1,
    filePath: ''
  };

  // Save menu state (for the split Save button)
  saveMenu = {
    show: false,
    x: 0,
    y: 0
  };

  // Overflow menu state (kebab)
  moreMenu = {
    show: false,
    x: 0,
    y: 0
  };

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.closeSaveMenu();
    this.closeMoreMenu();
    this.closeContextMenu();
  }

  @HostListener('document:mousedown', ['$event'])
  handleDocumentMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (this.moreMenu.show && !target.closest('.rr-menu--more') && !target.closest('.rr-kebab')) {
      this.closeMoreMenu();
    }

    if (this.saveMenu.show && !target.closest('.rr-menu--save') && !target.closest('.rr-split-btn')) {
      this.closeSaveMenu();
    }

    if (this.contextMenu.show && !target.closest('.rr-menu--context') && !target.closest('.rr-tab')) {
      this.closeContextMenu();
    }
  }

  toggleSaveMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    // Don't allow multiple menus at once.
    this.closeContextMenu();
    this.closeMoreMenu();

    if (this.saveMenu.show) {
      this.closeSaveMenu();
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const menuWidth = 180;
    const padding = 10;
    const x = Math.min(Math.max(rect.right - menuWidth, padding), window.innerWidth - menuWidth - padding);
    const y = rect.bottom + 6;

    this.saveMenu = { show: true, x, y };
  }

  closeSaveMenu(): void {
    this.saveMenu.show = false;
  }

  handleSaveClick(): void {
    void this.fileSave.saveCurrentFile();
    this.closeSaveMenu();
  }

  handleSaveAsClick(): void {
    void this.fileSave.saveCurrentFileAs();
    this.closeSaveMenu();
  }

  toggleMoreMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.closeContextMenu();
    this.closeSaveMenu();

    if (this.moreMenu.show) {
      this.closeMoreMenu();
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const menuWidth = 220;
    const padding = 10;
    const x = Math.min(Math.max(rect.right - menuWidth, padding), window.innerWidth - menuWidth - padding);
    const y = rect.bottom + 6;

    this.moreMenu = { show: true, x, y };
  }

  closeMoreMenu(): void {
    this.moreMenu.show = false;
  }

  handleOpenExamplesClick(): void {
    void this.openExamplesFile();
    this.closeMoreMenu();
  }

  handleDonateClick(): void {
    this.panels.showDonationModal.set(true);
    this.closeMoreMenu();
  }

  handleImportPostmanClick(): void {
    void this.importPostmanCollection();
    this.closeMoreMenu();
  }

  handleImportBrunoClick(): void {
    void this.importBrunoCollection();
    this.closeMoreMenu();
  }

  handleToggleThemeClick(): void {
    this.toggleTheme();
    this.closeMoreMenu();
  }

  handleSecretsClickFromMenu(): void {
    this.panels.openSecretsModal();
    this.closeMoreMenu();
  }

  handleOutlineClickFromMenu(): void {
    this.panels.toggleOutlinePanel();
    this.closeMoreMenu();
  }

  handleSearchRequestsClickFromMenu(): void {
    this.panels.toggleCommandPalette();
    this.closeMoreMenu();
  }

  handleHistoryClickFromMenu(): void {
    this.panels.toggleHistory();
    this.closeMoreMenu();
  }

  handleContextMenu(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    
    const file = this.ws.files()[index];
    this.contextMenu = {
      show: true,
      x: event.clientX,
      y: event.clientY,
      tabIndex: index,
      filePath: file?.filePath || ''
    };
  }

  closeContextMenu() {
    this.contextMenu.show = false;
  }

  handleRevealInFinder() {
    if (this.contextMenu.tabIndex >= 0) {
      void this.revealInFinder(this.contextMenu.tabIndex);
    }
    this.closeContextMenu();
  }

  closeTab() {
    if (this.contextMenu.tabIndex >= 0) {
      this.ws.closeTab(this.contextMenu.tabIndex);
    }
    this.closeContextMenu();
  }

  closeOtherTabs() {
    if (this.contextMenu.tabIndex >= 0) {
      this.ws.closeOtherTabs(this.contextMenu.tabIndex);
    }
    this.closeContextMenu();
  }

  handleTabDragStart(event: DragEvent, index: number) {
    this.draggingIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', index.toString());
    }
  }

  handleTabDragOver(event: DragEvent, index: number) {
    if (this.draggingIndex === null) {
      return;
    }
    event.preventDefault();
    if (index === this.draggingIndex) {
      this.dragOverIndex = null;
    } else {
      this.dragOverIndex = index;
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  handleTabDrop(event: DragEvent, index: number) {
    if (this.draggingIndex === null) {
      return;
    }
    event.preventDefault();
    const fromIndex = this.draggingIndex;
    this.resetDragState();
    if (fromIndex === index) {
      return;
    }
    this.ws.reorderTabs(fromIndex, index);
  }

  handleTabStripDragOver(event: DragEvent) {
    if (this.draggingIndex === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  handleTabStripDrop(event: DragEvent) {
    if (this.draggingIndex === null) {
      return;
    }
    event.preventDefault();
    const filesCount = this.ws.files().length;
    if (!filesCount) {
      this.resetDragState();
      return;
    }
    const fromIndex = this.draggingIndex;
    const toIndex = filesCount - 1;
    this.resetDragState();
    if (fromIndex === toIndex) {
      return;
    }
    this.ws.reorderTabs(fromIndex, toIndex);
  }

  handleTabDragEnd() {
    this.resetDragState();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  isDarkTheme(): boolean {
    return this.theme.resolvedTheme() === 'dark';
  }

  async openFile(): Promise<void> {
    try {
      await this.ws.openFilesFromDisk();
    } catch (error) {
      console.error("Failed to open file dialog:", error);
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".http";
      input.multiple = true;
      input.onchange = (event) => {
        const files = (event.target as HTMLInputElement).files;
        if (files) {
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const reader = new FileReader();
            reader.onload = (e) => {
              this.ws.addFileFromContent(file.name, e.target?.result as string);
            };
            reader.readAsText(file);
          }
        }
      };
      input.click();
    }
  }

  async revealInFinder(index: number): Promise<void> {
    try {
      await this.ws.revealInFinder(index);
    } catch (error: any) {
      if (error?.message?.includes('not been saved')) {
        this.toast.info("This file has not been saved to disk yet.");
      } else {
        console.error("Failed to reveal file:", error);
        this.toast.error("Failed to reveal file in Finder.");
      }
    }
  }

  async importPostmanCollection(): Promise<void> {
    try {
      const count = await this.ws.importCollection('postman');
      if (count) {
        this.toast.success(`Imported ${count} file(s) from Postman collection`);
      }
    } catch (err: any) {
      console.error("Postman import failed:", err);
      this.toast.error("Import failed: " + (err?.message || err));
    }
  }

  async importBrunoCollection(): Promise<void> {
    try {
      const count = await this.ws.importCollection('bruno');
      if (count) {
        this.toast.success(`Imported ${count} file(s) from Bruno collection`);
      }
    } catch (err: any) {
      console.error("Bruno import failed:", err);
      this.toast.error("Import failed: " + (err?.message || err));
    }
  }

  async openExamplesFile(): Promise<void> {
    try {
      await this.ws.openExamplesFile();
    } catch (error) {
      console.error("Failed to open examples file:", error);
      this.toast.error("Failed to open examples file.");
    }
  }

  private resetDragState() {
    this.draggingIndex = null;
    this.dragOverIndex = null;
  }
}
