import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EditorView } from "@codemirror/view";
import { Annotation, Text, type Extension } from "@codemirror/state";

/**
 * 插件设置结构。
 * - keepSpacesAsSpaces：是否让「输入的空格」保持普通空格（不触发缩进识别）
 */
interface KeepSpacesSettings {
  keepSpacesAsSpaces: boolean;
}

const DEFAULT_SETTINGS: KeepSpacesSettings = {
  keepSpacesAsSpaces: true,
};

/** 零宽不连接符：插入在行首可打破 Markdown 的「缩进」识别，但视觉上不可见 */
const ZWNJ = "\u200C";

/** 用于标记本插件自己产生的更正事务，避免死循环 */
const Correction = Annotation.define<boolean>();

export default class KeepSpacesPlugin extends Plugin {
  settings: KeepSpacesSettings;

  async onload() {
    await this.loadSettings();
    this.registerEditorExtension(this.buildEditorExtension());
    this.addSettingTab(new KeepSpacesSettingTab(this.app, this));
  }

  onunload() {}

  buildEditorExtension(): Extension {
    const plugin = this;

    // 核心方案：行首插入零宽字符，打破 Markdown 对「空格缩进」的识别。
    // 仅处理「4 个及以上空格」开头的行，不碰 Tab 缩进，因此 Tab 键的
    // 原生缩进功能完全保留。
    const zwnjApplier = EditorView.updateListener.of((update) => {
      if (!plugin.settings.keepSpacesAsSpaces) {
        return;
      }
      // 跳过本插件自己的事务，避免死循环
      if (update.transactions.some((tr) => tr.annotation(Correction))) {
        return;
      }

      // 若用户主动删除了 ZWNJ（退格），本次不再插回，尊重用户操作
      let zwnjDeleted = false;
      const touchedLines = new Set<number>();
      for (const tr of update.transactions) {
        if (!tr.docChanged) {
          continue;
        }
        tr.changes.iterChanges((fromA, toA, _f, _t) => {
          const del = tr.startState.doc.sliceString(fromA, toA);
          if (del.includes(ZWNJ)) {
            zwnjDeleted = true;
          }
        });
        tr.changes.iterChangedRanges((_a, _b, fromB, toB) => {
          const start = update.state.doc.lineAt(fromB).number;
          const end = update.state.doc.lineAt(toB).number;
          for (let n = start; n <= end; n++) {
            touchedLines.add(n);
          }
        });
      }
      if (zwnjDeleted) {
        return;
      }

      const doc = update.state.doc;
      const insertions: number[] = [];
      for (const lineNumber of touchedLines) {
        if (lineNumber < 1 || lineNumber > doc.lines) {
          continue;
        }
        const line = doc.line(lineNumber);
        if (lineNeedsZWNJ(doc, lineNumber, line.text)) {
          insertions.push(line.from);
        }
      }

      if (insertions.length > 0) {
        const view = update.view;
        setTimeout(() => {
          view.dispatch({
            changes: insertions.map((from) => ({ from, insert: ZWNJ })),
            annotations: Correction.of(true),
          });
        }, 0);
      }
    });

    // 兜底纠正：若仍有「空格被转成 Tab 字符」的变化，立即换回空格
    const corrector = EditorView.updateListener.of((update) => {
      if (!plugin.settings.keepSpacesAsSpaces) {
        return;
      }
      if (update.transactions.some((tr) => tr.annotation(Correction))) {
        return;
      }

      let fix: { from: number; to: number; insert: string } | null = null;

      for (const tr of update.transactions) {
        if (!tr.docChanged) {
          continue;
        }
        tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
          if (fix) {
            return;
          }
          const ins = inserted.toString();
          const del = tr.startState.doc.sliceString(fromA, toA);
          // 判定：删除了「含空格的纯空白」，插入了「含 Tab 的纯空白」
          if (
            /^[ \t]*$/.test(del) &&
            /^[ \t]*$/.test(ins) &&
            del.includes(" ") &&
            ins.includes("\t")
          ) {
            // 把 Tab 换回原本删除的空格（保持用户输入的空格数）
            fix = { from: fromB, to: toB, insert: del };
          }
        });
      }

      if (fix) {
        const view = update.view;
        const { from, to, insert } = fix;
        setTimeout(() => {
          view.dispatch({
            changes: { from, to, insert },
            annotations: Correction.of(true),
          });
        }, 0);
      }
    });

    return [zwnjApplier, corrector];
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/**
 * 判断某行是否需要在行首插入 ZWNJ。
 * 条件：行首是「4 个及以上空格」、尚未有 ZWNJ、
 *       且不属于「缩进合法」的场景（列表、引用、围栏代码块、YAML）。
 * 注意：刻意不匹配 Tab，从而保留 Tab 键的原生缩进功能。
 */
function lineNeedsZWNJ(
  doc: Text,
  lineNumber: number,
  lineText: string
): boolean {
  if (lineText.startsWith(ZWNJ)) {
    return false;
  }
  // 只匹配空格缩进（4 个及以上），不匹配 Tab 缩进
  if (!/^ {4}/.test(lineText)) {
    return false;
  }
  // 去掉缩进后是列表项 / 任务 / 引用 → 属于合法缩进，不处理
  const trimmed = lineText.replace(/^[ \t]+/, "");
  if (/^([-*+]|\d+[.)])\s/.test(trimmed) || /^>/.test(trimmed)) {
    return false;
  }
  if (isInsideFencedCode(doc, lineNumber)) {
    return false;
  }
  if (isInsideYamlFrontmatter(doc, lineNumber)) {
    return false;
  }
  return true;
}

/** 判断某行是否位于 ``` / ~~~ 围栏代码块内部 */
function isInsideFencedCode(doc: Text, targetLine: number): boolean {
  let inFence = false;
  let marker = "";
  for (let i = 1; i <= targetLine; i++) {
    const text = doc.line(i).text;
    const m = text.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      if (!inFence) {
        inFence = true;
        marker = m[1][0];
      } else if (text.trimStart().startsWith(marker)) {
        inFence = false;
      }
    }
  }
  return inFence;
}

/** 判断某行是否位于 YAML frontmatter（文档开头的 --- 区间）内 */
function isInsideYamlFrontmatter(doc: Text, targetLine: number): boolean {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") {
    return false;
  }
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === "---") {
      return targetLine > 1 && targetLine < i;
    }
  }
  return false;
}

/**
 * 设置面板。
 */
class KeepSpacesSettingTab extends PluginSettingTab {
  plugin: KeepSpacesPlugin;

  constructor(app: App, plugin: KeepSpacesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Keep Spaces（空格保持空格）" });

    new Setting(containerEl)
      .setName("屏蔽「空格缩进」识别")
      .setDesc(
        "开启后，行首输入的 4 个及以上空格会保持普通空格，不触发缩进参考线、" +
          "缩进代码块等结构化效果；Tab 键的原生缩进功能保持不变。修改后立即生效并自动保存。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.keepSpacesAsSpaces)
          .onChange(async (value) => {
            this.plugin.settings.keepSpacesAsSpaces = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
