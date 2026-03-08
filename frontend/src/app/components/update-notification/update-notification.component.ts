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
    // Capture before the call — if the update is already downloaded, the Go
    // side will launch the updater helper and quit the app.  The Wails runtime
    // teardown will sever the RPC channel, causing the await to reject. That
    // rejection is expected and must not trigger the browser-open fallback.
    const isRestart = this.updateService.isUpdateReady();

    const started = await this.updateService.startUpdateAndRestart();
    if (!started && !isRestart) {
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
