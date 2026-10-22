import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../record-mockup.mjs', import.meta.url));

async function render(t, records) {
  const dir = await mkdtemp(path.join(tmpdir(), 'groove-fill-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'spec.json');
  await writeFile(file, JSON.stringify({scene: {mode: 'disc'}, records, output: {width: 320, height: 320}}));
  const args = [cli, 'render', file, '-o', path.join(dir, 'out.png'), '--json'];
  if (process.env.GROOVE_TEST_BROWSER) args.push('--browser', process.env.GROOVE_TEST_BROWSER);
  const result = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 120000});
  assert.ifError(result.error);
  assert.ok(result.stdout.trim(), result.stderr);
  return {...result, json: JSON.parse(result.stdout)};
}

test('a filled disc on a see-through shell renders without warnings', async t => {
  const r = await render(t, {disc1: {vinyl: 'color', transparency: 60, fill: {preset: 'twotone', bubbles: 40}, glitter: {amount: 30}}});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json.warnings, []);
});

test('fill warns about an opaque shell, a bad preset and fields with no fill', async t => {
  const r = await render(t, {disc1: {vinyl: 'color', transparency: 0, fill: {type: 'liquid'}}});
  assert.match(r.json.warnings.join('\n'), /transparency=0/);
  const bad = await render(t, {disc1: {vinyl: 'color', transparency: 50, fill: {preset: 'bogus', amount: 30}}});
  const w = bad.json.warnings.join('\n');
  assert.match(w, /fill\.preset="bogus"/);
  assert.match(w, /fill\.type=none，records\.disc1\.fill\.amount 不生效/);
});

test('black vinyl ignores fill and glitter', async t => {
  const r = await render(t, {disc1: {vinyl: 'black', fill: {preset: 'sand'}, glitter: {amount: 20}}});
  assert.match(r.json.warnings.join('\n'), /records\.disc1\.fill、records\.disc1\.glitter 无效/);
});
