import { Component, output, computed, effect, ElementRef, viewChild, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Request } from '../../models/http.models';
import { buildOutlineEntries, groupOutlineEntries, filterOutlineEntries, type OutlineGroup } from './outline-panel.logic';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { RequestExecutionService } from '../../services/request-execution.service';

@Component({
  selector: 'app-outline-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './outline-panel.component.html',
  styleUrls: ['./outline-panel.component.scss']
})
export class OutlinePanelComponent {
  readonly ws = inject(WorkspaceStateService);
  readonly panels = inject(PanelVisibilityService);
  readonly reqExec = inject(RequestExecutionService);

  onRequestSelect = output<number>();

  filterQuery = signal('');
  filterInput = viewChild<ElementRef>('filterInput');

  private allEntries = computed(() => buildOutlineEntries(this.ws.currentFileView().requests));

  groups = computed<OutlineGroup[]>(() => {
    const filtered = filterOutlineEntries(this.allEntries(), this.filterQuery());
    return groupOutlineEntries(filtered);
  });

  requestCount = computed(() => this.ws.currentFileView().requests.length);

  constructor() {
    effect(() => {
      if (this.panels.showOutlinePanel()) {
        setTimeout(() => this.filterInput()?.nativeElement.focus(), 0);
      }
    });
  }

  selectRequest(index: number): void {
    this.onRequestSelect.emit(index);
    this.panels.showOutlinePanel.set(false);
  }
}
