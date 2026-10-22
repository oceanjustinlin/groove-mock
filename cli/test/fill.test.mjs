import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../record-mockup.mjs', import.meta.url));
const run = args => {
  if (process.env.GROOVE_TEST_BROWSER) args.push('--browser', process.env.GROOVE_TEST_BROWSER);
  const result = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 120000});
  assert.ifError(result.error);
  assert.ok(result.stdout.trim(), result.stderr);
  return result;
};

async function render(t, records) {
  const dir = await mkdtemp(path.join(tmpdir(), 'groove-fill-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'spec.json');
  await writeFile(file, JSON.stringify({scene: {mode: 'disc'}, records, output: {width: 320, height: 320}}));
  const result = run(['render', file, '-o', path.join(dir, 'out.png'), '--json']);
  return {...result, json: JSON.parse(result.stdout)};
}

test('liquid, sand and glitter are patterns', () => {
  const schema = JSON.parse(run(['schema']).stdout);
  const disc = schema.properties.records.properties.disc1.properties;
  for (const id of ['liquid-01', 'liquid-05', 'sand-01', 'glitter-02']) assert.ok(disc.pattern.properties.id.enum.includes(id), id);
  assert.equal(disc.fill, undefined);
  assert.equal(disc.glitter, undefined);
});

test('a liquid pattern is tonal: one colour and a contrast, without warnings', async t => {
  const r = await render(t, {disc1: {vinyl: 'color', color: '#2fae5a', pattern: {id: 'liquid-02', contrast: 150}}});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json.warnings, []);
  const c = await render(t, {disc1: {vinyl: 'color', pattern: {id: 'liquid-01', color: '#ffffff'}}});
  assert.match(c.json.warnings.join('\n'), /pattern\.color 无效/);
});

test('liquid and sand have no transparency to set', async t => {
  const r = await render(t, {disc1: {vinyl: 'color', transparency: 40, pattern: {id: 'sand-01', transparency: 20}}});
  const w = r.json.warnings.join('\n');
  assert.match(w, /records\.disc1\.transparency 无效/);
  assert.match(w, /records\.disc1\.pattern\.transparency 无效/);
});

test('black vinyl ignores a liquid pattern', async t => {
  const r = await render(t, {disc1: {vinyl: 'black', pattern: {id: 'liquid-01'}}});
  assert.match(r.json.warnings.join('\n'), /records\.disc1\.pattern 无效/);
});
