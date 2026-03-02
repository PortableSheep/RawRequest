import { NgZone } from '@angular/core';
import { KeyboardShortcutService, ShortcutRegistration } from './keyboard-shortcut.service';

function makeKeyboardEvent(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  jest.spyOn(event, 'preventDefault');
  jest.spyOn(event, 'stopPropagation');
  return event;
}

function createService(): KeyboardShortcutService {
  const fakeZone = {
    runOutsideAngular: (fn: () => void) => fn(),
    run: (fn: () => void) => fn(),
  } as unknown as NgZone;
  // Construct manually with fake NgZone injected via Object.defineProperty
  const svc = Object.create(KeyboardShortcutService.prototype);
  (svc as any).ngZone = fakeZone;
  (svc as any).registrations = new Map();
  (svc as any).listener = (event: KeyboardEvent) => svc.handleKeydown(event);
  (svc as any).attached = false;
  return svc;
}

describe('KeyboardShortcutService', () => {
  let service: KeyboardShortcutService;

  beforeEach(() => {
    service = createService();
  });

  afterEach(() => {
    if (service) {
      service.ngOnDestroy();
    }
  });

  it('should call action when key combo matches with metaKey', () => {
    const action = jest.fn();
    service.register({ id: 'save', combo: { key: 's', ctrl: true }, action });

    const event = makeKeyboardEvent({ key: 's', metaKey: true });
    service.handleKeydown(event);

    expect(action).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('should call action when key combo matches with ctrlKey', () => {
    const action = jest.fn();
    service.register({ id: 'save', combo: { key: 's', ctrl: true }, action });

    const event = makeKeyboardEvent({ key: 's', ctrlKey: true });
    service.handleKeydown(event);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should not call action when modifier does not match', () => {
    const action = jest.fn();
    service.register({ id: 'save', combo: { key: 's', ctrl: true }, action });

    const event = makeKeyboardEvent({ key: 's' });
    service.handleKeydown(event);

    expect(action).not.toHaveBeenCalled();
  });

  it('should not call action when key does not match', () => {
    const action = jest.fn();
    service.register({ id: 'save', combo: { key: 's', ctrl: true }, action });

    const event = makeKeyboardEvent({ key: 'p', ctrlKey: true });
    service.handleKeydown(event);

    expect(action).not.toHaveBeenCalled();
  });

  it('should match shift+ctrl combos', () => {
    const action = jest.fn();
    service.register({ id: 'saveAs', combo: { key: 's', ctrl: true, shift: true }, action });

    const event = makeKeyboardEvent({ key: 's', metaKey: true, shiftKey: true });
    service.handleKeydown(event);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should not trigger shift combo when shift is not pressed', () => {
    const action = jest.fn();
    service.register({ id: 'saveAs', combo: { key: 's', ctrl: true, shift: true }, action });

    const event = makeKeyboardEvent({ key: 's', metaKey: true });
    service.handleKeydown(event);

    expect(action).not.toHaveBeenCalled();
  });

  it('should match key without modifiers (e.g. Escape)', () => {
    const action = jest.fn();
    service.register({ id: 'escape', combo: { key: 'Escape' }, action });

    const event = makeKeyboardEvent({ key: 'Escape' });
    service.handleKeydown(event);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should not match Escape when ctrl is pressed but not expected', () => {
    const action = jest.fn();
    service.register({ id: 'escape', combo: { key: 'Escape' }, action });

    const event = makeKeyboardEvent({ key: 'Escape', ctrlKey: true });
    service.handleKeydown(event);

    expect(action).not.toHaveBeenCalled();
  });

  it('should match case-insensitively', () => {
    const action = jest.fn();
    service.register({ id: 'save', combo: { key: 's', ctrl: true }, action });

    const event = makeKeyboardEvent({ key: 'S', metaKey: true });
    service.handleKeydown(event);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should prefer higher priority registration when multiple match', () => {
    const lowAction = jest.fn();
    const highAction = jest.fn();
    service.register({ id: 'low', combo: { key: 'Escape' }, action: lowAction, priority: 0 });
    service.register({ id: 'high', combo: { key: 'Escape' }, action: highAction, priority: 10 });

    const event = makeKeyboardEvent({ key: 'Escape' });
    service.handleKeydown(event);

    expect(lowAction).not.toHaveBeenCalled();
    expect(highAction).toHaveBeenCalledTimes(1);
  });

  it('should use default priority of 0', () => {
    const firstAction = jest.fn();
    const highAction = jest.fn();
    service.register({ id: 'first', combo: { key: 'Escape' }, action: firstAction });
    service.register({ id: 'high', combo: { key: 'Escape' }, action: highAction, priority: 1 });

    const event = makeKeyboardEvent({ key: 'Escape' });
    service.handleKeydown(event);

    expect(firstAction).not.toHaveBeenCalled();
    expect(highAction).toHaveBeenCalledTimes(1);
  });

  it('should allow unregistering a shortcut', () => {
    const action = jest.fn();
    service.register({ id: 'save', combo: { key: 's', ctrl: true }, action });
    service.unregister('save');

    const event = makeKeyboardEvent({ key: 's', metaKey: true });
    service.handleKeydown(event);

    expect(action).not.toHaveBeenCalled();
  });

  it('should support registerMany', () => {
    const saveAction = jest.fn();
    const paletteAction = jest.fn();
    service.registerMany([
      { id: 'save', combo: { key: 's', ctrl: true }, action: saveAction },
      { id: 'palette', combo: { key: 'p', ctrl: true }, action: paletteAction },
    ]);

    service.handleKeydown(makeKeyboardEvent({ key: 's', ctrlKey: true }));
    service.handleKeydown(makeKeyboardEvent({ key: 'p', ctrlKey: true }));

    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(paletteAction).toHaveBeenCalledTimes(1);
  });

  it('should support unregisterMany', () => {
    const saveAction = jest.fn();
    const paletteAction = jest.fn();
    service.registerMany([
      { id: 'save', combo: { key: 's', ctrl: true }, action: saveAction },
      { id: 'palette', combo: { key: 'p', ctrl: true }, action: paletteAction },
    ]);
    service.unregisterMany(['save', 'palette']);

    service.handleKeydown(makeKeyboardEvent({ key: 's', ctrlKey: true }));
    service.handleKeydown(makeKeyboardEvent({ key: 'p', ctrlKey: true }));

    expect(saveAction).not.toHaveBeenCalled();
    expect(paletteAction).not.toHaveBeenCalled();
  });

  it('should not preventDefault when combo sets preventDefault to false', () => {
    const action = jest.fn();
    service.register({ id: 'noPD', combo: { key: 'a', ctrl: true, preventDefault: false }, action });

    const event = makeKeyboardEvent({ key: 'a', ctrlKey: true });
    service.handleKeydown(event);

    expect(action).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('should not stopPropagation when combo sets stopPropagation to false', () => {
    const action = jest.fn();
    service.register({ id: 'noSP', combo: { key: 'a', ctrl: true, stopPropagation: false }, action });

    const event = makeKeyboardEvent({ key: 'a', ctrlKey: true });
    service.handleKeydown(event);

    expect(action).toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('should do nothing when no shortcuts match', () => {
    const event = makeKeyboardEvent({ key: 'z', ctrlKey: true });
    service.handleKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('should replace a registration with the same id', () => {
    const first = jest.fn();
    const second = jest.fn();
    service.register({ id: 'esc', combo: { key: 'Escape' }, action: first });
    service.register({ id: 'esc', combo: { key: 'Escape' }, action: second });

    service.handleKeydown(makeKeyboardEvent({ key: 'Escape' }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('should match alt modifier correctly', () => {
    const action = jest.fn();
    service.register({ id: 'alt-a', combo: { key: 'a', alt: true }, action });

    service.handleKeydown(makeKeyboardEvent({ key: 'a', altKey: true }));
    expect(action).toHaveBeenCalledTimes(1);

    service.handleKeydown(makeKeyboardEvent({ key: 'a' }));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
