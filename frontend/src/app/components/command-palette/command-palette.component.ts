import { Component, output, signal, computed, ElementRef, viewChild, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { buildPaletteItems, searchPaletteItems, FuzzyMatch } from './command-palette.logic';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.scss']
})
export class CommandPaletteComponent {
  readonly ws = inject(WorkspaceStateService);
  readonly panels = inject(PanelVisibilityService);

  onRequestSelect = output<number>();

  query = signal('');
  selectedIndex = signal(0);
  searchInput = viewChild<ElementRef>('searchInput');

  private items = computed(() => buildPaletteItems(this.ws.currentFileView().requests));
  results = computed(() => searchPaletteItems(this.items(), this.query()));

  constructor() {
    effect(() => {
      if (this.panels.showCommandPalette()) {
        this.query.set('');
        this.selectedIndex.set(0);
        setTimeout(() => this.searchInput()?.nativeElement.focus(), 0);
      }
    });
  }

  onQueryChange(value: string) {
    this.query.set(value);
    this.selectedIndex.set(0);
  }

  onKeydown(event: KeyboardEvent) {
    const results = this.results();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.set(Math.min(this.selectedIndex() + 1, results.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.set(Math.max(this.selectedIndex() - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (results.length > 0) {
          this.selectItem(results[this.selectedIndex()]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.panels.showCommandPalette.set(false);
        break;
    }
  }

  selectItem(match: FuzzyMatch) {
    this.onRequestSelect.emit(match.item.requestIndex);
    this.panels.showCommandPalette.set(false);
  }

  getMethodClass(method: string): string {
    return `rr-palette-method rr-palette-method--${method.toLowerCase()}`;
  }
}
