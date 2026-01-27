import { Component, HostListener, input, output } from '@angular/core';

import { BrowserOpenURL } from '../../../../wailsjs/runtime/runtime';

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

  private readonly donateUrl = 'https://donate.stripe.com/6oU4gz41RbihdYI4Hk5Ne00';

  // Internal form state
  customAmount = 10;

  onClose = output<void>();
  onDonate = output<number>();

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (!this.isOpen()) return;
    this.onClose.emit();
  }

  handleShellClick(event: MouseEvent): void {
    // Only close if the user clicked outside the modal content.
    if (event.target === event.currentTarget) {
      this.onClose.emit();
    }
  }

  openDonate(): void {
    // Close immediately so the user sees feedback even if the external open is slow.
    this.onClose.emit();

    // Wails-preferred path: open in the system browser.
    // No fallback to window.open.
    try {
      BrowserOpenURL(this.donateUrl);
    } catch (error) {
      console.error('Failed to open donation URL', error);
    }
  }
}
