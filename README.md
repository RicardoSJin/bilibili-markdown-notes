# Markdown 转 Bilibili 笔记

一个无需联网的 Chrome / Edge Manifest V3 扩展。它读取本地 Markdown 文件，将内容转换成富文本，再写入 Bilibili 的 Quill 笔记正文；也可以只复制富文本后手动粘贴。

当前版本：`0.9.0`

## 安装

1. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`）。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录 `bilibili-markdown-notes`。
4. 安装或更新扩展后，刷新已经打开的 Bilibili 页面。

## 使用

1. 打开 Bilibili 视频页面并点击浏览器工具栏中的扩展图标。插件会先点击可见的 `.video-note-inner`：若按钮为“记笔记”则直接等待编辑器；若按钮显示“4篇笔记”等已有笔记数量，则在笔记列表中继续点击 `.list-note-operation` 内文字为“记笔记”或“查看我的笔记”的操作。编辑器已经打开时不会重复点击。
2. 插件会通过 `.ql-editor[contenteditable="true"]` 定位正文；如需在光标处插入，请先点击正文中的目标位置。
3. 选择或拖入本地 `.md` / `.markdown` 文件。
4. Markdown 表格会直接在浏览器内存中生成为 PNG，无需选择目录，也不会在磁盘留下临时文件。检测到其他本地图片时，可反复点击“添加图片目录”；来自不同目录的授权文件会合并，插件优先按 Markdown 相对路径匹配，其次按唯一文件名匹配。
5. 对仍未匹配或存在同名歧义的引用，点击该路径旁的“手动选择”，为这一条引用指定图片。
6. 检查预览，选择“在光标处插入”或“替换编辑器内容”。
7. 点击“写入 Bilibili 笔记正文”。插件会通过 Bilibili 自身的图片上传入口逐张上传匹配成功的图片；未匹配图片保留占位文字。
8. 检查最终排版，再由你手动保存或发布。

## 支持范围

- Markdown H1 只用于识别笔记名，不写入正文；正文标题加粗并映射为 Bilibili 支持的字号：H2 `24px`、H3 `22px`、H4 `20px`、H5 `18px`、H6 `17px`
- 粗体、斜体、删除线、行内代码、链接
- 连续普通文本行会转换为独立段落，避免 Bilibili 编辑器清理软换行后把相邻内容合并
- 有序列表、无序列表、任务列表；列表项下方连续缩进的说明行会保留为该列表项内的换行
- 引用、分隔线、代码块；Markdown 表格会在内存中分批渲染为带表头、网格线和自动换行的 PNG，并通过 Bilibili 图片入口插入原位置；兼容标准分隔行和 `:-:` 这类短分隔写法，并能正确区分紧随表格的 Obsidian 图片尺寸语法
- 标准图片语法 `![说明](img/example.png)`、Obsidian 图片语法 `![[img/example.png]]`，以及带图片扩展名的 `[[img/example.png]]`
- YAML front matter 自动忽略

浏览器不会允许扩展仅凭 Markdown 路径读取未授权的磁盘文件，因此至少需要主动添加一个图片目录，或为未匹配引用手动选择图片。插件只读取本次明确授权的目录和文件，并只上传与 Markdown 引用绑定的图片。

## 安全与权限

- 转换和表格图片生成完全在浏览器内存中完成，不访问任何第三方 API，也不会创建需要清理的临时文件夹。
- 内容脚本只运行于 `www.bilibili.com` 与 `member.bilibili.com`。
- `tabs` 权限用于确定当前 Bilibili 标签页并向该页的内容脚本发送写入请求。
- 图片文件只发送到当前 Bilibili 页面，并交给站点原生上传逻辑处理。
- 扩展不会点击发布按钮，也不会读取登录凭证、Cookie 或请求头。

## 验证

在本目录执行：

```powershell
node test-markdown.js
```

该测试覆盖常用 Markdown 转换、三类本地图片语法与基础 HTML / URL 安全处理。当前 DOM 契约为工具栏 `#web-toolbar.ql-toolbar.ql-snow`、正文 `.ql-editor[contenteditable="true"]`、上传按钮 `.ql-image`，并以新增的 `.ql-image-preview.uploaded[data-id] img[src*="/x/note/image"]` 作为单张图片上传成功信号。程序化上传仍需在已登录的真实页面中验证。
