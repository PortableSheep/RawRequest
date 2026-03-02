import { TestBed } from '@angular/core/testing';
import { PanelVisibilityService } from './panel-visibility.service';

describe('PanelVisibilityService', () => {
  let service: PanelVisibilityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PanelVisibilityService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have all panels closed', () => {
      expect(service.showHistory()).toBe(false);
      expect(service.showHistoryModal()).toBe(false);
      expect(service.showOutlinePanel()).toBe(false);
      expect(service.showCommandPalette()).toBe(false);
      expect(service.showLoadTestResults()).toBe(false);
      expect(service.showDonationModal()).toBe(false);
      expect(service.showSecretsModal()).toBe(false);
      expect(service.showSnippetModal()).toBe(false);
      expect(service.showDeleteConfirmModal()).toBe(false);
      expect(service.consoleOpen()).toBe(false);
    });

    it('should report noSidebarOpen as true', () => {
      expect(service.noSidebarOpen()).toBe(true);
    });
  });

  describe('toggleHistory', () => {
    it('should open history and close other surfaces', () => {
      service.showOutlinePanel.set(true);
      service.consoleOpen.set(true);

      service.toggleHistory();

      expect(service.showHistory()).toBe(true);
      expect(service.showOutlinePanel()).toBe(false);
      expect(service.consoleOpen()).toBe(false);
    });

    it('should close history when already open', () => {
      service.showHistory.set(true);

      service.toggleHistory();

      expect(service.showHistory()).toBe(false);
    });

    it('should close all surfaces when toggling off', () => {
      service.showHistory.set(true);
      service.showOutlinePanel.set(true);

      service.toggleHistory();

      expect(service.showHistory()).toBe(false);
      expect(service.showOutlinePanel()).toBe(false);
    });
  });

  describe('toggleOutlinePanel', () => {
    it('should open outline and close other surfaces', () => {
      service.showHistory.set(true);
      service.consoleOpen.set(true);

      service.toggleOutlinePanel();

      expect(service.showOutlinePanel()).toBe(true);
      expect(service.showHistory()).toBe(false);
      expect(service.consoleOpen()).toBe(false);
    });

    it('should close outline when already open', () => {
      service.showOutlinePanel.set(true);

      service.toggleOutlinePanel();

      expect(service.showOutlinePanel()).toBe(false);
    });
  });

  describe('toggleCommandPalette', () => {
    it('should open command palette and close other surfaces', () => {
      service.showHistory.set(true);
      service.showSecretsModal.set(true);

      service.toggleCommandPalette();

      expect(service.showCommandPalette()).toBe(true);
      expect(service.showHistory()).toBe(false);
      expect(service.showSecretsModal()).toBe(false);
    });

    it('should close command palette when already open', () => {
      service.showCommandPalette.set(true);

      service.toggleCommandPalette();

      expect(service.showCommandPalette()).toBe(false);
    });
  });

  describe('toggleConsole', () => {
    it('should open console and close other surfaces', () => {
      service.showHistory.set(true);
      service.showOutlinePanel.set(true);

      service.toggleConsole();

      expect(service.consoleOpen()).toBe(true);
      expect(service.showHistory()).toBe(false);
      expect(service.showOutlinePanel()).toBe(false);
    });

    it('should close console when already open', () => {
      service.consoleOpen.set(true);

      service.toggleConsole();

      expect(service.consoleOpen()).toBe(false);
    });

    it('should force open and close other surfaces', () => {
      service.showHistory.set(true);

      service.toggleConsole(true);

      expect(service.consoleOpen()).toBe(true);
      expect(service.showHistory()).toBe(false);
    });

    it('should force close without affecting other surfaces', () => {
      service.consoleOpen.set(true);
      service.showHistory.set(true);

      service.toggleConsole(false);

      expect(service.consoleOpen()).toBe(false);
      expect(service.showHistory()).toBe(true);
    });
  });

  describe('openSecretsModal', () => {
    it('should open secrets and close other surfaces', () => {
      service.showHistory.set(true);
      service.consoleOpen.set(true);
      service.showOutlinePanel.set(true);

      service.openSecretsModal();

      expect(service.showSecretsModal()).toBe(true);
      expect(service.showHistory()).toBe(false);
      expect(service.consoleOpen()).toBe(false);
      expect(service.showOutlinePanel()).toBe(false);
    });
  });

  describe('closeHistoryModal', () => {
    it('should close history modal', () => {
      service.showHistoryModal.set(true);

      service.closeHistoryModal();

      expect(service.showHistoryModal()).toBe(false);
    });
  });

  describe('closeLoadTestResults', () => {
    it('should close load test results', () => {
      service.showLoadTestResults.set(true);

      service.closeLoadTestResults();

      expect(service.showLoadTestResults()).toBe(false);
    });
  });

  describe('closeSecondarySurfaces', () => {
    it('should close all surfaces when no keepOpen specified', () => {
      service.showHistory.set(true);
      service.showOutlinePanel.set(true);
      service.showCommandPalette.set(true);
      service.consoleOpen.set(true);
      service.showSecretsModal.set(true);

      service.closeSecondarySurfaces();

      expect(service.showHistory()).toBe(false);
      expect(service.showOutlinePanel()).toBe(false);
      expect(service.showCommandPalette()).toBe(false);
      expect(service.consoleOpen()).toBe(false);
      expect(service.showSecretsModal()).toBe(false);
    });

    it('should keep history open when specified', () => {
      service.showHistory.set(true);
      service.showOutlinePanel.set(true);
      service.consoleOpen.set(true);

      service.closeSecondarySurfaces('history');

      expect(service.showHistory()).toBe(true);
      expect(service.showOutlinePanel()).toBe(false);
      expect(service.consoleOpen()).toBe(false);
    });

    it('should keep console open when specified', () => {
      service.showHistory.set(true);
      service.consoleOpen.set(true);

      service.closeSecondarySurfaces('console');

      expect(service.showHistory()).toBe(false);
      expect(service.consoleOpen()).toBe(true);
    });

    it('should keep secrets open when specified', () => {
      service.showSecretsModal.set(true);
      service.showHistory.set(true);

      service.closeSecondarySurfaces('secrets');

      expect(service.showSecretsModal()).toBe(true);
      expect(service.showHistory()).toBe(false);
    });
  });

  describe('noSidebarOpen', () => {
    it('should be false when history is open', () => {
      service.showHistory.set(true);
      expect(service.noSidebarOpen()).toBe(false);
    });

    it('should be false when outline is open', () => {
      service.showOutlinePanel.set(true);
      expect(service.noSidebarOpen()).toBe(false);
    });

    it('should be false when command palette is open', () => {
      service.showCommandPalette.set(true);
      expect(service.noSidebarOpen()).toBe(false);
    });

    it('should be false when secrets modal is open', () => {
      service.showSecretsModal.set(true);
      expect(service.noSidebarOpen()).toBe(false);
    });

    it('should be true when console is open but no sidebar', () => {
      service.consoleOpen.set(true);
      expect(service.noSidebarOpen()).toBe(true);
    });
  });

  describe('exclusive toggle behavior', () => {
    it('should only have one sidebar open at a time', () => {
      service.toggleHistory();
      expect(service.showHistory()).toBe(true);

      service.toggleOutlinePanel();
      expect(service.showHistory()).toBe(false);
      expect(service.showOutlinePanel()).toBe(true);

      service.toggleCommandPalette();
      expect(service.showOutlinePanel()).toBe(false);
      expect(service.showCommandPalette()).toBe(true);

      service.openSecretsModal();
      expect(service.showCommandPalette()).toBe(false);
      expect(service.showSecretsModal()).toBe(true);
    });

    it('should close console when opening a sidebar', () => {
      service.toggleConsole();
      expect(service.consoleOpen()).toBe(true);

      service.toggleHistory();
      expect(service.consoleOpen()).toBe(false);
      expect(service.showHistory()).toBe(true);
    });

    it('should close sidebars when opening console', () => {
      service.toggleHistory();
      expect(service.showHistory()).toBe(true);

      service.toggleConsole();
      expect(service.showHistory()).toBe(false);
      expect(service.consoleOpen()).toBe(true);
    });
  });
});
