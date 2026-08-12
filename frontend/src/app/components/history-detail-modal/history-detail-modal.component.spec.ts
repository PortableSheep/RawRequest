import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HistoryDetailModalComponent } from './history-detail-modal.component';
import type { HistoryItem } from '../../models/http.models';

function makeHistoryItem(body = '{"ok":true}'): HistoryItem {
  return {
    timestamp: new Date('2026-01-01T00:00:00Z'),
    method: 'GET',
    url: 'https://example.com',
    status: 200,
    statusText: 'OK',
    responseTime: 12,
    responseData: {
      status: 200,
      statusText: 'OK',
      headers: {},
      body,
      responseTime: 12,
    },
  };
}

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

    describe('response copying', () => {
      it('shows a copy action and copies the formatted response body', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText },
          configurable: true,
        });
        fixture.componentRef.setInput('isOpen', true);
        fixture.componentRef.setInput('item', makeHistoryItem());
        fixture.detectChanges();

        const copyButton: HTMLButtonElement = fixture.nativeElement.querySelector('.history-detail-modal__copy');
        expect(copyButton).toBeTruthy();

        copyButton.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(writeText).toHaveBeenCalledWith('{\n  "ok": true\n}');
        expect(copyButton.textContent).toContain('Copied');
      });
    });
  });
});
