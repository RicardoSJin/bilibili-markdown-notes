(function () {
  "use strict";

  const elements = {
    fileInput: document.querySelector("#fileInput"),
    dropZone: document.querySelector("#dropZone"),
    documentCard: document.querySelector("#documentCard"),
    fileName: document.querySelector("#fileName"),
    stats: document.querySelector("#stats"),
    changeFile: document.querySelector("#changeFile"),
    warning: document.querySelector("#warning"),
    imageControls: document.querySelector("#imageControls"),
    imageFolderInput: document.querySelector("#imageFolderInput"),
    manualImageInput: document.querySelector("#manualImageInput"),
    selectImageFolder: document.querySelector("#selectImageFolder"),
    imageMatchStatus: document.querySelector("#imageMatchStatus"),
    missingImageList: document.querySelector("#missingImageList"),
    previewSection: document.querySelector("#previewSection"),
    preview: document.querySelector("#preview"),
    controls: document.querySelector("#controls"),
    insertMode: document.querySelector("#insertMode"),
    insertButton: document.querySelector("#insertButton"),
    copyButton: document.querySelector("#copyButton"),
    status: document.querySelector("#status")
  };
  let converted = null;
  let imageFiles = [];
  let imageMatches = new Map();
  let manualImageMatches = new Map();
  let generatedImageMatches = new Map();
  let pendingManualImageIndex = null;
  let imageDirectories = new Set();
  let markdownFileName = "";

  function setStatus(message, kind = "") {
    elements.status.textContent = message;
    elements.status.className = `status ${kind}`.trim();
  }

  function normalizeImagePath(value) {
    let path = String(value || "").trim().replace(/^<|>$/g, "");
    try { path = decodeURIComponent(path); } catch (_error) { /* Keep the original path. */ }
    return path
      .replace(/[?#].*$/, "")
      .replace(/^file:\/+/i, "")
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .toLowerCase();
  }

  function isImageFile(file) {
    return /^image\//.test(file.type) || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);
  }

  function resolveRelativePath(baseDirectory, reference) {
    const parts = `${baseDirectory}/${reference}`.split("/");
    const resolved = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") resolved.pop();
      else resolved.push(part);
    }
    return resolved.join("/");
  }

  function matchImageFiles() {
    imageMatches = new Map(generatedImageMatches);
    for (const [index, file] of manualImageMatches) imageMatches.set(index, file);
    if (!converted?.imageRefs?.length || !imageFiles.length) return;

    const candidates = imageFiles.filter(isImageFile).map((file) => ({
      file,
      path: normalizeImagePath(file.webkitRelativePath || file.name),
      name: normalizeImagePath(file.name)
    }));
    const markdownCandidates = imageFiles.filter((file) => file.name.toLowerCase() === markdownFileName.toLowerCase());
    const markdownPath = markdownCandidates.length === 1
      ? normalizeImagePath(markdownCandidates[0].webkitRelativePath || markdownCandidates[0].name)
      : "";
    const markdownDirectory = markdownPath.includes("/") ? markdownPath.slice(0, markdownPath.lastIndexOf("/")) : "";

    converted.imageRefs.forEach((image, index) => {
      if (image.kind === "table") return;
      if (imageMatches.has(index)) return;
      const ref = normalizeImagePath(image.ref);
      const resolvedRef = markdownDirectory ? resolveRelativePath(markdownDirectory, ref) : "";
      let matches = candidates.filter((candidate) =>
        candidate.path === ref || candidate.path.endsWith(`/${ref}`) || (resolvedRef && candidate.path === resolvedRef)
      );
      if (!matches.length) {
        const basename = ref.split("/").pop();
        matches = candidates.filter((candidate) => candidate.name === basename);
      }
      if (matches.length === 1) imageMatches.set(index, matches[0].file);
    });
  }

  function renderImageMatchStatus() {
    if (!converted?.images) {
      elements.imageControls.hidden = true;
      return;
    }
    elements.imageControls.hidden = false;
    const generated = converted.tables || 0;
    const localTotal = converted.localImages ?? (converted.images - generated);
    const matchedLocal = [...imageMatches.keys()].filter((index) => converted.imageRefs[index]?.kind !== "table").length;
    const manual = [...manualImageMatches.keys()].filter((index) => imageMatches.has(index)).length;
    const directoryText = imageDirectories.size ? `；已添加 ${imageDirectories.size} 个目录` : "";
    const tableText = generated ? `；已生成 ${generated} 张表格图片` : "";
    elements.imageMatchStatus.textContent = `本地图片已匹配 ${matchedLocal}/${localTotal} 张（自动 ${matchedLocal - manual}，手动 ${manual}）${tableText}${directoryText}${matchedLocal < localTotal ? "；请为未匹配项添加目录或手动选图" : "，写入时会自动上传"}`;

    elements.missingImageList.replaceChildren();
    converted.imageRefs.forEach((image, index) => {
      if (image.kind === "table") return;
      if (imageMatches.has(index)) return;
      const row = document.createElement("div");
      row.className = "missing-image-row";
      const path = document.createElement("code");
      path.textContent = image.ref;
      path.title = image.ref;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "手动选择";
      button.addEventListener("click", () => {
        pendingManualImageIndex = index;
        elements.manualImageInput.value = "";
        elements.manualImageInput.click();
      });
      row.append(path, button);
      elements.missingImageList.append(row);
    });
  }

  function yieldToUi() {
    return new Promise((resolve) => {
      if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  function wrapCanvasText(context, value, maxWidth, characterWidthCache) {
    const lines = [];
    for (const paragraph of String(value || "").split("\n")) {
      if (!paragraph) {
        lines.push("");
        continue;
      }
      let line = "";
      let lineWidth = 0;
      for (const character of [...paragraph]) {
        let characterWidth = characterWidthCache.get(character);
        if (characterWidth === undefined) {
          characterWidth = context.measureText(character).width;
          characterWidthCache.set(character, characterWidth);
        }
        if (line && lineWidth + characterWidth > maxWidth) {
          lines.push(line);
          line = character;
          lineWidth = characterWidth;
        } else {
          line += character;
          lineWidth += characterWidth;
        }
      }
      lines.push(line);
    }
    return lines.length ? lines : [""];
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("浏览器无法生成表格图片"));
      }, "image/png");
    });
  }

  async function renderTableFile(image, index) {
    const headers = image.table?.headers || [];
    const rows = image.table?.rows || [];
    const columnCount = Math.max(1, headers.length, ...rows.map((row) => row.length));
    const allRows = [headers, ...rows].map((row) => Array.from({ length: columnCount }, (_, column) => row[column] || ""));
    const measuringCanvas = document.createElement("canvas");
    const measuringContext = measuringCanvas.getContext("2d");
    if (!measuringContext) throw new Error("浏览器不支持 Canvas 表格渲染");
    measuringContext.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif';

    const paddingX = 16;
    const paddingY = 12;
    const lineHeight = 23;
    const columnWidths = Array.from({ length: columnCount }, (_, column) => {
      const naturalWidth = Math.max(...allRows.map((row) => measuringContext.measureText(row[column]).width));
      return Math.ceil(Math.min(320, Math.max(100, naturalWidth + paddingX * 2)));
    });
    const characterWidthCache = new Map();
    const wrappedRows = [];
    for (let rowIndex = 0; rowIndex < allRows.length; rowIndex += 1) {
      const row = allRows[rowIndex];
      wrappedRows.push(row.map((cell, column) => wrapCanvasText(measuringContext, cell, columnWidths[column] - paddingX * 2, characterWidthCache)));
      if (rowIndex > 0 && rowIndex % 40 === 0) await yieldToUi();
    }
    const rowHeights = wrappedRows.map((row) => Math.max(...row.map((lines) => lines.length)) * lineHeight + paddingY * 2);
    const logicalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + 1;
    const logicalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + 1;
    const pixelRatio = logicalHeight > 7000 || logicalWidth > 3000 ? 1 : 2;
    const canvas = document.createElement("canvas");
    canvas.width = logicalWidth * pixelRatio;
    canvas.height = logicalHeight * pixelRatio;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas 表格渲染");
    context.scale(pixelRatio, pixelRatio);
    context.font = measuringContext.font;
    context.textBaseline = "top";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, logicalWidth, logicalHeight);

    let y = 0;
    for (let rowIndex = 0; rowIndex < wrappedRows.length; rowIndex += 1) {
      const row = wrappedRows[rowIndex];
      const rowHeight = rowHeights[rowIndex];
      context.fillStyle = rowIndex === 0 ? "#eaf7ff" : (rowIndex % 2 === 0 ? "#f8fafc" : "#ffffff");
      context.fillRect(0, y, logicalWidth, rowHeight);
      let x = 0;
      row.forEach((lines, column) => {
        context.fillStyle = "#202020";
        context.font = `${rowIndex === 0 ? "600 " : ""}15px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`;
        lines.forEach((line, lineIndex) => context.fillText(line, x + paddingX, y + paddingY + lineIndex * lineHeight));
        context.strokeStyle = "#b8c2cc";
        context.lineWidth = 1;
        context.strokeRect(x + 0.5, y + 0.5, columnWidths[column], rowHeight);
        x += columnWidths[column];
      });
      y += rowHeight;
      if (rowIndex > 0 && rowIndex % 40 === 0) await yieldToUi();
    }

    const blob = await canvasToPngBlob(canvas);
    return new File([blob], image.ref || `markdown-table-${index + 1}.png`, { type: "image/png", lastModified: Date.now() });
  }

  async function buildGeneratedTableFiles() {
    const generated = new Map();
    if (!converted?.imageRefs?.length) return generated;
    for (let index = 0; index < converted.imageRefs.length; index += 1) {
      const image = converted.imageRefs[index];
      if (image.kind === "table") {
        await yieldToUi();
        generated.set(index, await renderTableFile(image, index));
      }
    }
    return generated;
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result), { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error(`无法读取图片：${file.name}`)), { once: true });
      reader.readAsDataURL(file);
    });
  }

  async function buildImagePayloads(batchId) {
    const payloads = [];
    for (const [index, file] of imageMatches) {
      payloads.push({
        index,
        token: `BILI_MD_IMAGE_${batchId}_${index}`,
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl: await readAsDataUrl(file)
      });
    }
    return payloads;
  }

  async function queryActiveTab() {
    if (globalThis.browser?.tabs?.query) {
      const tabs = await globalThis.browser.tabs.query({ active: true, currentWindow: true });
      return tabs[0];
    }
    if (!globalThis.chrome?.tabs?.query) {
      throw new Error("标签页 API 不可用。请从扩展管理页重新加载插件，不要直接打开 popup.html");
    }
    return new Promise((resolve, reject) => {
      globalThis.chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const runtimeError = globalThis.chrome.runtime?.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(tabs?.[0]);
      });
    });
  }

  async function sendToTab(tabId, message) {
    if (globalThis.browser?.tabs?.sendMessage) {
      return globalThis.browser.tabs.sendMessage(tabId, message);
    }
    if (!globalThis.chrome?.tabs?.sendMessage) {
      throw new Error("标签页消息 API 不可用。请重新加载插件");
    }
    return new Promise((resolve, reject) => {
      globalThis.chrome.tabs.sendMessage(tabId, message, (response) => {
        const runtimeError = globalThis.chrome.runtime?.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(response);
      });
    });
  }

  async function autoOpenNoteEditor() {
    try {
      const tab = await queryActiveTab();
      if (!tab?.id || !/^https:\/\/www\.bilibili\.com\/video\//.test(tab.url || "")) return;
      const response = await sendToTab(tab.id, { type: "BILI_MD_OPEN_NOTE" });
      if (!response?.ok) throw new Error(response?.error || "页面未响应");
      if (response.opened) setStatus("已自动打开“记笔记”，请选择 Markdown 文件。", "success");
    } catch (error) {
      const detail = /Receiving end does not exist/i.test(error?.message || "")
        ? "请刷新 Bilibili 页面后重新打开插件"
        : error?.message;
      setStatus(`未能自动打开“记笔记”：${detail || "未知错误"}`, "error");
    }
  }

  async function loadFile(file) {
    if (!file) return;
    if (!/\.(md|markdown)$/i.test(file.name) && !/^text\//.test(file.type)) {
      setStatus("请选择 .md 或 .markdown 文件。", "error");
      return;
    }
    try {
      const markdown = await file.text();
      converted = BiliMarkdown.convert(markdown);
      markdownFileName = file.name;
      imageFiles = [];
      imageMatches = new Map();
      manualImageMatches = new Map();
      generatedImageMatches = new Map();
      pendingManualImageIndex = null;
      imageDirectories = new Set();
      elements.imageFolderInput.value = "";
      elements.manualImageInput.value = "";
      if (converted.tables) {
        setStatus(`正在生成 ${converted.tables} 张表格图片，请稍候……`);
        await yieldToUi();
      }
      generatedImageMatches = await buildGeneratedTableFiles();
      matchImageFiles();
      elements.fileName.textContent = file.name;
      elements.stats.textContent = `${converted.characters.toLocaleString()} 字符${converted.title ? ` · 标题：${converted.title}` : ""}`;
      elements.preview.innerHTML = converted.html || "<p>（空文档）</p>";
      elements.warning.hidden = converted.images === 0;
      const tableNotice = converted.tables ? `检测到 ${converted.tables} 个 Markdown 表格，已在内存中生成 PNG 图片；` : "";
      const localImageNotice = converted.localImages ? `检测到 ${converted.localImages} 张本地图片，可添加图片目录自动匹配，剩余图片可逐项手动选择。` : "";
      elements.warning.textContent = `${tableNotice}${localImageNotice}`;
      elements.dropZone.hidden = true;
      elements.documentCard.hidden = false;
      elements.previewSection.hidden = false;
      elements.controls.hidden = false;
      renderImageMatchStatus();
      setStatus("转换完成。可写入 Bilibili 笔记正文，或复制富文本后手动粘贴。", "success");
    } catch (error) {
      setStatus(`读取失败：${error?.message || "未知错误"}`, "error");
    }
  }

  async function copyRichText() {
    if (!converted) return;
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const item = new ClipboardItem({
          "text/html": new Blob([converted.html], { type: "text/html" }),
          "text/plain": new Blob([converted.plainText], { type: "text/plain" })
        });
        await navigator.clipboard.write([item]);
      } else {
        const holder = document.createElement("div");
        holder.contentEditable = "true";
        holder.style.position = "fixed";
        holder.style.opacity = "0";
        holder.innerHTML = converted.html;
        document.body.append(holder);
        const selection = getSelection();
        selection.selectAllChildren(holder);
        if (!document.execCommand("copy")) throw new Error("浏览器拒绝了复制操作");
        holder.remove();
      }
      setStatus("已复制富文本，请回到 Bilibili 编辑器粘贴。", "success");
    } catch (error) {
      setStatus(`复制失败：${error?.message || "请检查剪贴板权限"}`, "error");
    }
  }

  async function insertIntoPage() {
    if (!converted) return;
    elements.insertButton.disabled = true;
    try {
      const tab = await queryActiveTab();
      if (!tab?.id || !/^https:\/\/(www|member)\.bilibili\.com\//.test(tab.url || "")) {
        throw new Error("当前标签页不是受支持的 Bilibili 页面");
      }
      const batchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const html = converted.html.replaceAll("BILI_MD_IMAGE_", `BILI_MD_IMAGE_${batchId}_`);
      const images = await buildImagePayloads(batchId);
      if (images.length) setStatus(`正在写入正文并上传 ${images.length} 张图片，请勿关闭弹窗……`);
      const response = await sendToTab(tab.id, {
        type: "BILI_MD_INSERT",
        html,
        plainText: converted.plainText,
        mode: elements.insertMode.value,
        images
      });
      if (!response?.ok) throw new Error(response?.error || "页面未响应");
      const uploaded = response.images?.uploaded || 0;
      const failed = response.images?.failed || 0;
      const firstImageError = response.images?.errors?.find(Boolean) || "";
      const imageSummary = response.images?.total
        ? ` 已上传 ${uploaded} 张图片${failed ? `，${failed} 张失败并保留占位文字（原因：${firstImageError || "未知"}）` : ""}。`
        : "";
      setStatus(`内容已写入编辑器。${imageSummary}请检查排版后再发布。`, failed ? "error" : "success");
    } catch (error) {
      const detail = /Receiving end does not exist/i.test(error?.message || "")
        ? "请刷新 Bilibili 页面后重试。"
        : error?.message;
      setStatus(`写入失败：${detail || "未知错误"} 可改用“复制富文本”。`, "error");
    } finally {
      elements.insertButton.disabled = false;
    }
  }

  elements.fileInput.addEventListener("change", () => loadFile(elements.fileInput.files[0]));
  elements.changeFile.addEventListener("click", () => elements.fileInput.click());
  elements.selectImageFolder.addEventListener("click", () => elements.imageFolderInput.click());
  elements.imageFolderInput.addEventListener("change", () => {
    const additions = [...elements.imageFolderInput.files];
    const merged = new Map(imageFiles.map((file) => [
      `${file.webkitRelativePath || file.name}|${file.size}|${file.lastModified}`,
      file
    ]));
    for (const file of additions) {
      const key = `${file.webkitRelativePath || file.name}|${file.size}|${file.lastModified}`;
      merged.set(key, file);
      const directory = String(file.webkitRelativePath || "").split("/")[0];
      if (directory) imageDirectories.add(directory);
    }
    imageFiles = [...merged.values()];
    elements.imageFolderInput.value = "";
    matchImageFiles();
    renderImageMatchStatus();
  });
  elements.manualImageInput.addEventListener("change", () => {
    const file = elements.manualImageInput.files[0];
    if (file && isImageFile(file) && pendingManualImageIndex !== null) {
      manualImageMatches.set(pendingManualImageIndex, file);
      matchImageFiles();
      renderImageMatchStatus();
    }
    pendingManualImageIndex = null;
  });
  elements.copyButton.addEventListener("click", copyRichText);
  elements.insertButton.addEventListener("click", insertIntoPage);
  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.add("dragging"); });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.remove("dragging"); });
  }
  elements.dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
  autoOpenNoteEditor();
})();
