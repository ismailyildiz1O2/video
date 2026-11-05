// Electron gerektirmeyen hızlı testler: proje yardımcıları.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject, listProjects, listMedia, isInside, appendChat, readChat, writeMeta, readMeta } from '../src/main/projects.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cinecode-test-'));
try {
  const a = await createProject(root, 'Posta Treni: Kış');
  assert.equal(path.basename(a.dir), 'posta-treni-kis');
  const b = await createProject(root, 'Posta Treni: Kış');
  assert.equal(path.basename(b.dir), 'posta-treni-kis-2');

  const list = await listProjects(root);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Posta Treni: Kış');

  assert.ok(isInside(root, a.dir));
  assert.ok(!isInside(root, path.join(root, '..', 'etc')));
  assert.ok(!isInside(a.dir, b.dir));

  fs.mkdirSync(path.join(a.dir, 'out'));
  fs.writeFileSync(path.join(a.dir, 'out', 'draft.mp4'), 'x');
  fs.mkdirSync(path.join(a.dir, 'frames'));
  fs.writeFileSync(path.join(a.dir, 'frames', '0001.png'), 'x');
  const media = await listMedia(a.dir);
  assert.deepEqual(media.map((m) => m.rel), [path.join('out', 'draft.mp4')]);

  appendChat(a.dir, { kind: 'user', text: 'merhaba' });
  appendChat(a.dir, { kind: 'assistant', text: 'selam' });
  assert.equal(readChat(a.dir).length, 2);

  writeMeta(a.dir, { sessionId: 'abc' });
  assert.equal(readMeta(a.dir).sessionId, 'abc');
  assert.equal(readMeta(a.dir).name, 'Posta Treni: Kış');
  console.log('smoke: tamam');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
