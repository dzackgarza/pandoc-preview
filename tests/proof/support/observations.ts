import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Specs record machine-readable observations (byte sizes, decoded pixel
// dimensions, TeX annotations, on-disk TOML values) here; scripts/proof-run.sh
// merges them into the per-run proof artifact.

export interface Observation {
  spec: string;
  name: string;
  value: string | number | boolean;
}

function observationsPath(): string {
  const dir = process.env.PROOF_RUN_DIR;
  if (dir === undefined || dir.length === 0) {
    throw new Error('PROOF_RUN_DIR is not set — proof specs only run under scripts/proof-run.sh');
  }
  return join(dir, 'observations.json');
}

export function recordObservation(observation: Observation): void {
  const path = observationsPath();
  const existing: Observation[] = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf-8')) as Observation[])
    : [];
  existing.push(observation);
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
}
