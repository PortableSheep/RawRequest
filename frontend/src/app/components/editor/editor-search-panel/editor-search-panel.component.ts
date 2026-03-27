import { Component, ChangeDetectionStrategy, ElementRef, ViewChild, AfterViewInit, inject, input, computed } from '@angular/core';
import { EditorSearchService } from '../editor-search.service';

@Component({
  selector: 'app-editor-search-panel',
  standalone: true,
  imports: [],
  templateUrl: './editor-search-panel.component.html',
  styleUrls: ['./editor-search-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorSearchPanelComponent implements AfterViewInit {
  @ViewChild('findInput') findInput?: ElementRef<HTMLInputElement>;
  @ViewChild('replaceInput') replaceInput?: ElementRef<HTMLInputElement>;

  isBusy = input<boolean>(false);

  readonly searchService = inject(EditorSearchService);

  readonly searchUi = this.searchService.searchUi;
  readonly searchUiStatsText = this.searchService.searchUiStatsText;

  ngAfterViewInit(): void {
    this.searchService.registerPanelCallbacks({
      focusFindInput: () => {
        const el = this.findInput?.nativeElement;
        if (el) { el.focus(); el.select(); }
      },
      focusReplaceInput: () => {
        this.replaceInput?.nativeElement?.focus();
        this.replaceInput?.nativeElement?.select();
      }
    });
  }
}
