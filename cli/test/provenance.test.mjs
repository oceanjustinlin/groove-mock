import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../record-mockup.mjs', import.meta.url));
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMMq5jFwMDAxAAGABDGAWwoLzFNAAAAAElFTkSuQmCC';

async function run(t, command, {strict = true, registered = false} = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'groove-provenance-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const spec = {images: {front: pixel}, output: {width: 256, height: 256}};
  if (registered) spec.meta = {assets: {front: {source: 'generated'}}};
  const file = path.join(dir, 'spec.json'), out = path.join(dir, 'render.png');
  const batchDir = path.join(dir, 'batch');
  await writeFile(file, JSON.stringify(spec));
  const args = [cli, command, file, '--json'];
  if (strict) args.push('--strict');
  if (process.env.GROOVE_TEST_BROWSER) args.push('--browser', process.env.GROOVE_TEST_BROWSER);
  args.push(...(command === 'numbers' ? ['--from', '1', '--to', '1', '--dir', batchDir] : ['-o', out]));
  const result = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 60000});
  assert.ifError(result.error);
  assert.ok(result.stdout.trim(), result.stderr);
  return {...result, json: JSON.parse(result.stdout), out, batchDir};
}

for (const command of ['render', 'numbers']) {
  test(`${command} --strict rejects missing provenance before writing output`, async t => {
    const r = await run(t, command);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.json.ok, false);
    assert.match(r.json.warnings.join('\n'), /meta.assets.*front/);
    await assert.rejects(access(command === 'numbers' ? r.batchDir : r.out), {code: 'ENOENT'});
  });

  test(`${command} --strict permits registered artwork`, async t => {
    const r = await run(t, command, {registered: true});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.warnings, []);
    assert.equal(r.json.assets.front, 'generated');
    await access(command === 'numbers' ? r.json.files[0] : r.out);
  });

  test(`${command} without --strict reports missing provenance and writes output`, async t => {
    const r = await run(t, command, {strict: false});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.assets.front, 'unregistered');
    assert.match(r.json.warnings.join('\n'), /meta.assets.*front/);
    await access(command === 'numbers' ? r.json.files[0] : r.out);
  });
}
