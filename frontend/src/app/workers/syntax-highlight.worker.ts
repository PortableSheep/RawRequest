interface HighlightRequest {
  id: number;
  content: string;
  type: 'highlight';
}

interface HighlightResponse {
  id: number;
  html: string;
  lineCount: number;
  isLarge: boolean;
  type: 'highlight-result';
}

const LARGE_THRESHOLD = 5000;
const HUGE_THRESHOLD = 50000;
const MAX_PARSE_SIZE = 2_000_000;

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const { id, content, type } = event.data;
  
  if (type !== 'highlight') return;
  
  const result = processContent(content);
  
  const response: HighlightResponse = {
    id,
    ...result,
    type: 'highlight-result'
  };
  
  self.postMessage(response);
};

function processContent(content: string): { html: string; lineCount: number; isLarge: boolean } {
  const lineCount = (content.match(/\n/g) || []).length + 1;
  const isLarge = lineCount > LARGE_THRESHOLD;
  
  if (lineCount > HUGE_THRESHOLD || content.length > MAX_PARSE_SIZE) {
    return {
      html: escapeHtml(content),
      lineCount,
      isLarge: true
    };
  }

  const trimmed = content.trim();
  let html: string;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      if (isLarge) {
        html = highlightJSONFast(content);
      } else {
        const parsed = JSON.parse(trimmed);
        const formatted = JSON.stringify(parsed, null, 2);
        html = highlightJSON(formatted);
      }
      return { html, lineCount: (html.match(/\n/g) || []).length + 1, isLarge };
    } catch (e) {
    }
  }

  if (trimmed.startsWith('<')) {
    html = highlightXML(trimmed);
    return { html, lineCount, isLarge };
  }

  return {
    html: escapeHtml(content),
    lineCount,
    isLarge
  };
}

function highlightJSONFast(json: string): string {
  return escapeHtml(json).replace(
    /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match, key, str, bool, num) => {
      if (key) return `<span class="json-key">${key}</span>:`;
      if (str) return `<span class="json-string">${str}</span>`;
      if (bool) return `<span class="json-boolean">${match}</span>`;
      if (num) return `<span class="json-number">${match}</span>`;
      return match;
    }
  );
}

function highlightJSON(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
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
    }
  );
}

function highlightXML(xml: string): string {
  let result = xml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  result = result.replace(/(&lt;\/?)(\w[\w:-]*)([^&]*?)(&gt;)/g, (match, open, tagName, rest, close) => {
    const highlightedRest = rest.replace(/(\w[\w:-]*)=("([^"]*)"|'([^']*)'|&quot;([^&]*)&quot;)/g, 
      (_attrMatch: string, attrName: string, fullValue: string) => {
        return `<span class="xml-attr">${attrName}</span>=<span class="xml-string">${fullValue}</span>`;
      });
    return `${open}<span class="xml-tag">${tagName}</span>${highlightedRest}${close}`;
  });
  
  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
