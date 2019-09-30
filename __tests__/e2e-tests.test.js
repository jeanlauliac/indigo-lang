const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const caseDirPath = path.join(__dirname, 'e2e-cases');
const allGroups = fs.readdirSync(caseDirPath);

for (const groupName of allGroups) {
  describe(groupName, () => {
    const groupData = fs.readFileSync(path.join(caseDirPath, groupName));
    const groupSpec = yaml.safeLoad(groupData, 'utf8');
    for (const caseTitle of Object.keys(groupSpec)) {
      const caseSpec = groupSpec[caseTitle];
      let testFunc = test;
      if (caseSpec.only) {
        testFunc = test.only;
      } else if (caseSpec.skip) {
        testFunc = test.skip;
      }
      testFunc(`${caseTitle}`, () => {
        let result = child_process.spawnSync(
          path.join(__dirname, '../cli.js'),
          ['-i'],
          {
            input: JSON.stringify(caseSpec.files),
            stdio: 'pipe',
            encoding: 'utf8',
          },
        );
        if (caseSpec.fail) {
          expect(result.status).not.toBe(0);
          return;
        }

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
  });
}
