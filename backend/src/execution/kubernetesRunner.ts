import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function checkKubectlAvailable(): Promise<{ available: boolean; context?: string; error?: string }> {
  try {
    const { stdout } = await execFileAsync('kubectl', ['config', 'current-context'], { timeout: 3000 });
    return { available: true, context: stdout.trim() };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'kubectl command failed' };
  }
}

export async function applyManifests(kubernetesDir: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('kubectl', ['apply', '-f', kubernetesDir, '--recursive'], { timeout: 60_000 });
    return { ok: true, output: stdout + stderr };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteNamespace(namespace: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('kubectl', ['delete', 'namespace', namespace], { timeout: 60_000 });
    return { ok: true, output: stdout + stderr };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
