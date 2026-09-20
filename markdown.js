(function (root) {
  "use strict";

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  function safeUrl(value) {
    const url = String(value).trim();
    return /^(https?:\/\/|mailto:|#)/i.test(url) ? escapeHtml(url) : "#";
  }

  function inline(source, state) {
    const code = [];
    const images = [];
    const registerImage = (reference, alt) => {
      const index = state.imageRefs.length;
      const ref = String(reference).trim();
      state.imageRefs.push({ kind: "local", ref, alt: String(alt || "").trim() });
      images.push(`<span class="md-image-placeholder" data-bili-md-image="BILI_MD_IMAGE_${index}">⟦BILI_MD_IMAGE_${index}：${escapeHtml(alt || ref)}⟧</span>`);
      return `\u0000IMAGE${images.length - 1}\u0000`;
    };
    let text = String(source).replace(/`([^`]+)`/g, (_, value) => {
      code.push(`<code>${escapeHtml(value)}</code>`);
      return `\u0000CODE${code.length - 1}\u0000`;
    });
    text = text.replace(
      /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|!\[([^\]]*)\]\(([^)]+)\)|(^|[^!])\[\[([^\]|]+\.(?:avif|bmp|gif|jpe?g|png|svg|webp))(?:\|([^\]]+))?\]\]/gim,
      (_, obsidianRef, obsidianAlt, standardAlt, standardRef, prefix, bareRef, bareAlt) => {
        if (obsidianRef !== undefined) return registerImage(obsidianRef, obsidianAlt);
        if (standardRef !== undefined) return registerImage(standardRef, standardAlt);
        return `${prefix}${registerImage(bareRef, bareAlt)}`;
      }
    );
    text = escapeHtml(text);
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${safeUrl(href)}">${label}</a>`);
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    text = text.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    text = text.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    return text
      .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)])
      .replace(/\u0000IMAGE(\d+)\u0000/g, (_, index) => images[Number(index)]);
  }

  function isTableDivider(line) {
    return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
  }

  function tableCells(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  }

  function isTableDataRow(line, columnCount, boundary) {
    const value = String(line || "");
    const trimmed = value.trim();
    if (!trimmed || !trimmed.includes("|") || /^(?:!\[\[|!\[|\[\[)/.test(trimmed)) return false;
    if (boundary.leading && !trimmed.startsWith("|")) return false;
    if (boundary.trailing && !trimmed.endsWith("|")) return false;
    return tableCells(value).length === columnCount;
  }

  function plainTableCell(value) {
    return String(value)
      .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, ref, alt) => alt || ref)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~/g, (_, bold, underlined, struck) => bold || underlined || struck)
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
      .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
      .trim();
  }

  function convert(markdown) {
    let source = String(markdown || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    source = source.replace(/^---\n[\s\S]*?\n---\n/, "");
    const lines = source.split("\n");
    const state = { imageRefs: [] };
    const html = [];
    let paragraph = [];
    let listType = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(...paragraph.map((line) => `<p>${inline(line, state)}</p>`));
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
      if (fence) {
        flushParagraph(); closeList();
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          codeLines.push(lines[index]); index += 1;
        }
        const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
        html.push(`<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        continue;
      }
      if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
        flushParagraph(); closeList();
        const headers = tableCells(line);
        const boundary = {
          leading: line.trim().startsWith("|"),
          trailing: line.trim().endsWith("|")
        };
        index += 2;
        const rows = [];
        while (index < lines.length && isTableDataRow(lines[index], headers.length, boundary)) {
          rows.push(tableCells(lines[index])); index += 1;
        }
        index -= 1;
        const imageIndex = state.imageRefs.length;
        state.imageRefs.push({
          kind: "table",
          ref: `markdown-table-${imageIndex + 1}.png`,
          alt: `Markdown 表格 ${imageIndex + 1}`,
          table: {
            headers: headers.map(plainTableCell),
            rows: rows.map((row) => row.map(plainTableCell))
          }
        });
        html.push(`<p class="md-table-image"><span class="md-image-placeholder" data-bili-md-image="BILI_MD_IMAGE_${imageIndex}">⟦BILI_MD_IMAGE_${imageIndex}：Markdown 表格⟧</span></p>`);
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = heading[1].length;
        if (level === 1) continue;
        const headingSizes = { 2: "24px", 3: "22px", 4: "20px", 5: "18px", 6: "17px" };
        const headingText = inline(heading[2].replace(/\s+#+\s*$/, ""), state);
        html.push(`<p class="md-heading md-heading-${level}"><strong><span style="font-size: ${headingSizes[level]};">${headingText}</span></strong></p>`);
        continue;
      }
      if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(line)) {
        flushParagraph(); closeList(); html.push("<hr>"); continue;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        flushParagraph(); closeList();
        const quoteLines = [quote[1]];
        while (index + 1 < lines.length && /^\s*>\s?/.test(lines[index + 1])) {
          index += 1; quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        }
        html.push(`<blockquote><p>${inline(quoteLines.join("\n"), state).replaceAll("\n", "<br>")}</p></blockquote>`);
        continue;
      }
      const unordered = line.match(/^\s*[-+*]\s+(?:\[([ xX])\]\s+)?(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextType = ordered ? "ol" : "ul";
        if (listType !== nextType) { closeList(); html.push(`<${nextType}>`); listType = nextType; }
        const item = ordered ? ordered[1] : unordered[2];
        const itemLines = [item];
        while (index + 1 < lines.length) {
          const continuation = lines[index + 1];
          if (!/^\s{2,}\S/.test(continuation)) break;
          if (/^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(continuation)) break;
          index += 1;
          itemLines.push(continuation.trim());
        }
        const checkbox = unordered && unordered[1] !== undefined ? `${/[xX]/.test(unordered[1]) ? "☑" : "☐"} ` : "";
        html.push(`<li>${checkbox}${inline(itemLines.join("\n"), state).replaceAll("\n", "<br>")}</li>`);
        continue;
      }
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      closeList();
      paragraph.push(line);
    }
    flushParagraph(); closeList();

    const titleMatch = source.match(/^#\s+(.+)$/m);
    const plainText = source.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    return {
      html: html.join(""),
      plainText,
      title: titleMatch ? titleMatch[1].replace(/\s+#+\s*$/, "").trim() : "",
      images: state.imageRefs.length,
      tables: state.imageRefs.filter((image) => image.kind === "table").length,
      localImages: state.imageRefs.filter((image) => image.kind !== "table").length,
      imageRefs: state.imageRefs,
      characters: plainText.length
    };
  }

  root.BiliMarkdown = { convert };
})(typeof globalThis !== "undefined" ? globalThis : window);
