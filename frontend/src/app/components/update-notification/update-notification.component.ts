import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpdateService } from '../../services/update.service';

@Component({
  selector: 'app-update-notification',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (updateService.showNotification() && updateService.updateInfo(); as info) {
      <div class="update-notification" role="alert">
        <div class="update-notification__content">
          <div class="update-notification__icon">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div class="update-notification__text">
            <p class="update-notification__title">
              Update Available: v{{ info.latestVersion }}
            </p>
            <p class="update-notification__subtitle">
              You're on v{{ info.currentVersion }}
              @if (info.publishedAt) {
                · Released {{ info.publishedAt }}
              }
            </p>
          </div>
        </div>
        <div class="update-notification__actions">
          <button 
            class="update-notification__btn update-notification__btn--secondary"
            (click)="remindLater()"
          >
            Later
          </button>
          <button 
            class="update-notification__btn update-notification__btn--secondary"
            (click)="dismiss()"
            title="Don't show again for this version"
          >
            Skip
          </button>
          <button 
            class="update-notification__btn update-notification__btn--primary"
            (click)="download()"
          >
            Download
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .update-notification {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 0.75rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      max-width: 360px;
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(1rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .update-notification__content {
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
    }

    .update-notification__icon {
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(59, 130, 246, 0.2);
      border-radius: 0.5rem;
      color: #60a5fa;
    }

    .update-notification__text {
      flex: 1;
      min-width: 0;
    }

    .update-notification__title {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 600;
      color: #f4f4f5;
    }

    .update-notification__subtitle {
      margin: 0.25rem 0 0;
      font-size: 0.75rem;
      color: #a1a1aa;
    }

    .update-notification__actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .update-notification__btn {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 500;
      border-radius: 0.375rem;
      cursor: pointer;
      transition: all 0.15s ease;
      border: none;
    }

    .update-notification__btn--primary {
      background: #3b82f6;
      color: white;
    }

    .update-notification__btn--primary:hover {
      background: #2563eb;
    }

    .update-notification__btn--secondary {
      background: rgba(255, 255, 255, 0.1);
      color: #a1a1aa;
    }

    .update-notification__btn--secondary:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #f4f4f5;
    }
  `]
})
export class UpdateNotificationComponent {
  protected updateService = inject(UpdateService);

  download(): void {
    this.updateService.openReleasePage();
    this.updateService.remindLater();
  }

  dismiss(): void {
    this.updateService.dismissUpdate();
  }

  remindLater(): void {
    this.updateService.remindLater();
  }
}
