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
    cancelBtn: "oclaw-html-source-cancel-btn"
  };

  function isVisible(el) {
    if (!el) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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
          if (isVisible(iframe) || isVisible(doc.body)) {
            return { node: doc.body, doc };
          }
        } catch (_err) {
          // Skip non-accessible iframe.
        }
      }
    }

    const editable = firstVisible(
      [
        ".rich_media_editor [contenteditable='true']",
        ".js_editor_area [contenteditable='true']",
        "[contenteditable='true']"
      ],
      document
    );

    if (editable) {
      return { node: editable, doc: document };
    }
    return null;
  }

  function sanitizeHtml(rawHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");

    doc
      .querySelectorAll(
        "script,iframe,object,embed,base,meta[http-equiv='refresh']"
      )
      .forEach((el) => el.remove());

    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        }
      }
    });

    return doc.body.innerHTML;
  }

  function emitEditorEvents(target) {
    ["input", "change", "keyup", "blur"].forEach((evtName) => {
      target.dispatchEvent(new Event(evtName, { bubbles: true }));
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

  function applyHtmlToEditor(rawHtml) {
    const editor = findEditorTarget();
    if (!editor) {
      setMessage("未找到公众号正文编辑区，请先进入图文编辑页面。", true);
      return false;
    }

    const safeHtml = sanitizeHtml(rawHtml || "");
    editor.node.innerHTML = safeHtml;
    emitEditorEvents(editor.node);
    if (editor.doc && editor.doc !== document) {
      emitEditorEvents(editor.doc);
    }

    setMessage("HTML 已导入，当前已回到可视化预览状态。");
    return true;
  }

  function closeModal() {
    const modal = document.getElementById(IDS.modal);
    if (modal) {
      modal.classList.remove("show");
    }
  }

  function openModal() {
    ensureModal();
    const modal = document.getElementById(IDS.modal);
    const textarea = document.getElementById(IDS.textarea);
    if (!modal || !textarea) {
      return;
    }

    setMessage("把 HTML 粘贴进来后点击“导入并预览”。");
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
        <textarea id="${IDS.textarea}" placeholder="在这里粘贴 HTML 源码..."></textarea>
        <div id="${IDS.msg}" class="oclaw-msg">把 HTML 粘贴进来后点击“导入并预览”。</div>
        <div class="oclaw-footer">
          <a class="oclaw-site-link" href="https://dreamger.com" target="_blank" rel="noopener noreferrer">dreamger.com</a>
          <div class="oclaw-actions">
          <button id="${IDS.readBtn}" type="button">读取当前 HTML</button>
          <button id="${IDS.cancelBtn}" type="button">取消</button>
          <button id="${IDS.applyBtn}" type="button" class="primary">导入并预览</button>
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
        const ok = applyHtmlToEditor(textarea.value);
        if (ok) {
          setTimeout(closeModal, 220);
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
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
    btn.title = "粘贴 HTML 源码并恢复可视化预览";
    btn.addEventListener("click", openModal);
    return btn;
  }

  function mountButton() {
    if (document.getElementById(IDS.button)) {
      return;
    }

    const toolbar = findToolbar();
    const btn = createButton();

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
