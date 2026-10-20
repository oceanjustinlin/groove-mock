import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../record-mockup.mjs', import.meta.url));

async function video(t, out, animation, extra = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'groove-video-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'spec.json');
  await writeFile(file, JSON.stringify({animation: {duration: 1, fps: 10, size: 240, ...animation}, output: {background: '#ebe8e1'}}));
  const args = [cli, 'video', file, '-o', path.join(dir, out), '--json', ...extra];
  if (process.env.GROOVE_TEST_BROWSER) args.push('--browser', process.env.GROOVE_TEST_BROWSER);
  const result = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 120000});
  assert.ifError(result.error);
  assert.ok(result.stdout.trim(), result.stderr);
  return {...result, json: JSON.parse(result.stdout), out: path.join(dir, out)};
}

test('video writes a 16:9 turntable MP4', async t => {
  const r = await video(t, 'turn.mp4', {preset: 'turntable'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual([r.json.format, r.json.width, r.json.height, r.json.frames, r.json.duration], ['mp4', 426, 240, 10, 1]);
  assert.equal((await readFile(r.out)).subarray(4, 8).toString(), 'ftyp');
});

test('video writes a square swing GIF', async t => {
  const r = await video(t, 'swing.gif', {preset: 'swing', aspect: '1:1'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual([r.json.format, r.json.width, r.json.height, r.json.frames], ['gif', 240, 240, 10]);
  assert.equal((await readFile(r.out)).subarray(0, 6).toString(), 'GIF89a');
});

test('video --strict rejects an invalid animation field before writing', async t => {
  const r = await video(t, 'bad.mp4', {aspect: '4:3'}, ['--strict']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.json.warnings.join('\n'), /animation.aspect/);
  await assert.rejects(access(r.out), {code: 'ENOENT'});
});

test('video refuses an unknown output extension', async t => {
  const r = await video(t, 'clip.mov', {});
  assert.equal(r.status, 1);
  assert.match(r.json.error, /\.mp4 或 \.gif/);
});

test('video warns when a gatefold animation has no gatefold to open', async t => {
  const r = await video(t, 'open.mp4', {preset: 'gatefold', duration: 1});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.json.warnings.join('\n'), /gatefold/);
});
