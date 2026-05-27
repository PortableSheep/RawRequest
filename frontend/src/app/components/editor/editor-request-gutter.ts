import { BlockInfo, EditorView, GutterMarker, ViewUpdate, gutter } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { DEPENDS_LINE_REGEX, LOAD_LINE_REGEX, MOCK_LINE_REGEX, isMethodLine, isSeparatorLine } from '../../utils/http-file-analysis';

class CompositeGutterMarker extends GutterMarker {
  constructor(
    private hasDepends: boolean, 
    private hasLoad: boolean, 
    private requestIndex: number,
    private onExecute: (index: number) => void
  ) {
    super();
  }

  override toDOM() {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'row';
    wrap.style.alignItems = 'flex-start';
    wrap.style.justifyContent = 'center';
    wrap.style.gap = '4px';
    wrap.style.lineHeight = '1';

    // 1. Play Button
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.dataset['requestIndex'] = String(this.requestIndex);
    
    playBtn.className = 'gutter-play-btn';
    playBtn.title = 'Run Request';
    playBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M8 5v14l11-7z" />
      </svg>
    `;
    playBtn.onmousedown = e => e.preventDefault();
    playBtn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      this.onExecute(this.requestIndex);
    };
    wrap.appendChild(playBtn);

    // 2. Chained Icon
    if (this.hasDepends) {
      const icon = document.createElement('span');
      icon.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 13" />
          <path d="M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 0 1-7-7L7 11" />
        </svg>
      `;
      icon.className = 'gutter-chain-icon';
      icon.title = 'Chained request';
      wrap.appendChild(icon);
    }

    // 3. Load Test Icon
    if (this.hasLoad) {
      const icon = document.createElement('span');
      icon.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      `;
      icon.className = 'gutter-lightning-icon';
      icon.title = 'Load test';
      wrap.appendChild(icon);
    }

    return wrap;
  }
}

export function createRequestGutter(
  onExecute: (index: number) => void,
  getBlockIndex: () => Array<{ from: number; to: number; index: number }>
): Extension {
  return gutter({
    class: 'cm-gutter-play',
    lineMarker: (view: EditorView, line: BlockInfo) => {
      const lineNo = view.state.doc.lineAt(line.from).number;
      const lineContent = view.state.doc.line(lineNo).text;
      
      // We only render icons on the method line (GET, POST, etc.)
      if (!isMethodLine(lineContent)) {
        return null;
      }

      let isFirstMethod = true;
      let hasDepends = false;
      let hasLoad = false;
      let isMock = false;

      // Scan upwards from the method line to find annotations belonging to this request.
      for (let i = lineNo - 1; i >= 1; i--) {
        const prevLineText = view.state.doc.line(i).text;
        if (isSeparatorLine(prevLineText)) {
          break;
        }
        if (isMethodLine(prevLineText)) {
          isFirstMethod = false;
          break;
        }
        const prevTrimmed = prevLineText.trimStart();
        if (DEPENDS_LINE_REGEX.test(prevTrimmed)) {
          hasDepends = true;
        }
        if (LOAD_LINE_REGEX.test(prevTrimmed)) {
          hasLoad = true;
        }
        if (MOCK_LINE_REGEX.test(prevTrimmed)) {
          isMock = true;
        }
      }

      if (!isFirstMethod) {
        return null;
      }

      // Find the request index for this block
      const blocks = getBlockIndex();
      let requestIndex = -1;
      if (blocks.length) {
        const block = blocks.find(b => line.from >= b.from && line.from <= b.to);
        if (block) requestIndex = block.index;
      } else {
        // Fallback: scan from doc start to count method-line starts.
        // This handles initial paint before the indexer ViewPlugin has populated.
        let inRequest = false;
        let count = -1;
        for (let i = 1; i <= lineNo; i++) {
          const t = view.state.doc.line(i).text;
          if (isSeparatorLine(t)) { inRequest = false; continue; }
          if (isMethodLine(t)) {
            if (!inRequest) {
              count++;
              inRequest = true;
              if (i === lineNo) { requestIndex = count; break; }
            } else if (i === lineNo) {
              break;
            }
          }
        }
      }

      if (requestIndex === -1) {
        return null;
      }

      if (isMock) {
        return null;
      }

      return new CompositeGutterMarker(hasDepends, hasLoad, requestIndex, onExecute);
    },

    lineMarkerChange: (update: ViewUpdate) => update.docChanged || update.viewportChanged
  });
}
