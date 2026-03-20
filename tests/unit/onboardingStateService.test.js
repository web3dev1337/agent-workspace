const fs = require('fs');
const os = require('os');
const path = require('path');

const { OnboardingStateService } = require('../../server/onboardingStateService');

describe('OnboardingStateService', () => {
  const logger = { warn: jest.fn() };

  beforeEach(() => {
    logger.warn.mockReset();
  });

  test('returns default dependency setup state when no file exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-state-default-'));
    const storePath = path.join(tempDir, 'onboarding-state.json');
    const service = new OnboardingStateService({ logger, storePath });

    expect(service.getDependencySetupState()).toEqual({
      legalAccepted: false,
      completed: false,
      dismissed: false,
      currentStep: 0,
      skippedActionIds: []
    });
  });

  test('persists normalized dependency setup state across instances', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-state-persist-'));
    const storePath = path.join(tempDir, 'onboarding-state.json');
    const service = new OnboardingStateService({ logger, storePath });

    const updated = service.updateDependencySetupState({
      legalAccepted: true,
      completed: true,
      dismissed: false,
      currentStep: '4',
      skippedActionIds: ['install-gh', 'install-gh', '  ', 'install-codex']
    });

    expect(updated).toEqual({
      legalAccepted: true,
      completed: true,
      dismissed: false,
      currentStep: 4,
      skippedActionIds: ['install-gh', 'install-codex']
    });

    const reloaded = new OnboardingStateService({ logger, storePath });
    expect(reloaded.getDependencySetupState()).toEqual(updated);
  });

  test('merges patches without dropping existing dependency setup state', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-state-merge-'));
    const storePath = path.join(tempDir, 'onboarding-state.json');
    const service = new OnboardingStateService({ logger, storePath });

    service.updateDependencySetupState({
      legalAccepted: true,
      completed: true,
      currentStep: 3,
      skippedActionIds: ['install-gh']
    });

    const updated = service.updateDependencySetupState({
      dismissed: true
    });

    expect(updated).toEqual({
      legalAccepted: true,
      completed: true,
      dismissed: true,
      currentStep: 3,
      skippedActionIds: ['install-gh']
    });
  });

  test('normalizes legal acceptance to false when persisted value is invalid', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-state-legal-'));
    const storePath = path.join(tempDir, 'onboarding-state.json');
    fs.writeFileSync(storePath, JSON.stringify({
      dependencySetup: {
        legalAccepted: 'yes',
        completed: true,
        dismissed: false,
        currentStep: 2,
        skippedActionIds: []
      }
    }));

    const service = new OnboardingStateService({ logger, storePath });

    expect(service.getDependencySetupState()).toEqual({
      legalAccepted: false,
      completed: true,
      dismissed: false,
      currentStep: 2,
      skippedActionIds: []
    });
  });
});
