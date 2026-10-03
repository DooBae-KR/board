import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRepos, ensureReposFile } from './repos.js';

const entry = (id) => JSON.stringify([{ id, mediaId: '1', name: id, url: 'https://github.com/o/r' }]);
const dir = () => mkdtempSync(join(tmpdir(), 'repos-'));

test('볼륨 파일이 없으면 기본 파일로 생성, 있으면 덮어쓰지 않음', () => {
  const file = join(dir(), 'sub', 'repos.json');
  process.env.REPOS_FILE = file;
  ensureReposFile();
  assert.ok(existsSync(file));
  assert.ok(Array.isArray(JSON.parse(readFileSync(file, 'utf8'))));
  writeFileSync(file, '[{"id":"mine"}]');
  ensureReposFile();
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))[0].id, 'mine');
  delete process.env.REPOS_FILE;
});

test('파일 수정이 재시작 없이 반영되고, 깨진 JSON이면 마지막 정상본 유지', () => {
  const file = join(dir(), 'repos.json');
  writeFileSync(file, entry('a'));
  assert.equal(loadRepos(file)[0].id, 'a');
  writeFileSync(file, entry('b'));
  assert.equal(loadRepos(file)[0].id, 'b');
  writeFileSync(file, '[{"id":"c"'); // 편집 중 오타
  assert.equal(loadRepos(file)[0].id, 'b');
});
