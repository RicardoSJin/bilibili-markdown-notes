(function () {
  "use strict";

  let lastEditable = null;
  let lastRange = null;

  function isEditable(element) {
    return element instanceof HTMLElement && (
      element.isContentEditable ||
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement && /^(text|search|url)$/i.test(element.type))
    );
  }

  function editableAncestor(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest?.('[contenteditable]:not([contenteditable="false"]), textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"]') || null;
  }

  function isBilibiliQuillEditor(element) {
    return element instanceof HTMLElement && element.matches('.ql-editor[contenteditable="true"]');
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function findBilibiliQuillEditor(active) {
    if (isBilibiliQuillEditor(active) && isVisible(active)) return active;
    if (isBilibiliQuillEditor(lastEditable) && lastEditable.isConnected && isVisible(lastEditable)) return lastEditable;

    const editors = [...document.querySelectorAll('.ql-editor[contenteditable="true"]')].filter(isVisible);
    if (editors.length === 1) return editors[0];

    const toolbar = document.querySelector('#web-toolbar.ql-toolbar.ql-snow');
    if (toolbar) {
      let container = toolbar.parentElement;
      for (let depth = 0; container && depth < 5; depth += 1, container = container.parentElement) {
        const nearby = editors.find((editor) => container.contains(editor));
        if (nearby) return nearby;
      }
    }
    return null;
  }

  document.addEventListener("focusin", (event) => {
    const editable = editableAncestor(event.target);
    if (isEditable(editable)) lastEditable = editable;
  }, true);

  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const editable = editableAncestor(range.commonAncestorContainer);
    if (isEditable(editable)) {
      lastEditable = editable;
      lastRange = range.cloneRange();
    }
  });

  function dispatchInput(target, inputType) {
    target.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType,
      data: null
    }));
  }

  function insertIntoTextField(target, text, replace) {
    const start = replace ? 0 : (target.selectionStart ?? target.value.length);
    const end = replace ? target.value.length : (target.selectionEnd ?? start);
    target.focus();
    target.setRangeText(text, start, end, "end");
    dispatchInput(target, replace ? "insertReplacementText" : "insertText");
  }

  function insertIntoContentEditable(target, html, replace) {
    const wasBlank = target.classList.contains("ql-blank");
    const beforeHtml = target.innerHTML;
    target.focus();
    const selection = document.getSelection();
    if (replace) {
      selection.selectAllChildren(target);
    } else if (lastRange && target.contains(lastRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(lastRange);
    } else {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const insertedByCommand = document.execCommand("insertHTML", false, html);
    if (!insertedByCommand) {
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      if (!range) throw new Error("无法定位编辑器光标");
      range.deleteContents();
      const fragment = range.createContextualFragment(html);
      const tail = fragment.lastChild;
      range.insertNode(fragment);
      if (tail) {
        range.setStartAfter(tail); range.collapse(true);
        selection.removeAllRanges(); selection.addRange(range);
      }
    }
    dispatchInput(target, replace ? "insertReplacementText" : "insertFromPaste");

    const hasContent = target.textContent.trim().length > 0 || Boolean(target.querySelector("img, video, iframe, hr"));
    if (html && wasBlank && target.classList.contains("ql-blank") && target.innerHTML === beforeHtml && !hasContent) {
      throw new Error("Bilibili 编辑器未接受写入，请改用“复制富文本”后手动粘贴");
    }
  }

  function prepareImageUpload(image) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("图片上传桥接器未响应，请刷新 Bilibili 页面后重试"));
      }, 3000);
      function onMessage(event) {
        if (event.source !== window || event.data?.source !== "BILI_MD_IMAGE_BRIDGE_RESULT" || event.data.requestId !== image.token) return;
        if (event.data.status !== "prepared" && event.data.status !== "error") return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (event.data.status === "error") reject(new Error(event.data.error || "无法准备图片上传"));
        else resolve();
      }
      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "BILI_MD_PREPARE_IMAGE_UPLOAD",
        requestId: image.token,
        dataUrl: image.dataUrl,
        name: image.name,
        mimeType: image.mimeType
      }, "*");
    });
  }

  function findImagePlaceholder(editor, token) {
    const byAttribute = editor.querySelector(`[data-bili-md-image="${CSS.escape(token)}"]`);
    if (byAttribute) return { element: byAttribute };

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.data.indexOf(token);
      if (start !== -1) return { node, start, end: start + token.length };
    }
    return null;
  }

  function stripAdjacentWikiBrackets(editor, token) {
    const placeholder = findImagePlaceholder(editor, token);
    if (!placeholder) return;
    let changed = false;

    if (placeholder.element) {
      const previous = placeholder.element.previousSibling;
      const next = placeholder.element.nextSibling;
      if (previous?.nodeType === Node.TEXT_NODE && /!?\[\[\s*$/.test(previous.data)) {
        previous.data = previous.data.replace(/!?\[\[\s*$/, "");
        changed = true;
      }
      if (next?.nodeType === Node.TEXT_NODE && /^\s*\]\]/.test(next.data)) {
        next.data = next.data.replace(/^\s*\]\]/, "");
        changed = true;
      }
    } else if (placeholder.node) {
      const before = placeholder.node.data.slice(0, placeholder.start);
      const markerAndAfter = placeholder.node.data.slice(placeholder.start);
      const cleanedBefore = before.replace(/!?\[\[\s*(⟦?)$/, "$1");
      const cleanedAfter = markerAndAfter.replace(new RegExp(`(${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^⟧]*⟧)\\s*\\]\\]`), "$1");
      if (cleanedBefore !== before || cleanedAfter !== markerAndAfter) {
        placeholder.node.data = cleanedBefore + cleanedAfter;
        changed = true;
      }
    }

    if (changed) dispatchInput(editor, "deleteContent");
  }

  function placeCaretBeforePlaceholder(editor, token) {
    const placeholder = findImagePlaceholder(editor, token);
    if (!placeholder) throw new Error("Quill 重绘后未找到图片占位位置");
    const range = document.createRange();
    if (placeholder.element?.parentNode && editor.contains(placeholder.element)) {
      range.setStartBefore(placeholder.element);
    } else if (placeholder.node?.parentNode && editor.contains(placeholder.node)) {
      const markerStart = placeholder.node.data.lastIndexOf("⟦", placeholder.start);
      range.setStart(placeholder.node, markerStart === -1 ? placeholder.start : markerStart);
    } else {
      throw new Error("图片占位节点已被 Quill 替换，请重试");
    }
    range.collapse(true);
    const selection = document.getSelection();
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function removeImagePlaceholder(editor, token) {
    const placeholder = findImagePlaceholder(editor, token);
    if (!placeholder) return;
    const range = document.createRange();
    if (placeholder.element) {
      range.selectNode(placeholder.element);
    } else {
      const value = placeholder.node.data;
      const open = value.lastIndexOf("⟦", placeholder.start);
      const close = value.indexOf("⟧", placeholder.end);
      range.setStart(placeholder.node, open === -1 ? placeholder.start : open);
      range.setEnd(placeholder.node, close === -1 ? placeholder.end : close + 1);
    }
    const selection = document.getSelection();
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false);
    dispatchInput(editor, "deleteContent");
  }

  function waitForUploadedImage(editor, existing, timeoutMs = 45000) {
    const findUploaded = () => [...editor.querySelectorAll('.ql-image-preview.uploaded[data-id]')]
      .find((element) => !existing.has(element) && element.querySelector('img[src*="/x/note/image"]'));
    const immediate = findUploaded();
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const uploaded = findUploaded();
        if (!uploaded) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(uploaded);
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("等待 Bilibili 图片上传超时"));
      }, timeoutMs);
      observer.observe(editor, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "src", "data-id"] });
    });
  }

  async function uploadImages(editor, images) {
    const toolbarButton = document.querySelector('#web-toolbar .ql-image[type="button"]');
    if (!toolbarButton) throw new Error("未找到 Bilibili 上传图片按钮（.ql-image）");
    const results = [];

    for (const image of images) {
      try {
        await prepareImageUpload(image);
        stripAdjacentWikiBrackets(editor, image.token);
        const existing = new Set(editor.querySelectorAll('.ql-image-preview.uploaded[data-id]'));
        placeCaretBeforePlaceholder(editor, image.token);
        const uploaded = waitForUploadedImage(editor, existing);
        toolbarButton.click();
        await uploaded;
        removeImagePlaceholder(editor, image.token);
        results.push({ token: image.token, ok: true });
      } catch (error) {
        results.push({ token: image.token, ok: false, error: error?.message || "图片上传失败" });
      }
    }
    return results;
  }

  async function handleInsert(message) {
    const active = editableAncestor(document.activeElement);
    const quillEditor = findBilibiliQuillEditor(active);
    const target = quillEditor || (isEditable(lastEditable) && lastEditable.isConnected ? lastEditable : active);
    if (!isEditable(target)) throw new Error("未找到 Bilibili 笔记正文（.ql-editor）。请先打开笔记编辑器。");

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      insertIntoTextField(target, message.plainText, message.mode === "replace");
      return { ok: true, editor: "focused-editable" };
    }

    insertIntoContentEditable(target, message.html, message.mode === "replace");
    const imageResults = quillEditor && message.images?.length ? await uploadImages(quillEditor, message.images) : [];
    return {
      ok: true,
      editor: quillEditor ? "bilibili-quill" : "focused-editable",
      images: {
        total: imageResults.length,
        uploaded: imageResults.filter((result) => result.ok).length,
        failed: imageResults.filter((result) => !result.ok).length,
        errors: imageResults.filter((result) => !result.ok).map((result) => result.error)
      }
    };
  }

  function waitForVisibleQuillEditor(timeoutMs = 8000) {
    const findEditor = () => [...document.querySelectorAll('.ql-editor[contenteditable="true"]')].find(isVisible);
    const immediate = findEditor();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const editor = findEditor();
        if (!editor) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(editor);
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("点击“记笔记”后未检测到编辑器"));
      }, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function findVisibleNoteOperation() {
    return [...document.querySelectorAll('.list-note-operation')]
      .find((element) => {
        if (!isVisible(element)) return false;
        const label = element.querySelector('.operation-desc')?.textContent.trim();
        return label === "记笔记" || label === "查看我的笔记";
      });
  }

  function waitForNoteStage(timeoutMs = 8000) {
    const findStage = () => {
      const editor = [...document.querySelectorAll('.ql-editor[contenteditable="true"]')].find(isVisible);
      if (editor) return { editor };
      const operation = findVisibleNoteOperation();
      return operation ? { operation } : null;
    };
    const immediate = findStage();
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const stage = findStage();
        if (!stage) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(stage);
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("点击视频笔记入口后，既未检测到编辑器，也未检测到“记笔记”或“查看我的笔记”操作"));
      }, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function openNoteEditor() {
    if (findBilibiliQuillEditor(document.activeElement)) return { ok: true, alreadyOpen: true };
    const noteButton = [...document.querySelectorAll('.video-note-inner')]
      .find(isVisible);
    if (!noteButton) throw new Error("未找到视频工具栏中的笔记入口");
    noteButton.click();
    const stage = await waitForNoteStage();
    if (stage.editor) return { ok: true, opened: true, path: "direct" };

    stage.operation.click();
    await waitForVisibleQuillEditor();
    return { ok: true, opened: true, path: "notes-list" };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BILI_MD_OPEN_NOTE") {
      openNoteEditor()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error?.message || "无法打开记笔记页面" }));
      return true;
    }
    if (message?.type !== "BILI_MD_INSERT") return false;
    handleInsert(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || "写入失败" }));
    return true;
  });
})();
