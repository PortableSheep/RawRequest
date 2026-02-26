import { Component, input, output, computed, effect, ElementRef, viewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Request } from '../../models/http.models';
import { buildOutlineEntries, groupOutlineEntries, filterOutlineEntries, type OutlineGroup } from './outline-panel.logic';

@Component({
  selector: 'app-outline-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './outline-panel.component.html',
  styleUrls: ['./outline-panel.component.scss']
})
export class OutlinePanelComponent {
  isOpen = input<boolean>(false);
  requests = input<Request[]>([]);
  activeRequestIndex = input<number | null>(null);

  onClose = output<void>();
  onRequestSelect = output<number>();

  filterQuery = signal('');
  filterInput = viewChild<ElementRef>('filterInput');

  private allEntries = computed(() => buildOutlineEntries(this.requests()));

  groups = computed<OutlineGroup[]>(() => {
    const filtered = filterOutlineEntries(this.allEntries(), this.filterQuery());
    return groupOutlineEntries(filtered);
  });

  requestCount = computed(() => this.requests().length);

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        setTimeout(() => this.filterInput()?.nativeElement.focus(), 0);
      }
    });
  }

  selectRequest(index: number): void {
    this.onRequestSelect.emit(index);
    this.onClose.emit();
  }
}
