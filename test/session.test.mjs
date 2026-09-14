import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../session.js', import.meta.url), 'utf8');
function tab(t, locks) {
  const { window:w } = new JSDOM(html, { url:'https://example.org', runScripts:'outside-only' });
  t.after(() => w.close());
  if (locks) Object.defineProperty(w.navigator, 'locks', { value:locks });
  w.eval(source);
  return w;
}

test('simultaneous tab boots start exactly one editor, before either reads records', async t => {
  let owner = false;
  const locks = { async request(name, options, callback) {
    assert.equal(name, 'monthly-money-tracker-editor');
    assert.equal(options.ifAvailable, true);
    const available = !owner;
    if (available) owner = true;
    return callback(available ? { name } : null);
  } };
  const first = tab(t, locks);
  const second = tab(t, locks);
  await Promise.resolve();
  assert.equal(first.document.querySelectorAll('script[src="app.js"]').length, 1);
  assert.equal(second.document.querySelectorAll('script[src="app.js"]').length, 0);
  assert.equal(second.document.getElementById('session-blocker').classList.contains('hidden'), false);
  assert.match(second.document.getElementById('session-message').textContent, /another tab/);
  assert.equal(second.document.getElementById('app-view').inert, true);
  let clicked = false;
  second.document.getElementById('add-money').addEventListener('click', () => { clicked = true; });
  second.document.getElementById('add-money').click();
  assert.equal(clicked, false);
});

test('a new page can acquire editing after the previous document releases its lock', async t => {
  let held = true;
  const locks = { async request(name, options, callback) {
    const available = !held;
    if (available) held = true;
    return callback(available ? { name } : null);
  } };
  const waiting = tab(t, locks);
  assert.equal(waiting.document.querySelector('script[src="app.js"]'), null);
  held = false; // Browser releases the Web Lock when its document is closed.
  const next = tab(t, locks);
  assert.ok(next.document.querySelector('script[src="app.js"]'));
});

test('unsupported or denied locking fails closed instead of silently allowing conflicting edits', async t => {
  const missing = tab(t);
  assert.equal(missing.document.querySelector('script[src="app.js"]'), null);
  assert.match(missing.document.getElementById('session-message').textContent, /HTTPS/);
  const denied = tab(t, { request:async () => { throw new Error('Denied'); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(denied.document.querySelector('script[src="app.js"]'), null);
  assert.equal(denied.document.getElementById('session-blocker').classList.contains('hidden'), false);
});

test('a stale session cannot dismiss protection with Escape or the backdrop', t => {
  const w = tab(t);
  const panel = w.document.getElementById('session-blocker');
  let escaped = false;
  w.document.addEventListener('keydown', () => { escaped = true; });
  w.document.getElementById('session-reload').dispatchEvent(new w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  assert.equal(escaped, false);
  let clicked = false;
  panel.addEventListener('click', () => { clicked = true; });
  panel.click();
  assert.equal(clicked, false);
});

test('offline cache includes the script that acquires the editing lock', () => {
  const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(sw, /"\.\/session\.js"/);
  assert.match(html, /<script src="session\.js"><\/script>/);
  assert.doesNotMatch(html, /<script src="app\.js"><\/script>/);
});

test('a running session exposes its protection dialog to assistive technology', t => {
  const w = tab(t, { request:(name, options, callback) => callback({ name }) });
  const panel = w.document.getElementById('session-blocker');
  panel.setAttribute('aria-hidden', 'true');
  w.MoNySession.block('Another tab changed these records.');
  assert.equal(panel.getAttribute('aria-hidden'), 'false');
  assert.equal(panel.inert, false);
  assert.equal(w.document.activeElement.id, 'session-reload');
});
