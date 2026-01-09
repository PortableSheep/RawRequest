import { Component, input, computed, ViewChild, effect, untracked, SecurityContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface HighlightedLine {
  lineNumber: number;
  content: SafeHtml;
}

/**
 * Component for efficiently displaying large response bodies using virtual scrolling.
 * For bodies with > 1000 lines, uses CDK virtual scroll viewport to only render visible lines.
 * For smaller bodies, uses traditional pre element for better performance.
 */
@Component({
  selector: 'app-virtual-response-body',
  standalone: true,
  imports: [CommonModule, ScrollingModule],
  templateUrl: './virtual-response-body.component.html',
  styleUrls: ['./virtual-response-body.component.scss']
})
export class VirtualResponseBodyComponent {
  /** Raw response body text */
  body = input<string>('');
  
  /** Pre-highlighted HTML content (from syntaxHighlight pipe) */
  highlightedContent = input<SafeHtml | string>('');
  
  /** Number of lines threshold for using virtual scroll (default: 1000) */
  threshold = input<number>(1000);
  
  @ViewChild(CdkVirtualScrollViewport) viewport?: CdkVirtualScrollViewport;
  
  /** Line height in pixels (11px * 1.625 line-height ≈ 18px) */
  lineHeight = 18;
  
  /** Computed: whether to use virtual scrolling based on line count */
  useVirtualScroll = computed(() => {
    const bodyText = this.body();
    if (!bodyText) return false;
    const lineCount = bodyText.split('\n').length;
    return lineCount > this.threshold();
  });
  
  /** Computed: array of lines with line numbers for virtual scroll */
  lines = computed<HighlightedLine[]>(() => {
    if (!this.useVirtualScroll()) return [];
    
    const bodyText = this.body();
    const highlighted = this.highlightedContent();
    
    if (!bodyText) return [];
    
    const bodyLines = bodyText.split('\n');
    
    // If we have highlighted content (string or SafeHtml), normalize it to a string
    const highlightedStr =
      typeof highlighted === 'string'
        ? highlighted
        : highlighted
        ? this.sanitizer.sanitize(SecurityContext.HTML, highlighted) || ''
        : '';
    const hasHighlighting = highlightedStr.includes('<span');
    
    if (hasHighlighting) {
      // Parse highlighted HTML and extract lines
      return this.parseHighlightedLines(highlightedStr, bodyLines.length);
    }
    
    // No highlighting, return plain lines
    return bodyLines.map((line, index) => ({
      lineNumber: index + 1,
      content: this.sanitizer.sanitize(SecurityContext.HTML, line) || line
    }));
  });

  constructor(private sanitizer: DomSanitizer) {
    // Reset scroll position when body changes
    effect(() => {
      const bodyText = this.body();
      untracked(() => {
        if (this.viewport) {
          this.viewport.scrollToIndex(0, 'auto');
        }
      });
    });
  }
  
  /**
   * Parse highlighted HTML content into individual lines.
   * This handles the case where syntax highlighting spans multiple lines.
   */
  private parseHighlightedLines(highlightedHtml: string, lineCount: number): HighlightedLine[] {
    // Create a temporary DOM element to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = highlightedHtml;
    
    // Get the text content and split by lines
    const textContent = tempDiv.textContent || tempDiv.innerText || '';
    const lines = textContent.split('\n');
    
    // For simplicity, if the line counts don't match, fall back to innerHTML split
    if (lines.length !== lineCount && highlightedHtml.split('\n').length === lineCount) {
      const htmlLines = highlightedHtml.split('\n');
      return htmlLines.map((line, index) => ({
        lineNumber: index + 1,
        content: this.sanitizer.sanitize(SecurityContext.HTML, line) || line
      }));
    }
    
    // Otherwise return the parsed lines
    return lines.map((line, index) => ({
      lineNumber: index + 1,
      content: this.sanitizer.sanitize(SecurityContext.HTML, line) || line
    }));
  }
}
