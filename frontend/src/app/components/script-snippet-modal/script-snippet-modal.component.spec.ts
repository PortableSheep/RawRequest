import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScriptSnippetModalComponent } from './script-snippet-modal.component';
import { ScriptSnippetService } from '../../services/script-snippet.service';

function createMockSnippetService() {
  return {
    snippets: [],
    search: vi.fn().mockReturnValue([]),
    getAllCategories: vi.fn().mockReturnValue([]),
  };
}

describe('ScriptSnippetModalComponent', () => {
  let fixture: ComponentFixture<ScriptSnippetModalComponent>;
  let component: ScriptSnippetModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScriptSnippetModalComponent],
      providers: [
        { provide: ScriptSnippetService, useValue: createMockSnippetService() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScriptSnippetModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Escape key', () => {
    it('should close on Escape when open', () => {
      component.open();
      fixture.detectChanges();

      const spy = vi.fn();
      component.closed.subscribe(spy);

      component.handleEscape();

      expect(component.isOpen()).toBe(false);
      expect(spy).toHaveBeenCalled();
    });

    it('should do nothing on Escape when already closed', () => {
      fixture.detectChanges();

      const spy = vi.fn();
      component.closed.subscribe(spy);

      component.handleEscape();

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
