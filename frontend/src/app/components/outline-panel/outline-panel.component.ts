import { Component, input, output, computed } from '@angular/core';
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

  filterQuery = '';

  private allEntries = computed(() => buildOutlineEntries(this.requests()));

  groups = computed<OutlineGroup[]>(() => {
    const filtered = filterOutlineEntries(this.allEntries(), this.filterQuery);
    return groupOutlineEntries(filtered);
  });

  requestCount = computed(() => this.requests().length);

  selectRequest(index: number): void {
    this.onRequestSelect.emit(index);
  }
}
