import { ChangeDetectorRef } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import {
  ActiveRequestOverlayComponent,
  ActiveRequestOverlayInfo,
} from "./active-request-overlay.component";
import { WorkspaceStateService } from "../../services/workspace-state.service";
import { RequestExecutionService } from "../../services/request-execution.service";
import { LoadTestVisualizationService } from "../../services/load-test-visualization.service";

describe("ActiveRequestOverlayComponent", () => {
  let component: ActiveRequestOverlayComponent;
  let fixture: ComponentFixture<ActiveRequestOverlayComponent>;
  let mockReqExec: any;
  let mockWs: any;
  let mockLoadTestViz: any;

  const defaultInfo: ActiveRequestOverlayInfo = {
    id: "req-1",
    label: "Test Request",
    requestIndex: 0,
    canCancel: true,
    type: "single",
    startedAt: Date.now(),
  };

  beforeEach(async () => {
    mockWs = {
      getCurrentFile: jest.fn().mockReturnValue({ requests: [{ method: "GET", url: "https://example.com", headers: {}, name: "Test" }], responseData: {} }),
    };
    mockReqExec = {
      activeRequestInfo: defaultInfo,
      isCancellingActiveRequest: false,
      getActiveRequestDetails: jest.fn().mockReturnValue(null),
      getActiveRequestMeta: jest.fn().mockReturnValue(""),
      getActiveRequestPreview: jest.fn().mockReturnValue(""),
      cancelActiveRequest: jest.fn().mockResolvedValue(undefined),
    };
    mockLoadTestViz = {
      activeRunProgress: null,
      loadUsersSparklinePathDView: "",
      loadUsersSparklineTransformView: "",
      loadRpsSparklinePathDView: "",
      loadRpsSparklineTransformView: "",
      currentLoadRpsView: 0,
    };

    await TestBed.configureTestingModule({
      imports: [ActiveRequestOverlayComponent],
    })
      .overrideProvider(WorkspaceStateService, { useValue: mockWs })
      .overrideProvider(RequestExecutionService, { useValue: mockReqExec })
      .overrideProvider(LoadTestVisualizationService, { useValue: mockLoadTestViz })
      .compileComponents();

    fixture = TestBed.createComponent(ActiveRequestOverlayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function detectChanges() {
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
  }

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("should display the request label", () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector(".rr-active-card__label")?.textContent?.trim()).toBe(
      "Test Request",
    );
  });

  it("should call cancelActiveRequest when cancel button is clicked", () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector(
      ".rr-btn--danger",
    );
    btn.click();
    expect(mockReqExec.cancelActiveRequest).toHaveBeenCalled();
  });

  it("should disable cancel button when canCancel is false", () => {
    mockReqExec.activeRequestInfo = { ...defaultInfo, canCancel: false };
    detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector(
      ".rr-btn--danger",
    );
    expect(btn.disabled).toBe(true);
  });

  it("should disable cancel button when isCancelling is true", () => {
    mockReqExec.isCancellingActiveRequest = true;
    detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector(
      ".rr-btn--danger",
    );
    expect(btn.disabled).toBe(true);
  });

  it("should show 'Canceling...' text when isCancelling is true", () => {
    mockReqExec.isCancellingActiveRequest = true;
    detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector(
      ".rr-btn--danger",
    );
    expect(btn.textContent?.trim()).toBe("Canceling...");
  });

  it("should show method from activeRequest", () => {
    detectChanges();
    const pill = fixture.nativeElement.querySelector(".rr-pill--method");
    expect(pill?.textContent?.trim()).toBe("GET");
  });

  it("should show load test rows when type is load", () => {
    mockReqExec.activeRequestInfo = { ...defaultInfo, type: "load" };
    detectChanges();
    const rows = fixture.nativeElement.querySelectorAll(".rr-active-row");
    expect(rows.length).toBe(2);
  });

  it("should not show load test rows when type is single", () => {
    mockReqExec.activeRequestInfo = { ...defaultInfo, type: "single" };
    detectChanges();
    const rows = fixture.nativeElement.querySelectorAll(".rr-active-row");
    expect(rows.length).toBe(0);
  });
});
