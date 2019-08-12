const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const caseDirPath = path.join(__dirname, 'e2e-cases');
const allCases = fs.readdirSync(caseDirPath);

for (const caseName of allCases) {
  const caseData = fs.readFileSync(path.join(caseDirPath, caseName));
  const caseSpec = yaml.safeLoad(caseData, 'utf8');
  test(`${caseSpec.title} [${path.basename(caseName, '.yaml')}]`, () => {
    let result = child_process.spawnSync(
      path.join(__dirname, '../clover_comp.js'),
      ['-i'],
      {
        input: JSON.stringify(caseSpec.files),
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.signal).toBe(null);
    expect(result.error).toBeUndefined();

    result = child_process.spawnSync(process.execPath, [], {
      input: result.stdout,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.signal).toBe(null);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe(caseSpec.stdout);
  });
}
