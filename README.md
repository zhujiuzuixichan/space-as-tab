# Keep Spaces

一个 Obsidian 插件：让**行首输入的 4 个及以上空格保持普通空格**，不被 Obsidian 识别成「缩进」（不会出现缩进参考线、缩进代码块等结构化效果）；同时**完全保留 Tab 键的原生缩进功能**。

An Obsidian plugin that keeps leading spaces (4+) as plain spaces — no indent guide, no indented code block — while **leaving the Tab key's native indentation untouched**.

[English](#english) · [中文](#中文)

---

<a name="english"></a>
## English

### What it does

Obsidian (Markdown) treats a line starting with 4+ spaces or a tab as an "indented" structure, showing an indent guide and rendering it as an indented code block. This plugin inserts an invisible zero-width non-joiner (ZWNJ, `U+200C`) at the start of lines whose indentation is made of spaces. That breaks the Markdown indent rule while keeping the visible indentation.

### Features

- **Keeps spaces as spaces**: leading 4+ spaces no longer trigger indent guides or indented code blocks.
- **Tab is untouched**: the Tab key's native indentation keeps working exactly as before.
- **Toggle** in settings (on by default), applied immediately and saved to `data.json`.
- **Smart exclusions**: list items, blockquotes, fenced code blocks, and YAML frontmatter are left alone.

### Installation

**Manual install**:

1. Download `main.js` and `manifest.json` from the latest [Release](https://github.com/zhujiuzuixichan/space-as-tab/releases).
2. Create a folder `space-as-tab` inside `<your-vault>/.obsidian/plugins/`.
3. Copy `main.js` and `manifest.json` into it.
4. In Obsidian: `Settings → Community plugins`, disable "Restricted mode", enable "Keep Spaces".

### Usage

Works out of the box. Type 4 spaces at the start of a line → the text shifts right as plain spaces, no indent guide, no code block. Press Tab → normal indentation. Toggle off in `Settings → Keep Spaces` to revert.

### Build

```bash
npm install
npm run build   # tsc type-check + esbuild bundle into main.js
npm run dev     # watch mode
```

> `@codemirror/state` and `@codemirror/view` are provided by Obsidian itself, so they are marked `external` and not bundled.

---

<a name="中文"></a>
## 中文

### 它做什么

Obsidian（Markdown）会把「行首 4 个空格或 1 个 Tab」开头的行识别成缩进结构——显示缩进参考线，并渲染成缩进代码块。本插件在**由空格构成缩进**的行首插入一个不可见的零宽不连字符（ZWNJ，`U+200C`），打破这条 Markdown 规则，同时保留视觉上的缩进。

### 功能

- **空格保持空格**：行首 4+ 空格不再触发缩进参考线或缩进代码块。
- **Tab 完全不受影响**：Tab 键的原生缩进功能原样保留。
- **开关控制**（默认开启），修改后立即生效并保存到 `data.json`。
- **智能排除**：列表项、引用、围栏代码块、YAML frontmatter 内的缩进不受影响。

### 安装

1. 从最新 [Release](https://github.com/zhujiuzuixichan/space-as-tab/releases) 下载 `main.js` 和 `manifest.json`。
2. 在 `<你的仓库>/.obsidian/plugins/` 下新建文件夹 `space-as-tab`。
3. 把 `main.js` 和 `manifest.json` 复制进去。
4. Obsidian 中：`设置 → 第三方插件`，关闭「受限模式」，启用 "Keep Spaces"。

### 使用

装好即生效：行首输入 4 个空格 → 文字以普通空格右移，无缩进参考线、无代码块。按 Tab → 正常缩进。想恢复原样，打开 `设置 → Keep Spaces` 关掉开关即可。

### 构建

```bash
npm install
npm run build   # 先 tsc 类型检查，再用 esbuild 打包生成 main.js
npm run dev     # 监听模式
```

---

## 实现要点 / Implementation Notes

- 通过 `registerEditorExtension` 注册 CodeMirror 6 扩展，用 `EditorView.updateListener` 监听编辑变化：
  - 检测「行首 4+ 空格」的行，在行首插入零宽字符（`U+200C`）打破缩进识别；
  - 只匹配空格（`/^ {4}/`），**不匹配 Tab**，因此 Tab 键缩进完全保留。
- 用 `Annotation` 标记插件自己产生的事务，避免死循环；检测到用户主动删除零宽字符（退格）时不重新插回。
- 保留一层「事务纠正」兜底：若仍有「空格被转成 Tab 字符」的变化，立即换回空格。
- 排除列表项（`-` / `*` / `1.`）、引用（`>`）、围栏代码块（```` ``` ```` / `~~~`）、YAML frontmatter。

## 注意事项 / Caveat

零宽字符方案会在文档中留下**不可见字符**（与社区 `Indent` 插件做法一致）。复制文本时会一并带上，一般无感知；若用其他工具严格处理文本时需留意。
