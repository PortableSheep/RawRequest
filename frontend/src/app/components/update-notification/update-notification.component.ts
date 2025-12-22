import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpdateService } from '../../services/update.service';

@Component({
  selector: 'app-update-notification',
  standalone: true,
  imports: [CommonModule],
  templateUrl: 'update-notification.component.html',
  styleUrls: ['update-notification.component.scss']
})
export class UpdateNotificationComponent {
  protected updateService = inject(UpdateService);

  async downloadOrRestart(): Promise<void> {
    const started = await this.updateService.startUpdateAndRestart();
    if (!started) {
      await this.updateService.openReleasePage();
		this.updateService.remindLater();
    }
  }

  dismiss(): void {
    if (this.updateService.isUpdateReady()) {
      this.updateService.clearPreparedUpdate();
    }
    this.updateService.dismissUpdate();
  }

  remindLater(): void {
    this.updateService.remindLater();
  }
}
