import { TestBed } from "@angular/core/testing";
import { EditorComponent } from "./editor.component";

describe("EditorComponent busy scrim", () => {
  function create(isBusy: boolean) {
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.componentRef.setInput("fileId", "f1");
    fixture.componentRef.setInput("content", "GET https://example.com\n");
    fixture.componentRef.setInput("requests", []);
    fixture.componentRef.setInput("isBusy", isBusy);
    fixture.detectChanges();
    return fixture;
  }

  it("shows a locked scrim while a request is running", () => {
    const el: HTMLElement = create(true).nativeElement;
    const scrim = el.querySelector('[data-testid="editor-busy-scrim"]');
    expect(scrim).toBeTruthy();
    expect(scrim?.querySelector('[role="status"]')?.textContent).toContain("editor locked");
  });

  it("hides the scrim when idle", () => {
    const el: HTMLElement = create(false).nativeElement;
    expect(el.querySelector('[data-testid="editor-busy-scrim"]')).toBeNull();
  });
});
