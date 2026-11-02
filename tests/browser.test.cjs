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

async function apply(page, html, accept = true, insert = false) {
  await page.locator('#oclaw-html-source-textarea').fill(html);
  const dialogs = [];
  const handler = async (dialog) => {
    dialogs.push(dialog.message());
    await (accept ? dialog.accept() : dialog.dismiss());
  };
  page.on('dialog', handler);
  try { await page.locator(insert ? '#oclaw-html-source-insert-btn' : '#oclaw-html-source-apply-btn').click(); }
  finally { page.off('dialog', handler); }
  return dialogs;
}

async function position(page, selector, offset, end = offset, scope = page) {
  await page.locator('#oclaw-html-source-cancel-btn').click();
  await scope.locator(selector).evaluate((element, { offset, end }) => {
    const doc = element.ownerDocument;
    const container = element.firstChild?.nodeType === 3 ? element.firstChild : element;
    element.closest('[contenteditable="true"]').focus();
    const range = doc.createRange();
    range.setStart(container, offset);
    range.setEnd(container, end);
    doc.getSelection().removeAllRanges();
    doc.getSelection().addRange(range);
  }, { offset, end });
  await page.locator('#oclaw-html-source-button').click();
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

test('ProseMirror class does not block reading, import or restore', async (t) => {
  const page = await fixture(t, '<div class="js_editor_area"><div class="ProseMirror" contenteditable="true"><p>事务正文</p></div></div>');
  await page.locator('#oclaw-html-source-read-btn').click();
  assert.equal(await page.locator('textarea').inputValue(), '<p>事务正文</p>');
  assert.equal((await apply(page, '<p>新正文</p>')).length, 1);
  assert.equal(await page.locator('.ProseMirror').innerText(), '新正文');
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await page.locator('.ProseMirror').innerText(), '事务正文');
});

async function mountProseMirror(page) {
  const esbuild = require(process.env.ESBUILD_MODULE || 'esbuild');
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: process.env.PROSEMIRROR_PROJECT || path.join(__dirname, '..'),
      contents: `
        import { Schema } from 'prosemirror-model';
        import { EditorState } from 'prosemirror-state';
        import { EditorView } from 'prosemirror-view';
        const schema = new Schema({ nodes: {
          doc: {content: 'block+'},
          paragraph: {group: 'block', content: 'text*', parseDOM: [{tag: 'p'}], toDOM: () => ['p', 0]},
          svg: {group: 'block', atom: true, attrs: {html: {}},
            parseDOM: [{tag: 'svg', getAttrs: dom => ({html: dom.outerHTML})}],
            toDOM: node => new DOMParser().parseFromString(node.attrs.html, 'text/html').querySelector('svg')},
          text: {}
        }});
        window.view = new EditorView(document.querySelector('.js_editor_area'), {
          state: EditorState.create({schema, doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('真实模型原正文')])])})
        });
        window.reopen = (json) => {
          window.view.destroy();
          window.view = new EditorView(document.querySelector('.js_editor_area'), {
            state: EditorState.create({schema, doc: schema.nodeFromJSON(json)})
          });
        };
      `,
    },
    bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}

test('real ProseMirror observes imported DOM in its document model and restores it', async (t) => {
  const page = await fixture(t, '<div class="js_editor_area"></div>');
  await mountProseMirror(page);
  await apply(page, '<p>真实模型新正文</p>');
  await page.waitForFunction(() => window.view.state.doc.textContent === '真实模型新正文');
  await page.locator('#oclaw-html-source-restore-btn').click();
  await page.waitForFunction(() => window.view.state.doc.textContent === '真实模型原正文');
  await apply(page, '<p>保存后重开</p>');
  await page.waitForFunction(() => window.view.state.doc.textContent === '保存后重开');
  const saved = await page.evaluate(() => window.view.state.doc.toJSON());
  await page.evaluate((json) => window.reopen(json), saved);
  assert.equal(await page.locator('.ProseMirror').innerText(), '保存后重开');
  assert.equal(await page.evaluate(() => window.view.state.doc.textContent), '保存后重开');
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
  assert.equal(await page.locator('#oclaw-html-source-insert-btn').evaluate((node) => node === document.activeElement), true);
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

const svgSnippet = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#16a34a"><animate attributeName="opacity" values="0.5;1" dur="1s" begin="click"/></rect></svg>';

test('insertion requires a remembered article position, with no whole-document fallback', async (t) => {
  const page = await fixture(t);
  assert.deepEqual(await apply(page, svgSnippet, true, true), []);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>原正文</p>');
  assert.match(await page.locator('[role="status"]').innerText(), /尚未定位/);
});

test('SVG splits the paragraph at the remembered caret and preserves surrounding nodes', async (t) => {
  const page = await fixture(t, '<div class="js_editor_area"><div contenteditable="true"><p id="before">前一段</p><p id="target">甲乙丙丁</p><p id="after">后一段</p></div></div>');
  await page.evaluate(() => { window.beforeNode = document.getElementById('before'); window.afterNode = document.getElementById('after'); });
  await position(page, '#target', 2);
  await apply(page, svgSnippet, true, true);
  const editor = page.locator('[contenteditable]');
  assert.deepEqual(await editor.locator(':scope > *').evaluateAll((nodes) => nodes.map(node => [node.localName, node.textContent])), [
    ['p', '前一段'], ['p', '甲乙'], ['svg', ''], ['p', '丙丁'], ['p', '后一段'],
  ]);
  assert.equal(await page.evaluate(() => window.beforeNode === document.getElementById('before') && window.afterNode === document.getElementById('after')), true);
  assert.equal(await editor.locator('#target').count(), 1);
  assert.equal(await editor.locator('animate').getAttribute('begin'), 'click');
  assert.equal(await page.locator('.oclaw-modal').isVisible(), false);
  await page.locator('#oclaw-html-source-button').click();
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await editor.innerHTML(), '<p id="before">前一段</p><p id="target">甲乙丙丁</p><p id="after">后一段</p>');
});

test('inline HTML inserts inside a paragraph without deleting selected text', async (t) => {
  const page = await fixture(t, '<div class="js_editor_area"><div contenteditable="true"><p>甲乙丙丁</p></div></div>');
  await position(page, '[contenteditable] p', 1, 3);
  await apply(page, '<strong>新增</strong>', true, true);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>甲乙丙<strong>新增</strong>丁</p>');
});

test('SVG splits formatted text and root-level inline wrappers without swallowing formatting', async (t) => {
  for (const html of ['<p>前<strong>粗体文字</strong>后</p>', '<strong>粗体文字</strong>']) {
    const page = await fixture(t, `<div class="js_editor_area"><div contenteditable="true">${html}</div></div>`);
    await position(page, '[contenteditable] strong', 2);
    await apply(page, svgSnippet, true, true);
    assert.equal(await page.locator('[contenteditable] svg').count(), 1);
    assert.equal(await page.locator('[contenteditable] p svg,[contenteditable] strong svg').count(), 0);
    assert.deepEqual(await page.locator('[contenteditable] strong').allTextContents(), ['粗体', '文字']);
  }
});

test('insertion at document boundaries and empty paragraphs preserves text', async (t) => {
  for (const [selector, offset] of [['[contenteditable]', 0], ['[contenteditable]', 2], ['#empty', 0]]) {
    const page = await fixture(t, '<div class="js_editor_area"><div contenteditable="true"><p>正文</p><p id="empty"><br></p></div></div>');
    await position(page, selector, offset);
    await apply(page, svgSnippet, true, true);
    assert.equal(await page.locator('[contenteditable] svg').count(), 1);
    assert.equal(await page.locator('[contenteditable]').textContent(), '正文');
    assert.equal(await page.locator('[contenteditable] p svg').count(), 0);
  }
});

test('changed content, replaced nodes and changed article addresses invalidate the position', async (t) => {
  for (const mutation of ['content', 'nodes', 'address']) {
    const page = await fixture(t);
    await position(page, '[contenteditable] p', 1);
    await page.evaluate((mutation) => {
      const editor = document.querySelector('[contenteditable]');
      if (mutation === 'address') location.hash = 'another-article';
      else editor.innerHTML = mutation === 'nodes' ? editor.innerHTML : '<p>修改后的正文</p>';
    }, mutation);
    const before = await page.locator('[contenteditable]').innerHTML();
    assert.deepEqual(await apply(page, svgSnippet, true, true), []);
    assert.equal(await page.locator('[contenteditable]').innerHTML(), before);
    assert.match(await page.locator('[role="status"]').innerText(), /插入位置已失效/);
  }
});

test('an unrelated input does not reuse the old article caret', async (t) => {
  const page = await fixture(t, '<input id="title"><div class="js_editor_area"><div contenteditable="true"><p>正文</p></div></div>');
  await position(page, '[contenteditable] p', 1);
  await page.locator('#oclaw-html-source-cancel-btn').click();
  await page.locator('#title').fill('文章标题');
  await page.locator('#oclaw-html-source-button').click();
  assert.deepEqual(await apply(page, svgSnippet, true, true), []);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>正文</p>');
});

test('empty insertion preserves content and an existing backup', async (t) => {
  const page = await fixture(t);
  await apply(page, '<p>替换后的正文</p>');
  await position(page, '[contenteditable] p', 2);
  assert.deepEqual(await apply(page, '<script>alert(1)</script>', true, true), []);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>替换后的正文</p>');
  await page.locator('#oclaw-html-source-restore-btn').click();
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>原正文</p>');
});

test('iframe caret survives moving focus to the extension textarea', async (t) => {
  const page = await fixture(t, '<iframe id="ueditor_0" style="width:600px;height:200px" srcdoc="<body contenteditable=\'true\'><p>框架正文</p></body>"></iframe>');
  await position(page, 'p', 2, 2, page.frameLocator('iframe'));
  await apply(page, svgSnippet, true, true);
  assert.equal(await page.frameLocator('iframe').locator('svg').count(), 1);
  assert.deepEqual(await page.frameLocator('iframe').locator('p').allTextContents(), ['框架', '正文']);
});

test('real ProseMirror records inserted SVG between text and survives model reopen', async (t) => {
  const page = await fixture(t, '<div class="js_editor_area"></div>');
  await mountProseMirror(page);
  await position(page, '.ProseMirror p', 4);
  await apply(page, svgSnippet, true, true);
  await page.waitForFunction(() => window.view.state.doc.childCount === 3 && window.view.state.doc.child(1).type.name === 'svg');
  assert.equal(await page.evaluate(() => window.view.state.doc.textContent), '真实模型原正文');
  const saved = await page.evaluate(() => window.view.state.doc.toJSON());
  await page.evaluate((json) => window.reopen(json), saved);
  assert.equal(await page.locator('.ProseMirror svg animate').getAttribute('begin'), 'click');
  assert.deepEqual(await page.locator('.ProseMirror p').allTextContents(), ['真实模型', '原正文']);
});

test('keyboard opening preserves the article caret before textarea focus', async (t) => {
  const page = await fixture(t);
  await position(page, '[contenteditable] p', 1);
  await page.locator('#oclaw-html-source-cancel-btn').click();
  await page.locator('[contenteditable] p').evaluate((element) => {
    element.parentElement.focus();
    const range = document.createRange();
    range.setStart(element.firstChild, 1);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#oclaw-html-source-button').evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  await apply(page, '<span>插入</span>', true, true);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>原<span>插入</span>正文</p>');
});

test('insertion sanitizes unsafe HTML while preserving original content and SVG animation', async (t) => {
  const page = await fixture(t);
  await position(page, '[contenteditable] p', 1);
  const dialogs = await apply(page, `<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">新增</a>${svgSnippet}`, true, true);
  assert.match(dialogs[0], /已移除/);
  assert.equal(await page.locator('[contenteditable]').textContent(), '原新增正文');
  assert.doesNotMatch(await page.locator('[contenteditable]').innerHTML(), /<script|onclick|javascript:/);
  assert.equal(await page.locator('[contenteditable] animate').getAttribute('begin'), 'click');
});

test('one accepted confirmation covers repeated insertions, replacements and restore', async (t) => {
  const page = await fixture(t);
  assert.equal((await apply(page, '<p>第一稿</p>')).length, 1);
  assert.deepEqual(await apply(page, '<p>第二稿</p>'), []);
  await position(page, '[contenteditable] p', 1);
  assert.deepEqual(await apply(page, '<span>插入</span>', true, true), []);
  await page.locator('#oclaw-html-source-button').click();
  const dialogs = [];
  const handler = async dialog => { dialogs.push(dialog.message()); await dialog.accept(); };
  page.on('dialog', handler);
  await page.locator('#oclaw-html-source-restore-btn').click();
  page.off('dialog', handler);
  assert.deepEqual(dialogs, []);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>第二稿</p>');
});

test('cancel is not remembered as consent for subsequent insertion', async (t) => {
  const page = await fixture(t);
  await position(page, '[contenteditable] p', 1);
  assert.equal((await apply(page, '<span>新增</span>', false, true)).length, 1);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>原正文</p>');
  assert.equal((await apply(page, '<span>新增</span>', true, true)).length, 1);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>原<span>新增</span>正文</p>');
  await page.locator('#oclaw-html-source-button').click();
  await position(page, '[contenteditable] p', 0);
  assert.deepEqual(await apply(page, '<span>再次</span>', true, true), []);
  assert.equal(await page.locator('[contenteditable]').textContent(), '再次原新增正文');
});

test('changing the article address or editor node asks again', async (t) => {
  const page = await fixture(t);
  assert.equal((await apply(page, '<p>第一篇</p>')).length, 1);
  await page.evaluate(() => { location.hash = 'new-article'; });
  assert.equal((await apply(page, '<p>第二篇</p>')).length, 1);
  await page.evaluate(() => { document.querySelector('.js_editor_area').innerHTML = '<div contenteditable="true"><p>第三篇</p></div>'; });
  assert.equal((await apply(page, '<p>第三篇修改</p>')).length, 1);
});

test('a page reload resets confirmation and compatibility warnings remain inline', async (t) => {
  const page = await fixture(t);
  assert.equal((await apply(page, '<p>初稿</p>')).length, 1);
  await page.locator('textarea').fill('<p onclick="alert(1)">下一稿</p>');
  assert.match(await page.locator('[role="status"]').innerText(), /已移除/);
  assert.deepEqual(await apply(page, '<p onclick="alert(1)">下一稿</p>'), []);
  assert.equal(await page.locator('[contenteditable]').innerHTML(), '<p>下一稿</p>');
  await page.reload();
  await page.setContent('<div class="js_editor_area"><div contenteditable="true"><p>重开</p></div></div>');
  await page.addScriptTag({ path: path.join(__dirname, '../content.js') });
  await page.locator('#oclaw-html-source-button').click();
  assert.equal((await apply(page, '<p>刷新后</p>')).length, 1);
});
