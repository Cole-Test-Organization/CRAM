// Process-global abort signal for the in-flight provisioning job. Mirrors the
// secretSource overlay pattern: the job worker installs an AbortSignal for the
// duration of a single job (jobs are serialized — one running job per worker
// process), and the command runner (runCommand/captureCommand) consults it to
// terminate the spawned terraform child when a user requests cancellation.
//
// Dependency-free on purpose so utils/ can consult it without an import cycle.

let signal: AbortSignal | null = null;

export function installJobSignal(next: AbortSignal): void {
  signal = next;
}

export function clearJobSignal(): void {
  signal = null;
}

export function currentJobSignal(): AbortSignal | null {
  return signal;
}
