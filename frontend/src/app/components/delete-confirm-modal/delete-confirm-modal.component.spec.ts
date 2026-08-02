import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeleteConfirmModalComponent } from './delete-confirm-modal.component';

describe('DeleteConfirmModalComponent', () => {
  let fixture: ComponentFixture<DeleteConfirmModalComponent>;
  let component: DeleteConfirmModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeleteConfirmModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DeleteConfirmModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Escape key', () => {
    it('should emit onCancel on Escape when open', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const spy = vi.fn();
      component.onCancel.subscribe(spy);

      component.handleEscape();

      expect(spy).toHaveBeenCalled();
    });

    it('should not emit onCancel on Escape when closed', () => {
      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();

      const spy = vi.fn();
      component.onCancel.subscribe(spy);

      component.handleEscape();

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
