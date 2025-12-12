import { Component, input, output } from '@angular/core';

import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-donation-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './donation-modal.component.html',
  styleUrls: ['./donation-modal.component.scss']
})
export class DonationModalComponent {
  isOpen = input<boolean>(false);

  // Internal form state
  customAmount = 10;

  onClose = output<void>();
  onDonate = output<number>();
}
