(() => {
  "use strict";

  const IDS = {
    button: "oclaw-html-source-button",
    floatWrap: "oclaw-html-source-float-wrap",
    modal: "oclaw-html-source-modal",
    textarea: "oclaw-html-source-textarea",
    msg: "oclaw-html-source-message",
    readBtn: "oclaw-html-source-read-btn",
    applyBtn: "oclaw-html-source-apply-btn",
    insertBtn: "oclaw-html-source-insert-btn",
    cancelBtn: "oclaw-html-source-cancel-btn",
    restoreBtn: "oclaw-html-source-restore-btn"
  };
  let backup = null;
  let returnFocus = null;
  let insertionPoint = null;
  let confirmedEditor = null;
  const watchedDocuments = new WeakSet();

  function confirmFirstOperation(editor, message) {
    if (confirmedEditor?.node === editor.node && confirmedEditor.url === location.href) return true;
    if (!window.confirm(message + "\n本页当前文章仅首次操作提示，后续插入、替换全文和恢复不再弹窗。")) return false;
    confirmedEditor = { node: editor.node, url: location.href };
    return true;
  }

  function rememberInsertionPoint() {
    if (document.getElementById(IDS.modal)?.classList.contains("show")) return;
    if (document.activeElement?.id === IDS.button) return;
    const editor = findEditorTarget();
    const selection = editor?.doc.getSelection();
    if (!editor || !selection?.rangeCount ||
        (editor.doc === document && !editor.node.contains(document.activeElement)) ||
        (editor.doc !== document && document.activeElement !== editor.doc.defaultView.frameElement)) {
      insertionPoint = null;
      return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    if (!editor.node.contains(range.startContainer) || !editor.node.contains(range.endContainer)) {
      insertionPoint = null;
      return;
    }
    // Insert after a selection; never delete the selected article text.
    range.collapse(false);
    insertionPoint = { node: editor.node, range, anchor: range.startContainer,
      offset: range.startOffset, html: editor.node.innerHTML, url: location.href };
  }

  function watchSelection() {
    const doc = findEditorTarget()?.doc;
    if (doc && !watchedDocuments.has(doc)) {
      watchedDocuments.add(doc);
      doc.addEventListener("selectionchange", rememberInsertionPoint);
    }
  }

  function isVisible(el) {
    if (!el) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" &&
      (!el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
  }

  function firstVisible(selectors, root = document) {
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector);
      for (const node of nodes) {
        if (isVisible(node)) {
          return node;
        }
      }
    }
    return null;
  }

  function findEditorTarget() {
    const candidates = new Set();
    const iframeSelectors = [
      ".edui-editor-iframeholder iframe",
      "iframe[id^='ueditor_']",
      "iframe[id*='ueditor']",
      ".js_editor_area iframe",
      ".rich_media_editor iframe"
    ];

    for (const selector of iframeSelectors) {
      const iframes = document.querySelectorAll(selector);
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument;
          if (!doc || !doc.body) {
            continue;
          }
          if (isVisible(iframe) && doc.body.isContentEditable) {
            candidates.add(doc.body);
          }
        } catch (_err) {
          // Skip non-accessible iframe.
        }
      }
    }

    document.querySelectorAll(
      ".rich_media_editor[contenteditable='true'], .js_editor_area[contenteditable='true'], .rich_media_editor [contenteditable='true'], .js_editor_area [contenteditable='true']"
    ).forEach((node) => {
      if (isVisible(node) && !node.parentElement.closest("[contenteditable='true']")) {
        candidates.add(node);
      }
    });
    if (candidates.size === 1) {
      const node = [...candidates][0];
      return { node, doc: node.ownerDocument };
    }
    return null;
  }

  function sanitizeHtml(rawHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");
    const warnings = new Set();
    const warn = (message) => warnings.add(message);
    if (doc.querySelector("style,link[rel~='stylesheet']")) {
      warn("已移除样式表；请先将 CSS 转为行内样式，否则排版可能丢失。");
    }

    doc
      .querySelectorAll(
        "script,iframe,object,embed,base,meta,link,style,foreignObject,template,form,input,textarea,button,select"
      )
      .forEach((el) => { el.remove(); warn("已移除脚本、嵌入页面、表单或文档级标签。"); });

    const safeUrl = (value) => {
      try {
        return ["http:", "https:", "mailto:", "tel:"].includes(new URL(value, "https://mp.weixin.qq.com/").protocol);
      } catch { return false; }
    };

    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || name === "srcdoc" || name === "srcset" ||
            (["href", "xlink:href", "src", "action", "formaction", "poster", "background"].includes(name) && !safeUrl(attr.value))) {
          el.removeAttribute(attr.name);
          warn("已移除事件、危险链接或不支持的资源属性。");
        }
        if (name === "style" && (/\\|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(attr.value) ||
            [...attr.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].some((match) => !safeUrl(match[2])))) {
          el.removeAttribute("style");
          warn("已移除含危险或无法可靠检查的资源引用的行内样式。");
        }
      }
      if (el.hasAttribute("attributeName") &&
          !/^(opacity|fill|fill-opacity|stroke|stroke-opacity|stroke-width|transform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|viewBox|d|points|visibility)$/i.test(el.getAttribute("attributeName"))) {
        el.remove();
        warn("已移除可能修改链接或样式的 SVG 动画；保留常见视觉动画。");
      }
      if (el.localName === "img" && el.hasAttribute("src")) {
        const url = new URL(el.getAttribute("src"), "https://mp.weixin.qq.com/");
        if (!/(^|\.)(qpic\.cn|qlogo\.cn|weixin\.qq\.com)$/.test(url.hostname)) {
          warn("包含非微信图片地址；显示不代表已上传，请在微信中检查图片保存结果。");
        }
      }
      if (el.hasAttribute("style") && /display\s*:\s*(flex|grid)|position\s*:|animation\s*:|var\s*\(/i.test(el.getAttribute("style"))) {
        warn("包含复杂布局、动画或 CSS 变量；微信保存及手机端效果需要核对。");
      }
    });
    return { html: doc.body.innerHTML, warnings: [...warnings] };
  }

  function emitEditorEvents(target) {
    ["input", "change", "keyup", "blur"].forEach((evtName) => {
      const win = (target.ownerDocument || target).defaultView;
      target.dispatchEvent(new win.Event(evtName, { bubbles: true }));
    });
  }

  function setMessage(text, isError = false) {
    const msgNode = document.getElementById(IDS.msg);
    if (!msgNode) {
      return;
    }
    msgNode.textContent = text;
    msgNode.classList.toggle("error", Boolean(isError));
  }

  function readCurrentHtml() {
    const editor = findEditorTarget();
    if (!editor) {
      return null;
    }
    return editor.node.innerHTML;
  }

  function applyHtmlToEditor(rawHtml, insert = false) {
    const editor = findEditorTarget();
    if (!editor) {
      setMessage("无法唯一确定正文编辑区，请进入图文编辑页并只保留一个正文编辑区。未修改内容。", true);
      return false;
    }

    const point = insertionPoint;
    if (insert && (!point || point.node !== editor.node || point.url !== location.href ||
        !point.anchor.isConnected || !editor.node.contains(point.anchor) ||
        point.html !== editor.node.innerHTML || point.range.startContainer !== point.anchor ||
        point.range.startOffset !== point.offset)) {
      setMessage("插入位置已失效或尚未定位。请关闭弹窗，在正文中重新点选位置，再打开 HTML 源码。未修改内容。", true);
      return false;
    }

    const result = sanitizeHtml(rawHtml || "");
    const parsed = new DOMParser().parseFromString(result.html, "text/html");
    if (!parsed.body.textContent.trim() && !parsed.body.querySelector("img[src],svg path,svg rect,svg circle,svg ellipse,svg polygon,svg polyline,svg line,svg image,video,audio,mp-common-mpaudio,mpvoice,mpvideo,mp-miniprogram")) {
      setMessage("没有可导入的内容，已阻止清空正文。", true);
      return false;
    }
    const warnings = result.warnings.join("\n");
    if (!confirmFirstOperation(editor, `${warnings ? warnings + "\n\n" : ""}${insert ? "将在记住的光标处插入；已选文字不会删除。" : "将替换当前正文。"}操作前的内容仅保留在本页内存中，可恢复一次；刷新页面后失效。替换全文或恢复也会覆盖正文。是否继续？`)) {
      return false;
    }
    backup = { node: editor.node, html: editor.node.innerHTML, url: location.href };
    document.getElementById(IDS.restoreBtn).disabled = false;
    if (insert) {
      const range = point.range.cloneRange();
      const fragment = range.createContextualFragment(result.html);
      const last = fragment.lastChild;
      const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      let paragraph = element.closest("p,h1,h2,h3,h4,h5,h6,pre");
      if (!paragraph) {
        let inline = element;
        while (inline !== editor.node && inline.matches("span,a,b,strong,i,em,u,s,del,code,sub,sup")) {
          paragraph = inline;
          inline = inline.parentElement;
        }
      }
      const blockContent = parsed.body.querySelector("svg,p,section,div,h1,h2,h3,h4,h5,h6,ul,ol,li,table,blockquote,pre,hr");
      if (blockContent && paragraph && paragraph !== editor.node && editor.node.contains(paragraph)) {
        // Split the enclosing paragraph so SVG/blocks are not nested inside it.
        const tail = editor.doc.createRange();
        tail.selectNodeContents(paragraph);
        tail.setStart(range.startContainer, range.startOffset);
        const following = paragraph.cloneNode(false);
        following.removeAttribute("id");
        following.appendChild(tail.extractContents());
        paragraph.after(fragment, following);
      } else {
        range.insertNode(fragment);
      }
      closeModal(false);
      editor.node.focus();
      range.setStartAfter(last);
      range.collapse(true);
      const selection = editor.doc.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editor.node.innerHTML = result.html;
    }
    insertionPoint = null;
    emitEditorEvents(editor.node);
    if (editor.doc && editor.doc !== document) {
      emitEditorEvents(editor.doc);
    }

    setMessage("已写入正文，尚未验证微信保存结果。请保存草稿后重新打开，并检查手机预览。" + (warnings ? "\n" + warnings : ""));
    return true;
  }

  function restoreHtml() {
    const editor = findEditorTarget();
    if (!backup || !editor || editor.node !== backup.node || !backup.node.isConnected || backup.url !== location.href) {
      setMessage("备份不属于当前正文，无法恢复。请返回导入时的文章。", true);
      return;
    }
    if (!confirmFirstOperation(editor, "恢复将替换当前正文，包括导入后手动编辑的内容。是否继续？")) return;
    editor.node.innerHTML = backup.html;
    insertionPoint = null;
    emitEditorEvents(editor.node);
    if (editor.doc !== document) emitEditorEvents(editor.doc);
    backup = null;
    document.getElementById(IDS.restoreBtn).disabled = true;
    setMessage("已恢复本次导入前的正文。请检查并保存草稿。");
  }

  function closeModal(restoreFocus = true) {
    const modal = document.getElementById(IDS.modal);
    if (modal) {
      modal.classList.remove("show");
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    }
  }

  function openModal() {
    ensureModal();
    const modal = document.getElementById(IDS.modal);
    const textarea = document.getElementById(IDS.textarea);
    if (!modal || !textarea) {
      return;
    }

    returnFocus = document.activeElement;
    setMessage(insertionPoint ? "已记住正文位置。粘贴 HTML / SVG 后可插入；选中文字会保留。替换全文需另点对应按钮。" : "先在正文点选位置，再打开此窗口，即可插入 HTML / SVG。也可选择替换全文。不会自动保存或发布。");
    modal.classList.add("show");
    textarea.focus();
  }

  function ensureModal() {
    if (document.getElementById(IDS.modal)) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.id = IDS.modal;
    wrapper.className = "oclaw-modal";
    wrapper.innerHTML = `
      <div class="oclaw-panel" role="dialog" aria-modal="true" aria-label="HTML 源码导入">
        <div class="oclaw-title">HTML 源码导入</div>
        <textarea id="${IDS.textarea}" aria-label="待导入的 HTML 源码" placeholder="在这里粘贴 HTML 源码..."></textarea>
        <div id="${IDS.msg}" class="oclaw-msg" role="status" aria-live="polite"></div>
        <div class="oclaw-footer">
          <a class="oclaw-site-link" href="https://dreamger.com" target="_blank" rel="noopener noreferrer">dreamger.com</a>
          <div class="oclaw-actions">
          <button id="${IDS.readBtn}" type="button">读取当前 HTML</button>
          <button id="${IDS.restoreBtn}" type="button" disabled>恢复操作前正文</button>
          <button id="${IDS.cancelBtn}" type="button">取消</button>
          <button id="${IDS.applyBtn}" type="button">替换全文</button>
          <button id="${IDS.insertBtn}" type="button" class="primary">插入到光标位置</button>
          </div>
        </div>
      </div>
    `;

    wrapper.addEventListener("click", (event) => {
      if (event.target === wrapper) {
        closeModal();
      }
    });

    document.body.appendChild(wrapper);

    const readBtn = document.getElementById(IDS.readBtn);
    const cancelBtn = document.getElementById(IDS.cancelBtn);
    const applyBtn = document.getElementById(IDS.applyBtn);
    const textarea = document.getElementById(IDS.textarea);
    textarea.addEventListener("input", () => {
      const warnings = sanitizeHtml(textarea.value).warnings;
      setMessage(warnings.length ? warnings.join("\n") : "插入保留原文；替换全文或恢复会覆盖正文。本页当前文章仅首次确认，不会自动保存或发布。");
    });
    document.getElementById(IDS.restoreBtn).addEventListener("click", restoreHtml);
    document.getElementById(IDS.insertBtn).addEventListener("click", () => applyHtmlToEditor(textarea.value, true));

    if (readBtn && textarea) {
      readBtn.addEventListener("click", () => {
        const html = readCurrentHtml();
        if (html == null) {
          setMessage("未读取到正文内容，请确认当前页面是图文编辑器。", true);
          return;
        }
        textarea.value = html;
        setMessage("已读取当前编辑区 HTML。");
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", closeModal);
    }

    if (applyBtn && textarea) {
      applyBtn.addEventListener("click", () => {
        applyHtmlToEditor(textarea.value);
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
      }
      if (event.key === "Tab" && wrapper.classList.contains("show")) {
        const controls = [...wrapper.querySelectorAll("a,button,textarea")].filter((node) => !node.disabled);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }

  function findToolbar() {
    return firstVisible([
      ".edui-toolbar",
      ".rich_media_tools",
      ".js_tool_bar",
      ".tool_bar",
      ".frm_editor_wrapper .toolbar"
    ]);
  }

  function createButton() {
    const btn = document.createElement("button");
    btn.id = IDS.button;
    btn.className = "oclaw-html-btn";
    btn.type = "button";
    btn.textContent = "HTML 源码";
    btn.title = "插入 HTML / SVG、读取或替换公众号正文";
    btn.addEventListener("pointerdown", (event) => {
      rememberInsertionPoint();
      event.preventDefault();
    });
    btn.addEventListener("click", openModal);
    return btn;
  }

  function mountButton() {
    watchSelection();
    const toolbar = findToolbar();
    const existing = document.getElementById(IDS.button);
    if (existing && (!toolbar || existing.parentElement === toolbar)) return;
    const btn = existing || createButton();

    if (toolbar) {
      toolbar.appendChild(btn);
      const floatWrap = document.getElementById(IDS.floatWrap);
      if (floatWrap) {
        floatWrap.remove();
      }
      return;
    }

    let floatWrap = document.getElementById(IDS.floatWrap);
    if (!floatWrap) {
      floatWrap = document.createElement("div");
      floatWrap.id = IDS.floatWrap;
      floatWrap.className = "oclaw-float-wrap";
      document.body.appendChild(floatWrap);
    }
    floatWrap.appendChild(btn);
  }

  function boot() {
    ensureModal();
    mountButton();
    document.addEventListener("selectionchange", rememberInsertionPoint);
    document.addEventListener("load", watchSelection, true);

    const observer = new MutationObserver(() => {
      mountButton();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
