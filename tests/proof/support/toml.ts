import { execFileSync } from 'node:child_process';

// Parse a TOML file in an independent process (python tomllib) and return it
// as a plain object. Used to read the app-written config.toml from disk
// without trusting the app's own report.
export function parseTomlFile(path: string): Record<string, unknown> {
  const json = execFileSync(
    'python3',
    ['-c', 'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', path],
    { encoding: 'utf-8' },
  );
  return JSON.parse(json) as Record<string, unknown>;
}
