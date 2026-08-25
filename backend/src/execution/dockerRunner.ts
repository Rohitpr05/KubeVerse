// Execution abstractions for the future playground (KUBEVERSE_MASTER_SPEC.md,
// "Local execution model"). These are real child_process wrappers, not mocks -
// only the availability checks are wired to a route in this milestone; the
// mutating operations are implemented and unit-testable, ready for the
// playground to call, and are intentionally not exposed via any route yet.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function checkDockerAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const { stdout } = await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 3000 });
    return { available: true, version: stdout.trim() };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'docker command failed' };
  }
}

export async function composeUp(projectDockerDir: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['compose', 'up', '-d', '--build'], { cwd: projectDockerDir, timeout: 300_000 });
    return { ok: true, output: stdout + stderr };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function composeDown(projectDockerDir: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['compose', 'down'], { cwd: projectDockerDir, timeout: 60_000 });
    return { ok: true, output: stdout + stderr };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
