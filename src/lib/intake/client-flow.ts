/**
 * Pure client-flow rules shared by the intake UI and its regression tests.
 * No browser, React or server-only dependency.
 */

export function mergeAutosaveConflict<T extends {
  lockVersion: number;
  dirty: boolean;
}>(localDraft: T, serverLockVersion: number): T {
  return {
    ...localDraft,
    lockVersion: serverLockVersion,
    dirty: true,
  };
}

export function autosaveRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 16000);
}

export function photoPollingDelay(hidden: boolean): number {
  return hidden ? 12000 : 3000;
}

export function canSubmitCandidateFinal(input: {
  everyAnswerValid: boolean;
  contactValid: boolean;
  photoConfirmed: boolean;
}): boolean {
  return input.everyAnswerValid && input.contactValid && input.photoConfirmed;
}
