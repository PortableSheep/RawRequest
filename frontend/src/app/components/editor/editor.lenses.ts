import { EditorView, WidgetType, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

class RunRequestWidget extends WidgetType {
  constructor(private readonly index: number, private readonly onClick: (index: number) => void) {
    super();
  }

  override eq(other: RunRequestWidget) {
    return other.index === this.index;
  }

  override toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-run-lens';
    
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-run-lens__btn';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      <span>Run Request</span>
    `;
    
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick(this.index);
    };

    wrap.appendChild(btn);
    return wrap;
  }

  override ignoreEvent() {
    return false;
  }
}

export function createCodeLensesExtension(onExecute: (index: number) => void) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder = new Array<{from: number, to: number, decoration: Decoration}>();
      const tree = syntaxTree(view.state);
      
      let requestIdx = 0;
      
      // We need to count request blocks to know which index we are at.
      // This is slightly inefficient but necessary for the click handler.
      const requestStarts: number[] = [];
      tree.iterate({
        enter: (node) => {
          if (node.name === 'MethodLine') {
            requestStarts.push(node.from);
          }
        }
      });

      for (const range of view.visibleRanges) {
        tree.iterate({
          from: range.from,
          to: range.to,
          enter: (node) => {
            if (node.name !== 'MethodLine') return;
            
            const idx = requestStarts.indexOf(node.from);
            if (idx === -1) return;

            const deco = Decoration.widget({
              widget: new RunRequestWidget(idx, onExecute),
              side: -1, // Above the line
              block: true
            });
            builder.push({ from: node.from, to: node.from, decoration: deco });
          }
        });
      }

      return Decoration.set(builder.map(b => b.decoration.range(b.from)), true);
    }
  }, {
    decorations: v => v.decorations
  });
}
