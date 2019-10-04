const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const build = require('../build');

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

        const filesystem = new Map();
        for (const key of Object.keys(caseSpec.files)) {
          const code = caseSpec.files[key];
          filesystem.set(key, code);
        }

        let js_code = "";
        const write = str => { js_code += str; };
        try {
          build(filesystem, write, true);
        } catch (ex) {
          if (!caseSpec.fail) {
            throw ex;
          }
          return;
        }

        expect(caseSpec.fail).toBeUndefined();

        // let result = child_process.spawnSync(
        //   path.join(__dirname, '../cli.js'),
        //   ['-i'],
        //   {
        //     input: JSON.stringify(caseSpec.files),
        //     stdio: 'pipe',
        //     encoding: 'utf8',
        //   },
        // );
        // if (caseSpec.fail) {
        //   expect(result.status).not.toBe(0);
        //   return;
        // }

        // expect(result.stderr).toBe('');
        // expect(result.status).toBe(0);
        // expect(result.signal).toBe(null);
        // expect(result.error).toBeUndefined();

        const result = child_process.spawnSync(process.execPath, [], {
          input: js_code,
          stdio: 'pipe',
          encoding: 'utf8',
        });

        if (caseSpec.error_code != null) {
          expect(result.status).toBe(caseSpec.error_code);
          return;
        }
        if (result.stderr != '') {
          console.error(js_code);
        }

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.signal).toBe(null);
        expect(result.error).toBeUndefined();
        expect(result.stdout).toBe(caseSpec.stdout);
      });
    }
  });
}
