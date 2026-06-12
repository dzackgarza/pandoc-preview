import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

// Writes per-spec results into PROOF_RUN_DIR/results.json for
// scripts/proof-run.sh to aggregate into the per-run proof artifact.

interface RecordedTest {
  file: string;
  title: string;
  project: string;
  status: string;
  expectedStatus: string;
  durationMs: number;
  errors: string[];
}

class ProofArtifactReporter implements Reporter {
  private readonly tests: RecordedTest[] = [];
  private runDir = '';

  onBegin(): void {
    const dir = process.env.PROOF_RUN_DIR;
    if (dir === undefined || dir.length === 0) {
      throw new Error('PROOF_RUN_DIR is not set — proofs only run under scripts/proof-run.sh');
    }
    this.runDir = dir;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.tests.push({
      file: test.location.file,
      title: test.title,
      project: test.parent.project()?.name ?? '',
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: result.duration,
      errors: result.errors.map((error) => error.message ?? JSON.stringify(error)),
    });
  }

  onEnd(result: FullResult): void {
    writeFileSync(
      join(this.runDir, 'results.json'),
      `${JSON.stringify({ status: result.status, tests: this.tests }, null, 2)}\n`,
    );
  }
}

export default ProofArtifactReporter;
