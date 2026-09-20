const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = { globalThis: {} };
vm.runInNewContext(fs.readFileSync("markdown.js", "utf8"), context);
const { convert } = context.globalThis.BiliMarkdown;

const result = convert(`# 标题\n## 二级\n### 三级\n#### 四级\n##### 五级\n###### 六级\n\n**粗体**和[链接](https://example.com)\n\n- [x] 完成\n- 待办\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`js\nconst x = 1 < 2;\n\`\`\`\n\n![截图](./image.png)\n\n![[img/obsidian.png|Obsidian 图片]]\n\n[[img/bare-wiki.webp]]`);
assert.doesNotMatch(result.html, /md-heading-1|>标题<\/span>/);
assert.match(result.html, /md-heading-2[^>]*><strong><span style="font-size: 24px;">二级/);
assert.match(result.html, /md-heading-3[^>]*><strong><span style="font-size: 22px;">三级/);
assert.match(result.html, /md-heading-4[^>]*><strong><span style="font-size: 20px;">四级/);
assert.match(result.html, /md-heading-5[^>]*><strong><span style="font-size: 18px;">五级/);
assert.match(result.html, /md-heading-6[^>]*><strong><span style="font-size: 17px;">六级/);
assert.match(result.html, /<strong>粗体<\/strong>/);
assert.match(result.html, /href="https:\/\/example\.com"/);
assert.doesNotMatch(result.html, /<table>/);
assert.match(result.html, /<p class="md-table-image"><span[^>]+data-bili-md-image="BILI_MD_IMAGE_0"[^>]*>.*Markdown 表格.*<\/span><\/p>/);
assert.match(result.html, /const x = 1 &lt; 2;/);
assert.equal(result.images, 4);
assert.equal(result.tables, 1);
assert.equal(result.localImages, 3);
assert.equal(result.imageRefs[0].kind, "table");
assert.equal(JSON.stringify(result.imageRefs[0].table.headers), JSON.stringify(["A", "B"]));
assert.equal(JSON.stringify(result.imageRefs[0].table.rows), JSON.stringify([["1", "2"]]));
assert.equal(result.imageRefs[1].ref, "./image.png");
assert.equal(result.imageRefs[2].ref, "img/obsidian.png");
assert.equal(result.imageRefs[3].ref, "img/bare-wiki.webp");
assert.match(result.html, /BILI_MD_IMAGE_0/);
assert.match(result.html, /BILI_MD_IMAGE_1/);
assert.match(result.html, /BILI_MD_IMAGE_2/);
assert.match(result.html, /BILI_MD_IMAGE_3/);
assert.doesNotMatch(result.html, /<\/p>\s+<p/);

const listFollowedByParagraph = convert("- 列表项\n普通段落\n- 新列表项");
assert.match(listFollowedByParagraph.html, /<ul><li>列表项<\/li><\/ul><p>普通段落<\/p><ul><li>新列表项<\/li><\/ul>/);
assert.doesNotMatch(listFollowedByParagraph.html, /<ul>(?:(?!<\/ul>)[\s\S])*?<p>/);
assert.equal(result.title, "标题");

const compactDividerTable = convert("| 字符  |   具名参考    | Unicode 码位 |\n| :-: | :-------: | :--------: |\n|  &  |  `&amp;`  |  U+00026   |");
assert.equal(compactDividerTable.tables, 1);
assert.equal(compactDividerTable.images, 1);
assert.equal(JSON.stringify(compactDividerTable.imageRefs[0].table.headers), JSON.stringify(["字符", "具名参考", "Unicode 码位"]));
assert.equal(JSON.stringify(compactDividerTable.imageRefs[0].table.rows), JSON.stringify([["&", "&amp;", "U+00026"]]));
assert.match(compactDividerTable.html, /data-bili-md-image="BILI_MD_IMAGE_0"/);

const tableFollowedByWikiImage = convert("| 标签        | 作用                       |\n| --------- | ------------------------ |\n| `<table>` | 表格容器标签                   |\n| `<tr>`    | 行标签                      |\n| `<td>`    | 单元格标签,“td”代表“table data” |\n| `<th>`    | 表头单元格                    |\n![[img/Pasted image 20260728192103.png|528]]");
assert.equal(tableFollowedByWikiImage.tables, 1);
assert.equal(tableFollowedByWikiImage.localImages, 1);
assert.equal(tableFollowedByWikiImage.images, 2);
assert.equal(tableFollowedByWikiImage.imageRefs[0].table.rows.length, 4);
assert.equal(tableFollowedByWikiImage.imageRefs[1].ref, "img/Pasted image 20260728192103.png");
assert.equal(tableFollowedByWikiImage.imageRefs[1].alt, "528");
assert.match(tableFollowedByWikiImage.html, /data-bili-md-image="BILI_MD_IMAGE_1"/);

const listContinuation = convert("- `<dt>`\n  定义被描述的术语\n  通常显示为左对齐或加粗\n  一个`<dt>`可以对应多个`<dd>`");
assert.equal(listContinuation.html, "<ul><li><code>&lt;dt&gt;</code><br>定义被描述的术语<br>通常显示为左对齐或加粗<br>一个<code>&lt;dt&gt;</code>可以对应多个<code>&lt;dd&gt;</code></li></ul>");

const consecutiveTextLines = convert("**空连接**\n在HTML中，空连接通常指的是没有实际指向目标的超链接，符号是#\n**下载链接**\n如果是exe或者压缩包点击是下载");
assert.equal(consecutiveTextLines.html, "<p><strong>空连接</strong></p><p>在HTML中，空连接通常指的是没有实际指向目标的超链接，符号是#</p><p><strong>下载链接</strong></p><p>如果是exe或者压缩包点击是下载</p>");

const unsafe = convert("[危险](javascript:alert(1)) <script>alert(1)</script>");
assert.match(unsafe.html, /href="#"/);
assert.doesNotMatch(unsafe.html, /<script>/);

console.log("markdown conversion tests passed");
