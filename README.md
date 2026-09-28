# Space as Tab

一个 Obsidian 插件，让用户自行选择「输入 N 个空格（默认 4）」是否等价于一个 Tab 缩进。

An Obsidian plugin that lets you choose whether typing N consecutive spaces (default 4) is equivalent to pressing Tab.

[English](#english) · [中文](#中文)

---

<a name="english"></a>
## English

### Features

- **Toggle switch** in settings: "N spaces equal a Tab".
- **Instant effect + persistence**: changes apply immediately without reloading, and are saved to the plugin's `data.json`.
- **Space handling**: when enabled, typing N consecutive spaces (default 4) at the start of a line is automatically converted into a single Tab character.
- **Tab key handling**: when enabled, the Tab key inserts a Tab character in leading whitespace, keeping behavior consistent with the space conversion.
- **Never touches existing content**: conversion only fires on spaces you are currently typing; existing indentation is never scanned or rewritten. Multi-line selection indent, list indent, and table navigation fall back to Obsidian's default behavior.

### Installation

**From the community plugin store** (once published): search "Space as Tab" in Community plugins.

**Manual install**:

1. Build the plugin (see [Build](#build)).
2. Create a folder `space-as-tab` inside `<your-vault>/.obsidian/plugins/`.
3. Copy `main.js` and `manifest.json` into it.
4. In Obsidian: `Settings → Community plugins`, disable "Restricted mode", enable "Space as Tab".

### Usage

1. Open `Settings → Space as Tab`.
2. Enable "Four spaces equal a Tab".
3. In the editor, at the start of a line, type 4 spaces → they collapse into one Tab. Pressing Tab does the same. Disable the toggle to keep spaces as-is.

### Build

```bash
npm install
npm run build   # runs tsc type-check, then bundles with esbuild into main.js
npm run dev     # watch mode
```

> `@codemirror/state` and `@codemirror/view` are provided by Obsidian itself, so they are marked `external` in `esbuild.config.mjs` and are not bundled.

### Releasing

Releases are built automatically by GitHub Actions when you push a tag.

```bash
npm version patch   # or minor / major — bumps manifest.json & versions.json
git push
git push --tags     # triggers the CI workflow, which creates the GitHub Release
```

To publish to the Obsidian community store, submit a PR to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) adding your repository.

---

<a name="中文"></a>
## 中文

### 功能

- **开关控制**：设置面板提供「N 个空格等价于一个 Tab」开关，以及「一个 Tab 对应的空格数」配置。
- **即时生效 + 持久化**：修改设置后无需重启、无需重载立即生效，并自动保存到插件目录的 `data.json`。
- **空格处理**：开启后，在行首缩进区连续输入 N 个空格（默认 4）会自动转换为一个 Tab 字符。
- **Tab 键处理**：开启后，Tab 键在行首空白区直接插入一个 Tab 字符，与空格转换结果保持一致。
- **不影响已有内容**：仅在用户「正在输入」时空格触发转换，绝不扫描或改写文档中已存在的缩进；多行选区块缩进、列表缩进、表格跳格等高级行为交回 Obsidian 默认处理。

### 安装

**社区市场安装**（发布后）：在「第三方插件」里搜索 "Space as Tab"。

**手动安装**：

1. 构建插件（见[构建](#构建)）。
2. 在 `<你的仓库>/.obsidian/plugins/` 下新建文件夹 `space-as-tab`。
3. 把 `main.js` 和 `manifest.json` 复制进去。
4. Obsidian 中：`设置 → 第三方插件`，关闭「受限模式」，启用 "Space as Tab"。

### 使用

1. 打开 `设置 → Space as Tab`。
2. 勾选「四个空格等价于一个 Tab」。
3. 编辑器里光标置于行首，连敲 4 次空格 → 变为一个 Tab 缩进；按 Tab 键效果相同。关闭开关后空格保持原样。

### 构建

```bash
npm install
npm run build   # 先 tsc 类型检查，再用 esbuild 打包生成 main.js
npm run dev     # 监听模式
```

> `@codemirror/state`、`@codemirror/view` 由 Obsidian 自身提供，因此在 `esbuild.config.mjs` 中被标记为 `external`，不打包进 `main.js`。

### 发布

推送 tag 后，GitHub Actions 会自动构建并创建 Release。

```bash
npm version patch   # 或 minor / major —— 自动更新 manifest.json 与 versions.json
git push
git push --tags     # 触发 CI 工作流，生成 GitHub Release
```

发布到 Obsidian 社区市场：向 [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 提交 PR，加入你的仓库。

---

## 项目结构 / Project Structure

```
SpaceToTab/
├── main.ts                    # 插件核心逻辑（编辑器扩展 + 设置面板）
├── manifest.json              # 插件清单
├── package.json               # 依赖与构建脚本
├── tsconfig.json              # TypeScript 编译配置
├── esbuild.config.mjs         # esbuild 打包配置
├── version-bump.mjs           # 版本号自动更新脚本
├── versions.json              # 版本 → minAppVersion 映射（供社区市场更新判断）
├── .github/workflows/release.yml   # CI：打 tag 自动构建 Release
├── LICENSE
└── README.md
```

## 实现要点 / Implementation Notes

- 通过 `registerEditorExtension` 注册 CodeMirror 6 扩展：
  - `EditorView.inputHandler` 拦截空格输入；
  - `keymap` + `Prec.highest` 拦截 Tab 键。
- 扩展内的处理函数在**调用时**实时读取 `plugin.settings`，因此设置修改后立即生效。
- 空格转换仅在「行首缩进区（纯空格/Tab）」且「凑满一个 Tab 宽度」时触发，避免影响正文中的空格。
