import { Component, input, output, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { FileTab } from '../../models/http.models';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-header',
  imports: [FormsModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  private readonly theme = inject(ThemeService);

  // Signal inputs
  files = input<FileTab[]>([]);
  currentFileIndex = input<number>(0);
  environments = input<string[]>([]);
  selectedEnv = input<string>('');
  appVersion = input<string>('');

  // Signal outputs
  onFileSelect = output<number>();
  onNewFile = output<void>();
  onOpenFile = output<void>();
  onSaveFile = output<void>();
  onSaveFileAs = output<void>();
  onOpenExamples = output<void>();
  onEnvChange = output<string>();
  onSecretsClick = output<void>();
  onDonateClick = output<void>();
  onHistoryClick = output<void>();
  onCloseFile = output<number>();
  onReorderTabs = output<{ fromIndex: number; toIndex: number }>();
  onRevealInFinder = output<number>();
  onCloseOtherTabs = output<number>();

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

  handleContextMenu(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    
    const file = this.files()[index];
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

  revealInFinder() {
    if (this.contextMenu.tabIndex >= 0) {
      this.onRevealInFinder.emit(this.contextMenu.tabIndex);
    }
    this.closeContextMenu();
  }

  closeTab() {
    if (this.contextMenu.tabIndex >= 0) {
      this.onCloseFile.emit(this.contextMenu.tabIndex);
    }
    this.closeContextMenu();
  }

  closeOtherTabs() {
    if (this.contextMenu.tabIndex >= 0) {
      this.onCloseOtherTabs.emit(this.contextMenu.tabIndex);
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
    this.onReorderTabs.emit({ fromIndex, toIndex: index });
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
    const filesCount = this.files().length;
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
    this.onReorderTabs.emit({ fromIndex, toIndex });
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

  private resetDragState() {
    this.draggingIndex = null;
    this.dragOverIndex = null;
  }
}
