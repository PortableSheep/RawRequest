import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HistoryDetailModalComponent } from './history-detail-modal.component';

describe('HistoryDetailModalComponent', () => {
  let fixture: ComponentFixture<HistoryDetailModalComponent>;
  let component: HistoryDetailModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoryDetailModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryDetailModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Escape key', () => {
    it('should emit onClose on Escape when open', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const spy = vi.fn();
      component.onClose.subscribe(spy);

      component.handleEscape();

      expect(spy).toHaveBeenCalled();
    });

    it('should not emit onClose on Escape when closed', () => {
      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();

      const spy = vi.fn();
      component.onClose.subscribe(spy);

      component.handleEscape();

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
