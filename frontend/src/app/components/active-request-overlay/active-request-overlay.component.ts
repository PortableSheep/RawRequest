import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { Request, ActiveRunProgress } from "../../models/http.models";
import { WorkspaceStateService } from "../../services/workspace-state.service";
import { RequestExecutionService } from "../../services/request-execution.service";
import { LoadTestVisualizationService } from "../../services/load-test-visualization.service";

export interface ActiveRequestOverlayInfo {
  id?: string;
  label: string;
  requestIndex: number;
  canCancel: boolean;
  type: "single" | "chain" | "load";
  startedAt: number;
  processedUrl?: string;
}

export interface LoadTestVizData {
  loadUsersSparklinePathDView: string;
  loadUsersSparklineTransformView: string;
  loadRpsSparklinePathDView: string;
  loadRpsSparklineTransformView: string;
  currentLoadRpsView: number;
}

@Component({
  selector: "app-active-request-overlay",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./active-request-overlay.component.html",
  styleUrls: ["./active-request-overlay.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveRequestOverlayComponent {
  private readonly ws = inject(WorkspaceStateService);
  readonly reqExec = inject(RequestExecutionService);
  readonly loadTestViz = inject(LoadTestVisualizationService);

  get activeRequestInfo() { return this.reqExec.activeRequestInfo; }
  get isCancelling() { return this.reqExec.isCancellingActiveRequest; }
  get activeRunProgress() { return this.loadTestViz.activeRunProgress; }

  get activeRequest(): Request | null {
    const info = this.reqExec.activeRequestInfo;
    if (!info) return null;
    const file = this.ws.getCurrentFile();
    return file.requests[info.requestIndex] ?? null;
  }

  get meta(): string {
    return this.reqExec.getActiveRequestMeta(this.ws.getCurrentFile());
  }

  get preview(): string {
    return this.reqExec.getActiveRequestPreview(this.ws.getCurrentFile());
  }

  async cancelRequest(): Promise<void> {
    await this.reqExec.cancelActiveRequest();
  }
}
