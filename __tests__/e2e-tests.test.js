const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const caseDirPath = path.join(__dirname, 'e2e-cases');
const allCases = fs.readdirSync(caseDirPath);

for (const caseName of allCases) {
  const caseData = fs.readFileSync(path.join(caseDirPath, caseName));
  const caseSpec = yaml.safeLoad(caseData, 'utf8');
  test(`${caseSpec.title} [${path.basename(caseName, '.yaml')}]`, () => {

    expect(caseSpec.stdout).toBe("");
  });
}
