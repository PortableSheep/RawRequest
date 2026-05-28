import { CommonModule } from '@angular/common';
import { Component, input, signal, computed, HostListener, ElementRef, inject, ViewChild, AfterViewInit, effect, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScriptLogEntry } from '../../models/http.models';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { ScriptConsoleService } from '../../services/script-console.service';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { MockServerService } from '../../services/mock-server.service';
import { EventsOn } from '@wailsjs/runtime/runtime';
import { StartMockServer, StopMockServer, GetMockServerStatus } from '@wailsjs/go/app/App';
import { gsap } from 'gsap';

type FooterTone = 'idle' | 'pending' | 'success' | 'warning' | 'error';

interface MockServerLogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

@Component({
  selector: 'app-console-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './console-drawer.component.html',
  styleUrls: ['./console-drawer.component.scss']
})
export class ConsoleDrawerComponent implements OnInit, OnDestroy {
  private el = inject(ElementRef);
  private readonly panels = inject(PanelVisibilityService);
  readonly scriptConsole = inject(ScriptConsoleService);
  readonly ws = inject(WorkspaceStateService);

  // Tab State
  activeTab = this.panels.consoleActiveTab;

  // Mock Server UI State & Service
  readonly mockServer = inject(MockServerService);
  mockPort = signal<number>(8080);
  mockDB = signal<string>('');
  mockServerRunning = computed(() => this.mockServer.status().running);
  mockLogs = computed(() => this.mockServer.logs());

  hasActiveFile = computed(() => {
    const files = this.ws.files();
    const idx = this.ws.currentFileIndex();
    return !!files[idx];
  });

  @ViewChild('drawerShell') drawerShell?: ElementRef<HTMLElement>;
  @ViewChild('bubbleButton') bubbleButton?: ElementRef<HTMLButtonElement>;
  
  status = input<{ label: string; detail: string; tone: FooterTone } | null>(null);
  version = input<string>('Raw Request v1');

  readonly latestLog = computed(() => {
    const entries = this.scriptConsole.logs();
    return entries.length ? entries[entries.length - 1] : null;
  });

  // Render state: keep the drawer in DOM long enough to animate out.
  isDrawerVisible = signal<boolean>(false);
  private drawerTween: gsap.core.Tween | null = null;
  private bubbleTween: gsap.core.Tween | null = null;
  private hasView = false;
  private pendingOpenAnimation = false;

  // Resize state
  panelHeight = signal<number>(380); // Default 380px
  isResizing = signal<boolean>(false);
  private startY = 0;
  private startHeight = 0;
  private readonly minHeight = 150;

  private get maxHeight(): number {
    return typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600;
  }

  constructor() {
    effect(() => {
      const isOpen = this.panels.consoleOpen();
      if (!this.hasView) {
        // Defer animations until ViewChild refs are available.
        this.isDrawerVisible.set(isOpen);
        return;
      }
      this.syncAnimatedState(isOpen);
    });

    effect(() => {
      // Keep a global CSS var updated so other fixed UI can sit above the console.
      // This avoids the "load test running" bar being hidden behind the drawer.
      if (typeof document === 'undefined') {
        return;
      }

      const visible = this.isDrawerVisible();
      // Track height changes (resize) as well.
      void this.panelHeight();

      const root = document.documentElement;
      if (!visible) {
        root.style.setProperty('--rr-console-offset', '0px');
        return;
      }

      // Measure after layout.
      requestAnimationFrame(() => {
        const shell = this.drawerShell?.nativeElement;
        const rectHeight = shell ? shell.getBoundingClientRect().height : 0;
        root.style.setProperty('--rr-console-offset', `${Math.ceil(rectHeight)}px`);
      });
    });
  }

  ngAfterViewInit(): void {
    this.hasView = true;
    // Apply initial state.
    this.syncAnimatedState(this.panels.consoleOpen(), true);
  }

  handleToggle() {
    this.panels.toggleConsole();
  }

  requestClose() {
    if (!this.panels.consoleOpen()) {
      return;
    }
    this.panels.toggleConsole(false);
  }

  handleClear() {
    this.scriptConsole.clear();
  }

  private syncAnimatedState(open: boolean, immediate = false): void {
    if (open) {
      this.animateOpen(immediate);
      return;
    }
    this.animateClose(undefined, immediate);
  }

  private animateOpen(immediate = false): void {
    this.drawerTween?.kill();
    this.bubbleTween?.kill();

    this.isDrawerVisible.set(true);
    const shell = this.drawerShell?.nativeElement;
    const bubble = this.bubbleButton?.nativeElement;
    if (!shell) {
      // Drawer is controlled by an @if; it won't exist until after this change
      // detection pass. Retry on the next frame.
      if (!this.pendingOpenAnimation) {
        this.pendingOpenAnimation = true;
        requestAnimationFrame(() => {
          this.pendingOpenAnimation = false;
          if (this.panels.consoleOpen()) {
            this.animateOpen(immediate);
          }
        });
      }
      return;
    }

    if (immediate) {
      gsap.set(shell, { y: 0, opacity: 1, scale: 1 });
      if (bubble) gsap.set(bubble, { opacity: 0, scale: 0.98 });
      return;
    }

    gsap.set(shell, { y: 18, opacity: 0, scale: 0.995 });
    this.drawerTween = gsap.to(shell, {
      y: 0,
      opacity: 1,
      scale: 1,
      duration: 0.22,
      ease: 'power2.out'
    });

    if (bubble) {
      this.bubbleTween = gsap.to(bubble, {
        opacity: 0,
        scale: 0.98,
        duration: 0.14,
        ease: 'power1.out'
      });
    }
  }

  private animateClose(after?: () => void, immediate = false): void {
    this.drawerTween?.kill();
    this.bubbleTween?.kill();

    const shell = this.drawerShell?.nativeElement;
    const bubble = this.bubbleButton?.nativeElement;

    if (immediate) {
      this.isDrawerVisible.set(false);
      if (bubble) gsap.set(bubble, { opacity: 1, scale: 1 });
      if (after) after();
      return;
    }

    if (!shell) {
      this.isDrawerVisible.set(false);
      if (after) after();
      return;
    }

    this.drawerTween = gsap.to(shell, {
      y: 14,
      opacity: 0,
      scale: 0.995,
      duration: 0.18,
      ease: 'power1.in',
      onComplete: () => {
        this.isDrawerVisible.set(false);
        this.drawerTween = null;
        if (bubble) {
          gsap.set(bubble, { opacity: 0, scale: 0.98 });
          this.bubbleTween = gsap.to(bubble, {
            opacity: 1,
            scale: 1,
            duration: 0.16,
            ease: 'power1.out'
          });
        }
        if (after) after();
      }
    });
  }

  trackLogEntry(index: number, entry: ScriptLogEntry): string {
    return `${entry.timestamp}-${entry.source}-${index}`;
  }

  toneDotClass(tone: FooterTone | undefined): string {
    switch (tone) {
      case 'pending':
        return 'bg-blue-400 animate-pulse';
      case 'success':
        return 'bg-emerald-400';
      case 'warning':
        return 'bg-amber-400';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-zinc-500';
    }
  }

  ngOnInit() {
    void this.syncMockServerStatus();
  }

  ngOnDestroy() {}

  async syncMockServerStatus() {
    await this.mockServer.syncStatus();
    const current = this.mockServer.status();
    if (current.port) {
      this.mockPort.set(current.port);
    }
    if (current.dbPath) {
      this.mockDB.set(current.dbPath);
    }
  }

  async startMockServer() {
    const files = this.ws.files();
    const idx = this.ws.currentFileIndex();
    const file = files[idx];
    if (!file) return;

    const port = Number(this.mockPort()) || 8080;
    try {
      await this.mockServer.start(
        file.content,
        file.filePath || file.name,
        port,
        this.mockDB()
      );
    } catch (err) {
      // Handled inside service
    }
  }

  async stopMockServer() {
    try {
      await this.mockServer.stop();
    } catch (err) {
      // Handled inside service
    }
  }

  clearMockLogs() {
    this.mockServer.clearLogs();
  }

  insertMockTemplate() {
    const files = this.ws.files();
    const idx = this.ws.currentFileIndex();
    const file = files[idx];
    if (!file) return;

    const template = `

### Database Initializer
@mockinit
< {
  // Initialize persistent SQLite database schema once during mock server startup
  db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
  console.log("Mock database initialized successfully!");
}

### Get Dynamic User Mock
@mock
GET /users/{{id}}
Content-Type: application/json

{
  "id": "{{id}}",
  "name": "Dynamic User Mock {{id}}",
  "status": "active"
}

### JS-based Stateful SQLite Mock
@mock
POST /db/users
Content-Type: application/json

< {
  try {
    const body = JSON.parse(request.body);
    const res = db.exec("INSERT INTO users (name) VALUES (?)", body.name);
    response.status = 201;
    response.body = { id: res.lastInsertId, name: body.name, stored: true };
  } catch(e) {
    response.status = 400;
    response.body = { error: e.toString() };
  }
}
`;

    const newContent = file.content ? file.content.trim() + '\n' + template : template.trim();
    this.ws.updateFileContent(newContent);
    this.ws.updateRawContent(newContent);
  }

  trackMockLogEntry(index: number, entry: MockServerLogEntry): string {
    return `${entry.timestamp}-${entry.source}-${index}`;
  }

  startResize(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.isResizing.set(true);
    this.startHeight = this.panelHeight();
    this.startY = 'touches' in event ? event.touches[0].clientY : event.clientY;
  }

  @HostListener('document:mousemove', ['$event'])
  @HostListener('document:touchmove', ['$event'])
  onMouseMove(event: MouseEvent | TouchEvent) {
    if (!this.isResizing()) return;
    
    const currentY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    const deltaY = this.startY - currentY; // Negative because dragging up increases height
    const newHeight = Math.min(this.maxHeight, Math.max(this.minHeight, this.startHeight + deltaY));
    this.panelHeight.set(newHeight);
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  onMouseUp() {
    this.isResizing.set(false);
  }
}
