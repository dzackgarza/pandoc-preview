import { readFileSync } from 'node:fs';

// Per-spec provisioning manifest written by scripts/provision-run.sh. Specs
// read it to learn the hermetic paths the app under test was launched with
// (the temp project, the XDG config home, the config.toml path).

export interface RunManifest {
  runId: string;
  spec: string;
  runDir: string;
  xdgConfigHome: string;
  // The hermetic XDG_DATA_HOME the app under test was launched with. The app
  // resolves its host-filesystem recovery store under an XDG data location
  // (dirs::data_dir() == $XDG_DATA_HOME), so a spec reads the recovery store by
  // searching this per-run tree — never the user's real ~/.local/share (P45).
  xdgDataHome: string;
  configPath: string;
  project: string;
  demoFile: string;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`run manifest field ${key} is missing or not a non-empty string`);
  }
  return value;
}

export function loadRunManifest(): RunManifest {
  const path = process.env.PROOF_RUN_MANIFEST;
  if (path === undefined || path.length === 0) {
    throw new Error(
      'PROOF_RUN_MANIFEST is not set — proof specs only run under scripts/proof-run.sh',
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`run manifest at ${path} is not a JSON object`);
  }
  const raw = parsed as Record<keyof RunManifest, unknown>;
  return {
    runId: requireString(raw.runId, 'runId'),
    spec: requireString(raw.spec, 'spec'),
    runDir: requireString(raw.runDir, 'runDir'),
    xdgConfigHome: requireString(raw.xdgConfigHome, 'xdgConfigHome'),
    xdgDataHome: requireString(raw.xdgDataHome, 'xdgDataHome'),
    configPath: requireString(raw.configPath, 'configPath'),
    project: requireString(raw.project, 'project'),
    demoFile: requireString(raw.demoFile, 'demoFile'),
  };
}
