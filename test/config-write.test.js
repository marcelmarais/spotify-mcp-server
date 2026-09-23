import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeFileAtomic } from '../build/utils.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('writing through a symlink updates the target and keeps the link', (t) => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'real'));
  const target = path.join(dir, 'real', 'config.json');
  const link = path.join(dir, 'config.json');
  fs.writeFileSync(target, 'old');
  fs.symlinkSync(target, link);

  writeFileAtomic(link, 'new');

  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readlinkSync(link), target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'new');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['config.json', 'real']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'real')), ['config.json']);
});

test('existing permissions survive a restrictive umask', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, 'old');
  fs.chmodSync(file, 0o644);
  const previous = process.umask(0o077);
  t.after(() => process.umask(previous));

  writeFileAtomic(file, 'new');

  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('a new file is created owner-only', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');

  writeFileAtomic(file, 'new');

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('a failed rename leaves the original file and no temp file', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, 'old');
  t.mock.method(fs, 'renameSync', () => {
    throw new Error('rename failed');
  });

  assert.throws(() => writeFileAtomic(file, 'new'), /rename failed/);

  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});

test('a dangling symlink is refused and left in place', (t) => {
  const dir = tempDir(t);
  const target = path.join(dir, 'missing', 'config.json');
  const link = path.join(dir, 'config.json');
  fs.symlinkSync(target, link);

  assert.throws(() => writeFileAtomic(link, 'new'), /dangling symbolic link/);

  assert.equal(fs.readlinkSync(link), target);
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});

test('an existing file at the temp path is never removed', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, 'old');
  t.mock.method(crypto, 'randomBytes', (size) => Buffer.alloc(size));
  const clash = `${file}.${process.pid}.000000000000.tmp`;
  fs.writeFileSync(clash, 'someone else');

  assert.throws(() => writeFileAtomic(file, 'new'), { code: 'EEXIST' });

  assert.equal(fs.readFileSync(clash, 'utf8'), 'someone else');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
});

test('a failure opening the temp file never removes an existing one', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, 'old');
  t.mock.method(crypto, 'randomBytes', (size) => Buffer.alloc(size));
  const clash = `${file}.${process.pid}.000000000000.tmp`;
  fs.writeFileSync(clash, 'someone else');
  t.mock.method(fs, 'openSync', () => {
    throw Object.assign(new Error('too many open files'), { code: 'EMFILE' });
  });

  assert.throws(() => writeFileAtomic(file, 'new'), { code: 'EMFILE' });

  assert.equal(fs.readFileSync(clash, 'utf8'), 'someone else');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
});

test('a partial write removes our temp file', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, 'old');
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (target, data, ...args) => {
    if (typeof target !== 'number') return write(target, data, ...args);
    write(target, data.slice(0, 1), ...args);
    throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
  });

  assert.throws(() => writeFileAtomic(file, 'new'), { code: 'ENOSPC' });

  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});
