import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { UpdateService, ReleaseInfo } from '../../services/update.service';

@Component({
  selector: 'app-version-manager',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './version-manager.component.html',
  styleUrls: ['./version-manager.component.scss'],
})
export class VersionManagerComponent implements OnInit {
  readonly panels = inject(PanelVisibilityService);
  readonly updateService = inject(UpdateService);

  confirmVersion: ReleaseInfo | null = null;

  ngOnInit(): void {
    void this.updateService.listReleases();
  }

  close(): void {
    this.confirmVersion = null;
    this.panels.showVersionManager.set(false);
  }

  handleShellClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  promptInstall(release: ReleaseInfo): void {
    this.confirmVersion = release;
  }

  cancelInstall(): void {
    this.confirmVersion = null;
  }

  async confirmInstall(): Promise<void> {
    if (!this.confirmVersion) return;
    const version = this.confirmVersion.version;
    this.confirmVersion = null;
    this.close();
    await this.updateService.startInstallVersion(version);
  }

  async refreshReleases(): Promise<void> {
    await this.updateService.listReleases();
  }
}
