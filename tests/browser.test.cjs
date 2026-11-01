const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  });
});
after(async () => { await browser?.close(); });

async function fixture(t, markup = '<div class="js_editor_area"><div contenteditable="true"><p>原正文</p></div></div>') {
  const page = await browser.newPage();
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.setContent(markup);
  await page.addScriptTag({ path: path.join(__dirname, '../content.js') });
  await page.addStyleTag({ path: path.join(__dirname, '../styles.css') });
  await page.locator('#oclaw-html-source-button').click();
  return page;
}

async function apply(page, html, accept = true) {
  await page.locator('#oclaw-html-source-textarea').fill(html);
  const dialogs = [];
  const handler = async (dialog) => {
    dialogs.push(dialog.message());
    await (accept ? dialog.accept() : dialog.dismiss());
  };
  page.on('dialog', handler);
  try { await page.locator('#oclaw-html-source-apply-btn').click(); }
  finally { page.off('dialog', handler); }
  return dialogs;
}

test('empty and cleaned-empty imports preserve the original', async (t) => {
  const page = await fixture(t);
  for (const html of ['', ' \n ', '<script>alert(1)</script>', '<p><br></p>', '<!-- comment -->', '<svg></svg>', '<template><p>隐藏</p></template>']) {
    assert.deepEqual(await apply(page, html), []);
    assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>原正文</p>');
    assert.match(await page.locator('[role="status"]').innerText(), /阻止清空/);
  }
});

test('cancel preserves content; confirmed import and restore notify the editor', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.inputs = 0;
    document.querySelector('[contenteditable]').addEventListener('input', () => window.inputs++);
  });
  await apply(page, '<p>新正文</p>', false);
  assert.equal(await page.locator('[contenteditable]').innerText(), '原正文');
  assert.equal(await page.locator('#oclaw-html-source-restore-btn').isDisabled(), true);
  await apply(page, '<p>新正文</p>');
  assert.equal(await page.locator('[contenteditable]').innerText(), '新正文');
  assert.match(await page.locator('[role="status"]').innerText(), /尚未验证微信保存/);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await page.locator('[contenteditable]').innerText(), '新正文');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await page.locator('[contenteditable]').innerText(), '原正文');
  assert.equal(await page.evaluate(() => window.inputs), 2);
  assert.equal(await page.locator('#oclaw-html-source-restore-btn').isDisabled(), true);
});

test('a backup cannot be restored to a different article or replacement node', async (t) => {
  const page = await fixture(t);
  await apply(page, '<p>新正文</p>');
  await page.evaluate(() => {
    document.querySelector('.js_editor_area').innerHTML = '<div contenteditable="true">另一篇文章</div>';
  });
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await page.locator('[contenteditable]').innerText(), '另一篇文章');
  assert.match(await page.locator('[role="status"]').innerText(), /备份不属于/);
});

test('unrelated, ambiguous and hidden editables are not overwritten', async (t) => {
  for (const markup of [
    '<div contenteditable="true">标题</div>',
    '<div class="js_editor_area"><div contenteditable="true">甲</div><div contenteditable="true">乙</div></div>',
    '<div class="js_editor_area" style="visibility:hidden"><div contenteditable="true">隐藏</div></div>',
    '<div class="js_editor_area" style="opacity:0"><div contenteditable="true">透明隐藏</div></div>',
  ]) {
    const page = await fixture(t, markup);
    const before = await page.locator('[contenteditable]').allInnerTexts();
    assert.deepEqual(await apply(page, '<p>新正文</p>'), []);
    assert.deepEqual(await page.locator('[contenteditable]').allInnerTexts(), before);
    assert.match(await page.locator('[role="status"]').innerText(), /无法唯一确定/);
  }
});

test('ProseMirror permits reading but blocks direct DOM replacement', async (t) => {
  const page = await fixture(t, '<div class="js_editor_area"><div class="ProseMirror" contenteditable="true"><p>事务正文</p></div></div>');
  await page.locator('#oclaw-html-source-read-btn').click();
  assert.equal(await page.locator('textarea').inputValue(), '<p>事务正文</p>');
  assert.deepEqual(await apply(page, '<p>新正文</p>'), []);
  assert.equal(await page.locator('.ProseMirror').innerText(), '事务正文');
  assert.match(await page.locator('[role="status"]').innerText(), /ProseMirror/);
});

test('a changed page address cannot restore the previous article backup', async (t) => {
  const page = await fixture(t);
  await apply(page, '<p>新正文</p>');
  await page.evaluate(() => { location.hash = 'different-article'; });
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await page.locator('[contenteditable]').innerText(), '新正文');
  assert.match(await page.locator('[role="status"]').innerText(), /备份不属于/);
});

test('a designated editable container is accepted without generic fallback', async (t) => {
  const page = await fixture(t, '<div class="js_editor_area" contenteditable="true">原正文</div>');
  await apply(page, '<p>新正文</p>');
  assert.equal(await page.locator('[contenteditable]').innerText(), '新正文');
});

test('scripts, URL obfuscation, embedded documents and SVG attribute mutation are removed', async (t) => {
  const page = await fixture(t);
  await apply(page, `<p onclick="alert(1)">安全文字</p>
    <a href="java&#10;script:alert(1)">危险链接</a>
    <img src="data:image/svg+xml,test" onerror="alert(1)">
    <iframe srcdoc="test"></iframe><object></object><embed><form><input></form>
    <svg><foreignObject><p>嵌入</p></foreignObject>
    <a xlink:href="javascript:alert(1)">链接</a>
    <set attributeName="href" to="javascript:alert(1)"></set>
    <animate attributeName="onclick" to="alert(1)"></animate></svg>
    <p style="background:url(javascript:alert(1))">危险样式</p>
    <p style="background:url(\\6a avascript:test)">转义样式</p>`);
  const result = await page.locator('[contenteditable]').innerHTML();
  assert.doesNotMatch(result, /onclick|onerror|javascript|srcdoc|foreignObject|<iframe|<object|<embed|<form|<input|<set|<animate/i);
  assert.match(result, /安全文字/);
});

test('SVG click animations, gradients, safe links and inline CSS survive', async (t) => {
  const page = await fixture(t);
  await apply(page, `<p style="color:red;border-radius:8px">样式文字</p>
    <a href="https://dreamger.com">网站</a><a href="#part">锚点</a>
    <svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>
    <rect width="50" height="50" fill="url(#g)"><animate attributeName="opacity" values="0;1" dur="1s" begin="click"/><animateTransform attributeName="transform" type="rotate" from="0" to="90" dur="1s"/></rect></svg>`);
  const editor = page.locator('[contenteditable]');
  assert.equal(await editor.locator('animate').getAttribute('begin'), 'click');
  assert.equal(await editor.locator('animateTransform').count(), 1);
  assert.equal(await editor.locator('linearGradient').count(), 1);
  assert.equal(await editor.locator('a').first().getAttribute('href'), 'https://dreamger.com');
  assert.match(await editor.locator('p').getAttribute('style'), /color:red/);
});

test('compatibility losses are shown before replacement and remain visible', async (t) => {
  const page = await fixture(t);
  const dialogs = await apply(page, `<html><head><style>.a{color:red}</style><link rel="stylesheet" href="https://example.com/a.css"></head>
    <body><p style="display:flex">内容</p><img src="https://example.com/a.png"></body></html>`);
  assert.match(dialogs[0], /样式表/);
  assert.match(dialogs[0], /非微信图片/);
  assert.match(dialogs[0], /复杂布局/);
  assert.equal(await page.locator('[contenteditable] style,[contenteditable] link').count(), 0);
  assert.match(await page.locator('[role="status"]').innerText(), /非微信图片/);
});

test('visible editable UEditor iframe imports and restores using frame events', async (t) => {
  const page = await fixture(t, '<iframe id="ueditor_0" style="width:600px;height:200px" srcdoc="<body contenteditable=\'true\'><p>旧框架正文</p></body>"></iframe>');
  await apply(page, '<p>框架新正文</p>');
  assert.equal(await page.frameLocator('iframe').locator('body').innerText(), '框架新正文');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await page.frameLocator('iframe').locator('body').innerText(), '旧框架正文');
});

test('hidden and read-only UEditor frames are never used as a write target', async (t) => {
  for (const [style, editable] of [['display:none', 'true'], ['width:600px;height:200px', 'false']]) {
    const page = await fixture(t, `<iframe id="ueditor_0" style="${style}" srcdoc="<body contenteditable='${editable}'>只读正文</body>"></iframe>`);
    assert.deepEqual(await apply(page, '<p>新正文</p>'), []);
    assert.equal(await page.frameLocator('iframe').locator('body').textContent(), '只读正文');
    assert.match(await page.locator('[role="status"]').innerText(), /无法唯一确定/);
  }
});

test('floating entry migrates when toolbar appears; keyboard focus stays in dialog', async (t) => {
  const page = await fixture(t);
  await page.locator('textarea').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#oclaw-html-source-apply-btn').evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('textarea').evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const toolbar = document.createElement('div');
    toolbar.className = 'edui-toolbar';
    toolbar.style.cssText = 'width:600px;height:40px';
    document.body.prepend(toolbar);
  });
  await page.locator('.edui-toolbar #oclaw-html-source-button').waitFor();
  assert.equal(await page.locator('#oclaw-html-source-float-wrap').count(), 0);
  assert.equal(await page.locator('#oclaw-html-source-button').count(), 1);
});
