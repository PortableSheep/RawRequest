import { Component, input, computed, ViewChild, effect, untracked, signal, OnDestroy, ChangeDetectionStrategy, inject, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { SyntaxHighlightWorkerService, HighlightResult } from '../../services/syntax-highlight-worker.service';

interface HighlightedLine {
  lineNumber: number;
  content: string | SafeHtml;
}

/**
 * Virtual scrolling response body component.
 * Always uses virtual scrolling to handle responses of any size efficiently.
 */
@Component({
  selector: 'app-virtual-response-body',
  standalone: true,
  imports: [CommonModule, ScrollingModule],
  templateUrl: './virtual-response-body.component.html',
  styleUrls: ['./virtual-response-body.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VirtualResponseBodyComponent implements OnDestroy, AfterViewInit {
  private highlightService = inject(SyntaxHighlightWorkerService);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);
  
  body = input<string>('');
  
  @ViewChild(CdkVirtualScrollViewport) viewport?: CdkVirtualScrollViewport;
  
  lineHeight = 18;
  isProcessing = signal(false);
  
  private highlightResult = signal<HighlightResult | null>(null);
  private highlightSub?: Subscription;
  private cachedBodyHash = '';
  private cachedLines: HighlightedLine[] = [];
  private viewportReady = false;
  
  private lineCount = computed(() => {
    const bodyText = this.body();
    if (!bodyText) return 0;
    return (bodyText.match(/\n/g) || []).length + 1;
  });
  
  lines = computed<HighlightedLine[]>(() => {
    const bodyText = this.body();
    if (!bodyText) return [];
    
    const bodyHash = `${bodyText.length}:${bodyText.slice(0, 100)}:${bodyText.slice(-100)}`;
    if (bodyHash === this.cachedBodyHash && this.cachedLines.length > 0) {
      return this.cachedLines;
    }
    
    const result = this.highlightResult();
    
    if (result?.html) {
      const lines = this.splitIntoLines(result.html, this.lineCount());
      this.cachedBodyHash = bodyHash;
      this.cachedLines = lines;
      return lines;
    }
    
    // No highlighting yet - show plain text
    const bodyLines = bodyText.split('\n');
    const lines = bodyLines.map((line, index) => ({
      lineNumber: index + 1,
      content: this.escapeHtml(line)
    }));
    
    return lines;
  });

  constructor() {
    effect(() => {
      const bodyText = this.body();
      
      untracked(() => {
        if (this.highlightSub) {
          this.highlightSub.unsubscribe();
          this.highlightSub = undefined;
        }
        
        this.highlightResult.set(null);
        this.cachedBodyHash = '';
        this.cachedLines = [];
      
        if (this.viewport) {
          this.viewport.scrollToIndex(0, 'auto');
        }
        
        if (!bodyText) {
          this.isProcessing.set(false);
          this.refreshViewport();
          return;
        }
      
        this.isProcessing.set(true);
        // Trigger immediate refresh for plain text display
        this.refreshViewport();
        
        this.highlightSub = this.highlightService.highlight(bodyText).subscribe({
          next: (result) => {
            if (result) {
              this.highlightResult.set(result);
            }
            this.isProcessing.set(false);
            // Refresh viewport after highlighting completes
            this.refreshViewport();
          },
          error: () => {
            this.isProcessing.set(false);
            this.refreshViewport();
          }
        });
      });
    });
  }
  
  ngAfterViewInit(): void {
    this.viewportReady = true;
    // Initial viewport check after view is ready
    setTimeout(() => this.refreshViewport(), 0);
  }
  
  ngOnDestroy(): void {
    if (this.highlightSub) {
      this.highlightSub.unsubscribe();
    }
  }
  
  private splitIntoLines(highlightedHtml: string, expectedLineCount: number): HighlightedLine[] {
    const htmlLines = highlightedHtml.split('\n');
    
    if (Math.abs(htmlLines.length - expectedLineCount) <= 1) {
      return htmlLines.slice(0, expectedLineCount).map((line, index) => ({
        lineNumber: index + 1,
        content: this.sanitizer.bypassSecurityTrustHtml(line)
      }));
    }
    
    const tempDiv = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (tempDiv) {
      tempDiv.innerHTML = highlightedHtml;
      const textContent = tempDiv.textContent || tempDiv.innerText || '';
      const textLines = textContent.split('\n');
      
      return textLines.slice(0, expectedLineCount).map((line, index) => ({
        lineNumber: index + 1,
        content: this.escapeHtml(line)
      }));
    }
    
    return htmlLines.slice(0, expectedLineCount).map((line, index) => ({
      lineNumber: index + 1,
      content: this.sanitizer.bypassSecurityTrustHtml(line)
    }));
  }
  
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  
  trackByLineNumber(index: number, line: HighlightedLine): number {
    return line.lineNumber;
  }
  
  private refreshViewport(): void {
    // Mark component for check to ensure change detection runs
    this.cdr.markForCheck();
    
    // Schedule viewport size check for next tick (after DOM updates)
    if (this.viewportReady && this.viewport) {
      setTimeout(() => {
        this.viewport?.checkViewportSize();
      }, 0);
    }
  }
}
