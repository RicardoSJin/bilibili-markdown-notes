(function () {
  "use strict";

  const REQUEST = "BILI_MD_PREPARE_IMAGE_UPLOAD";
  const RESULT = "BILI_MD_IMAGE_BRIDGE_RESULT";
  const originalInputClick = HTMLInputElement.prototype.click;
  let pending = null;
  let pendingTimer = null;

  function reply(requestId, status, error = "") {
    window.postMessage({ source: RESULT, requestId, status, error }, "*");
  }

  function fileFromDataUrl(dataUrl, name, mimeType) {
    const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(dataUrl || "");
    if (!match) throw new Error("图片数据格式无效");
    const mime = mimeType && /^image\//.test(mimeType) ? mimeType : match[1];
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], name || "markdown-image", { type: mime, lastModified: Date.now() });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== REQUEST) return;
    const { requestId, dataUrl, name, mimeType } = event.data;
    try {
      clearTimeout(pendingTimer);
      pending = { requestId, file: fileFromDataUrl(dataUrl, name, mimeType) };
      pendingTimer = setTimeout(() => { pending = null; }, 5000);
      reply(requestId, "prepared");
    } catch (error) {
      pending = null;
      reply(requestId, "error", error?.message || "无法准备图片文件");
    }
  });

  HTMLInputElement.prototype.click = function (...args) {
    if (!pending || this.type !== "file" || !String(this.accept || "").includes("image")) {
      return originalInputClick.apply(this, args);
    }

    const current = pending;
    pending = null;
    clearTimeout(pendingTimer);
    try {
      const transfer = new DataTransfer();
      transfer.items.add(current.file);
      this.files = transfer.files;
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      reply(current.requestId, "consumed");
    } catch (error) {
      reply(current.requestId, "error", error?.message || "无法写入 Bilibili 图片输入框");
    }
  };
})();
