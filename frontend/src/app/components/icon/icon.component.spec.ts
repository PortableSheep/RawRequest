import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent, IconName } from './icon.component';

@Component({
  standalone: true,
  imports: [IconComponent],
  template: `<app-icon [name]="name" class="rr-icon rr-icon--md"></app-icon>`,
})
class TestHostComponent {
  name: IconName = 'close';
}

describe('IconComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
  });

  it('renders the close icon path', () => {
    host.name = 'close';
    fixture.detectChanges();

    const path = fixture.nativeElement.querySelector('svg path');
    expect(path?.getAttribute('d')).toBe('M18 6L6 18M6 6l12 12');
  });

  it('renders the chevron-down icon path', () => {
    host.name = 'chevron-down';
    fixture.detectChanges();

    const path = fixture.nativeElement.querySelector('svg path');
    expect(path?.getAttribute('d')).toBe('M19 9l-7 7-7-7');
  });

  it('renders the more-vertical icon as three dots', () => {
    host.name = 'more-vertical';
    fixture.detectChanges();

    const circles = fixture.nativeElement.querySelectorAll('svg circle');
    expect(circles.length).toBe(3);
  });

  it('keeps caller-provided sizing/color classes on the host element', () => {
    fixture.detectChanges();

    const hostEl = fixture.nativeElement.querySelector('app-icon');
    expect(hostEl.classList.contains('rr-icon')).toBe(true);
    expect(hostEl.classList.contains('rr-icon--md')).toBe(true);
  });
});
