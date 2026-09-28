# Keep Spaces

一个 Obsidian 插件：**屏蔽 Obsidian 原生「输入空格自动转 Tab」的行为**，让你输入 4 个空格就还是 4 个空格，不被自动转成 Tab。

An Obsidian plugin that **disables Obsidian's native auto-conversion of typed spaces to Tab**, so your spaces stay spaces.

[English](#english) · [中文](#中文)

---

<a name="english"></a>
## English

### What it does

Obsidian, when "Indent using tabs" is enabled, may automatically convert leading spaces you type into Tab characters. This plugin intercepts the space key and inserts a plain space instead, so spaces always stay spaces.

### Features

- **Toggle** in settings: "Disable auto space→Tab conversion" (on by default).
- **Instant effect + persistence**: changes apply immediately without reloading, saved to `data.json`.
- **No effect on existing content**: only affects spaces you type; existing text is never scanned or rewritten.

### Installation

**Manual install**:

1. Download `main.js` and `manifest.json` from the latest [Release](https://github.com/zhujiuzuixichan/space-as-tab/releases).
2. Create a folder `space-as-tab` inside `<your-vault>/.obsidian/plugins/`.
3. Copy `main.js` and `manifest.json` into it.
4. In Obsidian: `Settings → Community plugins`, disable "Restricted mode", enable "Keep Spaces".

### Usage

The plugin works out of the box. Type 4 spaces → they stay 4 spaces. To revert to Obsidian's default, open `Settings → Keep Spaces` and turn off the toggle.

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

Obsidian 在「使用制表符」开启时，可能把你输入的行首空格自动转换为 Tab。本插件拦截空格键，改为插入普通空格，让空格始终是空格。

### 功能

- **开关**：设置面板提供「屏蔽空格自动转 Tab」开关（默认开启）。
- **即时生效 + 持久化**：修改后无需重载立即生效，并保存到 `data.json`。
- **不影响已有内容**：只影响你正在输入的空格，绝不扫描或改写已有文本。

### 安装

1. 从最新 [Release](https://github.com/zhujiuzuixichan/space-as-tab/releases) 下载 `main.js` 和 `manifest.json`。
2. 在 `<你的仓库>/.obsidian/plugins/` 下新建文件夹 `space-as-tab`。
3. 把 `main.js` 和 `manifest.json` 复制进去。
4. Obsidian 中：`设置 → 第三方插件`，关闭「受限模式」，启用 "Keep Spaces"。

### 使用

装好即生效：输入 4 个空格，就还是 4 个空格。想恢复 Obsidian 原生行为，打开 `设置 → Keep Spaces` 关掉开关即可。

### 构建

```bash
npm install
npm run build   # 先 tsc 类型检查，再用 esbuild 打包生成 main.js
npm run dev     # 监听模式
```

---

## 实现要点 / Implementation Notes

- 通过 `registerEditorExtension` 注册 CodeMirror 6 扩展，用**最高优先级**（`Prec.highest`）拦截空格：
  - `keymap` 拦截 `Space` 键（keydown 阶段，最根因）；
  - `EditorView.inputHandler` 拦截空格文本输入（input 阶段，兜底）。
- 两个 handler 都在开关开启时手动插入一个普通空格并返回 `true`，从而阻止 Obsidian 后续的空格→Tab 转换。
- 处理函数在**调用时**实时读取 `plugin.settings`，因此设置修改后立即生效。
- 空格键在中文输入法组合（IME composition）期间不会被拦截，不影响正常输入。
