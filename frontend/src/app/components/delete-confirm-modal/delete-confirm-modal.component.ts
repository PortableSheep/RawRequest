import { Component, HostListener, input, output } from '@angular/core';

import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-delete-confirm-modal',
  standalone: true,
  imports: [FocusTrapDirective, IconComponent],
  templateUrl: './delete-confirm-modal.component.html',
  styleUrls: ['./delete-confirm-modal.component.scss']
})
export class DeleteConfirmModalComponent {
  isOpen = input<boolean>(false);
  secretInfo = input<{ env: string, key: string } | null>(null);

  onConfirm = output<void>();
  onCancel = output<void>();

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (!this.isOpen()) return;
    this.onCancel.emit();
  }
}
