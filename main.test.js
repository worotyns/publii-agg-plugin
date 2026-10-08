// Run: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AggAnalytics = require('./main.js');

// The agg browser SDK (web/sdk/agg.js in github.com/worotyns/agg), copied for tests only; not shipped in the plugin.
const SDK = fs.readFileSync(path.join(__dirname, 'fixtures', 'agg.js'), 'utf8');

const DEFAULTS = {
  host: 'agg.example.com/',
  siteKey: 'pk_abc123',
  trackArticles: true,
  readSeconds: 30,
  readScroll: 60,
  trackOutbound: false,
  previewMode: false,
  cookieBannerIntegration: false,
  cookieBannerGroup: 'analytics'
};

const POST = { slug: 'hello-world', title: 'Hello </script> world', mainTag: { name: 'Go' }, author: { name: 'Ann' } };

function plugin(config) {
  const insertions = {};
  const api = { addInsertion: (place, fn, prio, self) => { insertions[place] = (r, c) => fn.call(self, r, c); } };
  const p = new AggAnalytics(api, 'aggAnalytics', Object.assign({}, DEFAULTS, config));
  p.addInsertions();
  return insertions;
}

function renderer(opts = {}) {
  return { previewMode: !!opts.preview, siteConfig: { domain: 'https://blog.example.com', advanced: { gdpr: { enabled: !!opts.gdpr } } } };
}

// sandbox is a minimal browser: enough for the plugin snippets and the agg SDK.
function sandbox() {
  const listeners = {};
  const requests = [];
  const intervals = [];
  const head = [];
  const storage = {};
  const on = (target) => (type, fn) => { (listeners[target + type] = listeners[target + type] || []).push(fn); };
  const off = (target) => (type, fn) => { listeners[target + type] = (listeners[target + type] || []).filter((f) => f !== fn); };
  const document = {
    referrer: '',
    visibilityState: 'visible',
    documentElement: { scrollHeight: 2000 },
    head: { appendChild: (el) => head.push(el) },
    createElement: () => ({}),
    addEventListener: on('doc:'),
    currentScript: null
  };
  const window = {
    document,
    location: { pathname: '/hello-world.html', hostname: 'blog.example.com' },
    navigator: { language: 'en', sendBeacon: () => true },
    history: { pushState() {} },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    crypto: { randomUUID: () => 'vid-1' },
    scrollY: 0,
    innerHeight: 800,
    addEventListener: on('win:'),
    removeEventListener: off('win:'),
    fetch: (url, init) => {
      requests.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      const json = url.indexOf('/v1/config') > -1 ? { visitorId: true, pageViews: true, requireConsent: false } : {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
    },
    console
  };
  let now = 0;
  const ctx = vm.createContext({
    window,
    document,
    URL,
    Blob: class {},
    JSON,
    Math,
    Promise,
    Date: { now: () => now },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 1; },
    clearTimeout() {},
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: (id) => { intervals[id - 1] = null; },
    console
  });
  return {
    window, document, requests, head, listeners,
    run: (html) => {
      const re = /<script type="([^"]+)">([\s\S]*?)<\/script>/g;
      let m, n = 0;
      while ((m = re.exec(html))) { vm.runInContext(m[2], ctx); n++; }
      assert.ok(n > 0, 'no script in ' + html);
    },
    loadSDK: () => vm.runInContext(SDK, ctx),
    tick: (ms) => { now += ms; intervals.forEach((fn) => fn && fn()); },
    emit: (key, ev) => (listeners[key] || []).slice().forEach((fn) => fn(ev || {})),
    settle: async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }
  };
}

function events(sb) {
  return sb.requests.filter((r) => r.url.endsWith('/e')).flatMap((r) => r.body.events);
}

test('loader initialises agg with the normalised host and site key', async () => {
  const ins = plugin();
  const html = ins.publiiHead(renderer());
  assert.match(html, /<script type="text\/javascript">/);

  const sb = sandbox();
  sb.run(html);
  assert.strictEqual(sb.head[0].src, 'https://agg.example.com/agg.js');
  assert.strictEqual(sb.head[0].async, true);

  sb.loadSDK();
  await sb.settle();
  assert.strictEqual(sb.requests[0].url, 'https://agg.example.com/v1/config?site=pk_abc123');
  const ev = events(sb);
  assert.deepStrictEqual(ev.map((e) => e.name), ['page_view']);
  assert.strictEqual(sb.requests[1].body.site, 'pk_abc123');
});

test('nothing is output without a valid host and key, or in preview mode', () => {
  assert.strictEqual(plugin({ siteKey: '' }).publiiHead(renderer()), '');
  assert.strictEqual(plugin({ siteKey: 'abc' }).publiiHead(renderer()), '');
  assert.strictEqual(plugin({ host: 'http://' }).publiiHead(renderer()), '');
  assert.strictEqual(plugin().publiiHead(renderer({ preview: true })), '');
  assert.notStrictEqual(plugin({ previewMode: true }).publiiHead(renderer({ preview: true })), '');
  assert.strictEqual(plugin().customFooterCode(renderer({ preview: true }), { post: POST }), '');
});

test('host keeps a sub-path and an explicit http scheme', () => {
  const sb = sandbox();
  sb.run(plugin({ host: ' http://example.com/agg/ ' }).publiiHead(renderer()));
  assert.strictEqual(sb.head[0].src, 'http://example.com/agg/agg.js');
});

test('article_read is sent after the reader stayed long enough', async () => {
  const ins = plugin({ readScroll: 0 });
  const sb = sandbox();
  const footer = ins.customFooterCode(renderer(), { post: POST });
  assert.ok(!footer.includes('</script> world'), 'title must not close the script element');
  sb.run(ins.publiiHead(renderer()));
  sb.run(footer); // before the SDK loads: queued
  sb.loadSDK();
  await sb.settle();
  assert.deepStrictEqual(events(sb).map((e) => e.name), ['page_view']);

  sb.tick(10000);
  sb.document.visibilityState = 'hidden';
  sb.tick(60000); // hidden time does not count
  sb.document.visibilityState = 'visible';
  sb.tick(1000);
  await sb.settle();
  assert.deepStrictEqual(events(sb).map((e) => e.name), ['page_view']);

  sb.tick(19000);
  sb.tick(5000); // only once
  await sb.settle();
  const read = events(sb).filter((e) => e.name === 'article_read');
  assert.strictEqual(read.length, 1);
  assert.deepStrictEqual(read[0].props, { article: 'hello-world', title: 'Hello </script> world', section: 'Go', author: 'Ann' });
});

test('article_read is sent after scrolling far enough', async () => {
  const ins = plugin({ readSeconds: 0 });
  const sb = sandbox();
  sb.run(ins.publiiHead(renderer()));
  sb.loadSDK();
  sb.run(ins.customFooterCode(renderer(), { post: POST }));
  sb.window.scrollY = 300; // (300 + 800) / 2000 = 55%
  sb.emit('win:scroll');
  await sb.settle();
  assert.strictEqual(events(sb).filter((e) => e.name === 'article_read').length, 0);
  sb.window.scrollY = 500; // 65%
  sb.emit('win:scroll');
  sb.emit('win:scroll');
  await sb.settle();
  assert.strictEqual(events(sb).filter((e) => e.name === 'article_read').length, 1);
});

test('no article events outside posts; outbound clicks are tracked when enabled', async () => {
  assert.strictEqual(plugin().customFooterCode(renderer(), { page: { slug: 'about' } }), '');
  assert.strictEqual(plugin({ trackArticles: false }).customFooterCode(renderer(), { post: POST }), '');

  const ins = plugin({ trackArticles: false, trackOutbound: true });
  const sb = sandbox();
  sb.run(ins.publiiHead(renderer()));
  sb.loadSDK();
  sb.run(ins.customFooterCode(renderer(), false));
  const link = (href, hostname) => ({ target: { closest: () => ({ protocol: href.split('//')[0], hostname, href }) } });
  sb.emit('doc:click', link('https://blog.example.com/a.html', 'blog.example.com'));
  sb.emit('doc:click', link('mailto:a@b.c', ''));
  sb.emit('doc:click', link('https://github.com/worotyns/agg#readme', 'github.com'));
  await sb.settle();
  const out = events(sb).filter((e) => e.name === 'outbound_click');
  assert.deepStrictEqual(out.map((e) => e.props), [{ host: 'github.com', url: 'https://github.com/worotyns/agg' }]);
});

test('cookie banner integration blocks the scripts and grants consent once unblocked', () => {
  const ins = plugin({ cookieBannerIntegration: true, cookieBannerGroup: 'analytics' });
  const head = ins.publiiHead(renderer({ gdpr: true }));
  assert.match(head, /<script type="gdpr-blocker\/analytics">/);
  assert.match(head, /\['consent',\{analytics:true\}\]/);
  assert.match(ins.customFooterCode(renderer({ gdpr: true }), { post: POST }), /type="gdpr-blocker\/analytics"/);

  // Without the banner enabled in Publii nothing would unblock the script, so it loads normally.
  assert.match(ins.publiiHead(renderer({ gdpr: false })), /<script type="text\/javascript">/);
});
