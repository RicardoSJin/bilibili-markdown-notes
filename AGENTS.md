# AGENTS.md

Markdown 转 Bilibili 笔记：一个 Chrome / Edge Manifest V3 扩展。在弹窗里读取本地 Markdown 文件，转换成富文本 HTML，写入 Bilibili 视频笔记的 Quill 编辑器；Markdown 表格在内存中渲染成 PNG，本地图片由用户授权目录或手动选择后，借 Bilibili 自己的图片上传入口逐张上传。也可以只"复制富文本"后手动粘贴。

## 技术栈与约束

- 纯 JavaScript（经典脚本 + IIFE，不是 ES Module），**无依赖、无构建步骤、无 `package.json`**；仓库根目录就是可直接"加载已解压的扩展程序"的扩展目录
- 没有 background / service worker，也不持久化任何状态（不用 `chrome.storage`），关闭弹窗即丢失本次转换结果
- 权限只有 `activeTab`、`tabs`、`clipboardWrite`；没有 `host_permissions`，内容脚本只注入 `www.bilibili.com` 和 `member.bilibili.com`
- 用到 content script 的 `"world": "MAIN"`，`manifest.json` 没写 `minimum_chrome_version`（❓实际最低版本未核实）
- 界面文字、状态提示和报错信息都是中文

## 目录结构

| 文件 | 作用 |
|---|---|
| `manifest.json` | 版本号、权限、两个内容脚本的注入配置 |
| `popup.html` / `popup.css` / `popup.js` | 工具栏弹窗：选择 / 拖入 Markdown、预览、图片目录与手动选图、表格转 PNG、复制富文本、向页面发送写入请求 |
| `markdown.js` | Markdown → HTML 转换器，纯函数、不碰 DOM，挂在 `globalThis.BiliMarkdown.convert`；弹窗和 Node 测试共用 |
| `content.js` | 内容脚本（隔离环境，`document_idle`）：打开笔记编辑器、定位 Quill 正文、写入 HTML、驱动图片上传 |
| `page-bridge.js` | 内容脚本（页面主环境 `MAIN`，`document_start`）：劫持 `HTMLInputElement.prototype.click`，把准备好的图片塞进 Bilibili 的文件选择框 |
| `test-markdown.js` | `markdown.js` 的断言测试（`node:vm` 加载 + `node:assert`） |
| `README.md` | 面向用户的中文说明（安装、使用、支持范围、安全与权限、DOM 契约） |
| `.gitignore` | 忽略 `*.zip`、`.DS_Store`、`Thumbs.db` |

## 常用命令

在仓库根目录执行（以下命令均已在 macOS + Node 24 上验证）：

| 用途 | 命令 |
|---|---|
| 测试 | `node test-markdown.js` → 输出 `markdown conversion tests passed`。**必须在仓库根目录运行**，脚本按相对路径读取 `markdown.js` |
| 语法检查（没有配置 lint） | `for f in *.js; do node --check "$f"; done` |
| 查看版本 | `node -p "require('./manifest.json').version"` |
| 打包（macOS，生成的文件列表与 v0.9.0 发布包一致） | `mkdir -p dist && zip -X -j dist/bilibili-markdown-notes.zip manifest.json content.js markdown.js page-bridge.js popup.html popup.js popup.css README.md test-markdown.js` |

- 仓库里没有打包脚本；v0.9.0 的发布包 `bilibili-markdown-notes.zip` 是 9 个文件直接放在 ZIP 根目录（含 `README.md` 和 `test-markdown.js`），文件名不带版本号。新增运行时文件时要同步加进打包清单
- `*.zip` 已被 `.gitignore` 忽略，打包产物不会进入版本库
- 测试只覆盖 `markdown.js`；`popup.js`（图片匹配、表格绘制）、`content.js`、`page-bridge.js` 没有自动化测试，必须在已登录的真实 Bilibili 页面手动验证

## 本地调试

1. `chrome://extensions`（或 `edge://extensions`）开启开发者模式 →"加载已解压的扩展程序"→ 选仓库根目录
2. 改了 `content.js` / `page-bridge.js` / `manifest.json`：在扩展页点"重新加载"，**再刷新已打开的 Bilibili 页面**（内容脚本只在页面加载时注入）。弹窗报 "Receiving end does not exist" 就是页面没刷新
3. 改了 `popup.*` / `markdown.js`：重新打开弹窗即可；弹窗的控制台在弹窗上右键 →"检查"
4. 内容脚本的日志在 Bilibili 页面的 DevTools 里看（控制台上下文切到本扩展可看 `content.js`；`page-bridge.js` 在页面主环境 `top`）
5. 不要直接用文件路径打开 `popup.html`：没有 `chrome.tabs`，`popup.js` 会报"标签页 API 不可用"
6. 弹窗预览里表格和图片只显示 `⟦BILI_MD_IMAGE_…⟧` 占位文字，生成的表格 PNG 只有写入 Bilibili 后才能看到

## 架构要点

### 消息流：popup ↔ content.js ↔ page-bridge.js

- **popup → content.js**：`chrome.tabs.sendMessage`（若存在 `browser.tabs` 则优先用它），两种消息：
  - `BILI_MD_OPEN_NOTE`：弹窗一打开就自动发送，只在当前标签页 URL 匹配 `https://www.bilibili.com/video/` 时发
  - `BILI_MD_INSERT`：`{ html, plainText, mode: "append" | "replace", images: [{ index, token, name, mimeType, dataUrl }] }`，只允许 `https://(www|member).bilibili.com/` 的标签页；所有图片以 data URL 放在同一条消息里（图片很多很大时是否会碰到扩展消息大小上限 ❓未实测）
  - content.js 返回 `{ ok, error?, editor, images: { total, uploaded, failed, errors } }`，弹窗据此显示结果
- **content.js ↔ page-bridge.js**：`window.postMessage`（同一窗口，校验 `event.source === window`）
  - 请求 `{ source: "BILI_MD_PREPARE_IMAGE_UPLOAD", requestId, dataUrl, name, mimeType }`
  - 回复 `{ source: "BILI_MD_IMAGE_BRIDGE_RESULT", requestId, status: "prepared" | "consumed" | "error", error }`；content.js 等 `prepared` 最多 3 秒
- **为什么要有 page-bridge**：隔离环境里的内容脚本改不了页面自己的 JS 原型，无法拦截 Bilibili 代码里的 `input.click()`。page-bridge 在页面主环境、`document_start`（早于站点脚本）保存原始 `click` 并替换：只有存在一个已准备好的文件（5 秒内有效、只用一次），且被点击的是 `type="file"`、`accept` 含 `image` 的输入框时，才用 `DataTransfer` 设置 `files` 并派发 `input` / `change`，不弹系统文件框；其余情况一律调用原始 `click`。`File` 对象也在主环境里由 data URL 重建
- 这套机制的前提是 Bilibili 的 `.ql-image` 按钮处理器会创建图片 `<input type="file">` 并调用 `.click()`（代码按此设计，❓未在本机实测）

### Markdown 转换（`markdown.js`）

- 逐行扫描的手写解析器，输出 `{ html, plainText, title, images, tables, localImages, imageRefs, characters }`；`plainText` 是去掉 YAML front matter 后的原始 Markdown，用于普通文本框写入和剪贴板 `text/plain`
- 块级：围栏代码块（仅 ` ``` `，不认 `~~~`；未闭合会吞掉后面所有内容）、表格、ATX 标题、分隔线、引用（连续 `>` 行合并、`<br>` 换行）、有序 / 无序 / 任务列表（`☑` / `☐`）、段落
- H1 不写入正文，第一个 `# ` 只作为 `title` 显示在弹窗；H2–H6 输出为 `<p class="md-heading-N"><strong><span style="font-size: …">`，字号 24 / 22 / 20 / 18 / 17px
- 每个非空普通行单独成一个 `<p>`（Bilibili 会清理软换行，合并成一段会粘连）
- 列表：不支持嵌套，缩进的子项会被拉平到同一层；列表项后连续缩进 ≥2 空格的非列表行作为该项内的 `<br>` 续行；`<ol>` 不保留起始编号
- 行内：行内代码、粗体（`**` / `__`）、斜体（`*` / `_`）、删除线、`[文字](链接)`。不支持嵌套强调、引用式链接、Setext 标题、自动链接；`_` 斜体会误伤 `snake_case`
- 图片三种写法：`![说明](路径)`、`![[路径|说明]]`、带图片扩展名的 `[[路径.png]]`。每张图和每个表格按出现顺序登记进 `imageRefs`（共用一个序号），正文里放占位 `<span class="md-image-placeholder" data-bili-md-image="BILI_MD_IMAGE_<序号>">⟦BILI_MD_IMAGE_<序号>：说明⟧</span>`。`![说明](路径 "标题")` 的标题会被并进路径，导致匹配不上
- 表格：某行含 `|` 且下一行是分隔行（兼容 `:-:` 短写法）即开始；后续行必须含 `|`、列数与表头相同、首尾竖线与表头一致，且不以 `![[` / `![` / `[[` 开头（这样紧跟表格的 Obsidian 图片尺寸写法不会被当成表格行）。不支持 `\|` 转义。单元格去掉行内标记成纯文本，存进 `imageRefs` 的 `kind: "table"` 项

### 表格转 PNG（`popup.js` 的 `renderTableFile`）

- 载入 Markdown 后立即为每个表格用 `<canvas>` 绘制：15px 系统字体、列宽 100–320px、逐字符测宽换行（带缓存）、表头加粗浅蓝底、隔行底色、灰色网格线
- 默认 2 倍像素密度，逻辑高度 > 7000 或宽度 > 3000 时降为 1 倍；每 40 行用 `requestAnimationFrame` 让出一次 UI
- `canvas.toBlob` 生成 `File`（`markdown-table-<序号>.png`，只在内存里），作为该占位的已匹配图片，和本地图片走同一条上传流程

### 本地图片匹配（`popup.js` 的 `matchImageFiles`）

- 图片来源只有两种：`<input webkitdirectory>`（"添加图片目录"，可多次添加，按 `相对路径|大小|修改时间` 去重合并）和每个未匹配引用旁的"手动选择"。手动选择优先于自动匹配
- 路径归一化：去 `<>`、URL 解码、去 `?` / `#` 后缀、去 `file://`、反斜杠转 `/`、去开头 `./` 和 `/`、**转小写**
- 匹配顺序：①相对路径——文件路径等于引用、以 `/引用` 结尾，或等于按 Markdown 所在目录解析 `../` 后的路径（只有当已添加目录中恰好有一个与 Markdown 同名的文件时才能确定其目录）；②都没有时按文件名匹配。**候选必须唯一**，有歧义就当作未匹配，留给手动选择
- 未匹配的图片不上传，正文里保留占位文字

### 写入 Quill 编辑器与上传图片（`content.js`）

- **定位正文**：当前焦点 → 最近一次聚焦的可编辑元素 → 页面上唯一可见的 `.ql-editor[contenteditable="true"]` → 多个时取 `#web-toolbar.ql-toolbar.ql-snow` 往上 5 层祖先内的那个。都找不到时退回任意可编辑元素：`textarea` / `input` 写 `plainText`，其他 contenteditable 写 HTML 但不上传图片
- **记住光标**：监听 `focusin` 和 `selectionchange` 保存最后的可编辑元素和选区，因为打开弹窗时页面会失焦。"在光标处插入"恢复该选区（不在编辑器内则插到末尾）；"替换编辑器内容"全选正文
- **写入**：`document.execCommand("insertHTML")`，失败时退回 `Range.insertNode`；随后派发 `input` 事件。写入后编辑器仍是 `.ql-blank` 且内容没变时报错，提示改用复制富文本
- **令牌**：弹窗写入前把 `BILI_MD_IMAGE_` 换成 `BILI_MD_IMAGE_<时间戳_随机串>_`，保证多次写入的占位不冲突
- **上传（逐张串行）**：通知 page-bridge 准备文件 → 删掉占位两侧残留的 `[[` / `]]` → 记录已有的 `.ql-image-preview.uploaded[data-id]` → 光标放到占位前 → 点击 `#web-toolbar .ql-image[type="button"]` → 用 `MutationObserver` 等一个新的 `.ql-image-preview.uploaded[data-id]` 且其中有 `img[src*="/x/note/image"]`（最多 45 秒）→ 选中占位并 `execCommand("delete")`。单张失败只记录错误、保留占位，继续下一张
- **找占位**：先按 `data-bili-md-image` 属性找；Quill 重绘后属性可能丢失，再在文本节点里找令牌字符串，用 `⟦` / `⟧` 确定删除范围

### 打开笔记编辑器（`content.js` 的 `openNoteEditor`）

1. 已能定位到 Quill 正文时什么都不做
2. 点击第一个可见的 `.video-note-inner`（视频工具栏里的笔记入口）
3. 最多等 8 秒：出现可见编辑器即完成；或出现可见的 `.list-note-operation`，其 `.operation-desc` 文字为"记笔记"或"查看我的笔记"（已有笔记时会先显示列表），点击它后再最多等 8 秒编辑器出现

## 脆弱点

全部依赖 Bilibili 的页面结构和文案，站点改版最先坏在这里。改动时同步更新 `README.md`"验证"一节的 DOM 契约：

| 依赖 | 位置 | 用途 |
|---|---|---|
| `.video-note-inner` | `content.js` `openNoteEditor` | 视频页笔记入口 |
| `.list-note-operation` + `.operation-desc` 文案"记笔记" / "查看我的笔记" | `content.js` `findVisibleNoteOperation` | 已有笔记时的列表操作 |
| `.ql-editor[contenteditable="true"]` | `content.js` `isBilibiliQuillEditor`、`findBilibiliQuillEditor`、`waitForVisibleQuillEditor`、`waitForNoteStage` | 笔记正文 |
| `#web-toolbar.ql-toolbar.ql-snow` | `content.js` `findBilibiliQuillEditor` | 多个编辑器时挑正文 |
| `.ql-blank` | `content.js` `insertIntoContentEditable` | 判断写入是否被编辑器拒绝 |
| `#web-toolbar .ql-image[type="button"]` | `content.js` `uploadImages` | 图片上传按钮 |
| `.ql-image-preview.uploaded[data-id]` 内含 `img[src*="/x/note/image"]` | `content.js` `waitForUploadedImage` | 单张上传成功信号 |
| 图片按钮内部调用 `<input type="file" accept="image…">.click()` | `page-bridge.js` | 拦截文件选择框 |
| URL `https://www.bilibili.com/video/`、`https://(www\|member).bilibili.com/` | `popup.js` `autoOpenNoteEditor`、`insertIntoPage` | 自动打开 / 允许写入的页面 |

- 超时都是写死的：桥接准备 3 秒、待用文件 5 秒、单张上传 45 秒、打开编辑器每步 8 秒
- 文本回退查找占位用 `indexOf`，`BILI_MD_IMAGE_<批次>_1` 是 `…_10` 的前缀；改令牌格式或查找逻辑时注意
- `member.bilibili.com` 在注入范围和允许写入范围内，但那里是否有对应的笔记编辑器 ❓未核实
- 写入过程中关闭弹窗会丢失结果提示（界面提示"请勿关闭弹窗"）；内容脚本是否会继续上传完 ❓未实测

## 安全与隐私约束（不要放宽）

- 不发起任何网络请求（代码中没有 `fetch` / `XMLHttpRequest`），不调用第三方 API；转换和表格绘制只在内存中完成，不写临时文件
- 不读取 Cookie、登录凭证或请求头，不持久化任何用户数据
- 不点击保存 / 发布按钮：只点击笔记入口、笔记列表操作和图片上传按钮，最终由用户检查后手动保存
- 只读取用户在弹窗里明确选择的文件和目录，不要尝试按 Markdown 路径直接读取磁盘；只上传与 Markdown 引用绑定（自动唯一匹配或手动指定）的图片和生成的表格 PNG
- `markdown.js` 必须先 `escapeHtml` 再加标记，不放行原始 HTML；链接只允许 `http(s)://`、`mailto:`、`#`，其他一律变成 `#`。输出会进弹窗的 `innerHTML` 和 Bilibili 页面的 `insertHTML`
- `page-bridge.js` 只在"有一次性待用文件 + 图片文件输入框"时拦截，其他 `click` 原样放行；不要扩大拦截范围，也不要通过 `postMessage` 通道传图片以外的数据（同窗口消息页面脚本也能看到）
- 不要增加 `host_permissions`、扩大内容脚本的 `matches` 或新增权限，除非功能确实需要并同步更新 `README.md` 的"安全与权限"

## 开发流程

- 仓库目前只有一个初始提交（`942e946 Initial release of Bilibili Markdown Notes`），没有 PR 和功能分支记录，分支命名尚无先例 ❓（同作者的 `github-extension-loader` 仓库用 `codex/<功能描述>` 分支 + PR 合并到 `main`，可参照）
- 发布（按 v0.9.0 的做法）：更新 `manifest.json` 的 `version` 和 `README.md` 里的"当前版本" → `node test-markdown.js` → 打包 → 在 `main` 上创建 GitHub Release `v<版本>`，附件 `bilibili-markdown-notes.zip`，中文发布说明
- 修改行为时同步更新 `README.md`（使用步骤、支持范围、DOM 契约）；改 `markdown.js` 时在 `test-markdown.js` 里补断言

## 编码风格

- 每个文件一个 IIFE + `"use strict"`；双引号、分号、2 空格缩进；保持紧凑写法（短函数，简单语句可同行，如 `flushParagraph(); closeList();`）
- `markdown.js` 保持纯函数、不碰 DOM、不用 `require` / `import`，通过 `globalThis.BiliMarkdown` 导出，这样弹窗（`<script>`）和 Node 测试（`vm.runInNewContext`）都能加载
- 消息类型统一用 `BILI_MD_` 前缀；错误统一转成中文消息，经 `sendResponse({ ok: false, error })` 或弹窗 `setStatus(…, "error")` 显示
- 弹窗里显示用户提供的路径等内容用 `textContent`；`innerHTML` 只用于已转义的转换结果
- 不引入框架、依赖或构建工具
