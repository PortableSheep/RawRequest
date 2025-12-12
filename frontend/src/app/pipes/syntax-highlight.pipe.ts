import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'syntaxHighlight',
  standalone: true
})
export class SyntaxHighlightPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);


  transform(value: string): SafeHtml {
    if (!value) return '';

    const trimmed = value.trim();

    // Try to detect and highlight JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const formatted = JSON.stringify(parsed, null, 2);
        const highlighted = this.highlightJSON(formatted);
        return this.sanitizer.bypassSecurityTrustHtml(highlighted);
      } catch (e) {
        // Not valid JSON, continue to other checks
      }
    }

    // Check if it's XML
    if (trimmed.startsWith('<')) {
      const highlighted = this.highlightXML(trimmed);
      return this.sanitizer.bypassSecurityTrustHtml(highlighted);
    }

    // Plain text
    return value;
  }

  private highlightJSON(json: string): string {
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    });
  }

  private highlightXML(xml: string): string {
    return xml
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/(&lt;\/?)(\w+)(.*?)(&gt;)/g, '$1<span class="xml-tag">$2</span>$3$4')
      .replace(/(\w+)=(".*?")/g, '<span class="xml-attr">$1</span>=$2')
      .replace(/".*?"/g, '<span class="xml-string">$0</span>');
  }
}