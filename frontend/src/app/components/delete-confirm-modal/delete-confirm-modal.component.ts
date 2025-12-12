import { Component, input, output } from '@angular/core';


@Component({
  selector: 'app-delete-confirm-modal',
  standalone: true,
  imports: [],
  templateUrl: './delete-confirm-modal.component.html',
  styleUrls: ['./delete-confirm-modal.component.scss']
})
export class DeleteConfirmModalComponent {
  isOpen = input<boolean>(false);
  secretInfo = input<{ env: string, key: string } | null>(null);

  onConfirm = output<void>();
  onCancel = output<void>();
}
