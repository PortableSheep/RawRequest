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
    return this.splitTextIntoLines(bodyText).length;
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
      const lines = this.splitHighlightedIntoLines(result.html, result.lineCount);
      this.cachedBodyHash = bodyHash;
      this.cachedLines = lines;
      return lines;
    }
    
    const bodyLines = this.splitTextIntoLines(bodyText);
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
        this.refreshViewport();
        
        this.highlightSub = this.highlightService.highlight(bodyText).subscribe({
          next: (result) => {
            if (result) {
              this.highlightResult.set(result);
            }
            this.isProcessing.set(false);
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
    setTimeout(() => this.refreshViewport(), 0);
  }
  
  ngOnDestroy(): void {
    if (this.highlightSub) {
      this.highlightSub.unsubscribe();
    }
  }
  
  private splitTextIntoLines(text: string): string[] {
    return text.split(/\r\n|\n|\r/);
  }

  private splitHighlightedIntoLines(highlightedHtml: string, workerLineCount?: number): HighlightedLine[] {
    const htmlLines = this.splitTextIntoLines(highlightedHtml);

    const count =
      typeof workerLineCount === 'number' && workerLineCount > 0
        ? workerLineCount
        : htmlLines.length;

    const effectiveLines =
      Math.abs(htmlLines.length - count) <= 1
        ? htmlLines
        : htmlLines;

    return effectiveLines.map((line, index) => ({
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
    this.cdr.markForCheck();
    
    if (this.viewportReady && this.viewport) {
      setTimeout(() => {
        this.viewport?.checkViewportSize();
      }, 0);
    }
  }
}
