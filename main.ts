import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EditorView } from "@codemirror/view";
import {
  Annotation,
  Compartment,
  EditorSelection,
  Prec,
  Text,
  type Extension,
} from "@codemirror/state";
import { indentUnit } from "@codemirror/language";

/**
 * 插件设置结构。
 * - keepSpacesAsSpaces：是否屏蔽 Obsidian 原生「空格等价于 Tab 缩进」的行为
 * - spacesPerTab：1 个 Tab 等价于多少个空格（默认 4）
 */
interface KeepSpacesSettings {
  keepSpacesAsSpaces: boolean;
  spacesPerTab: number;
}

const DEFAULT_SETTINGS: KeepSpacesSettings = {
  keepSpacesAsSpaces: true,
  spacesPerTab: 4,
};

/** 零宽不连接符：插入在行首可打破 Markdown 的「缩进」识别，但视觉上不可见 */
const ZWNJ = "\u200C";

/** 用于标记本插件自己产生的更正事务，避免死循环 */
const Correction = Annotation.define<boolean>();

export default class KeepSpacesPlugin extends Plugin {
  settings: KeepSpacesSettings;
  private indentCompartment = new Compartment();

  async onload() {
    await this.loadSettings();
    this.registerEditorExtension(this.buildEditorExtension());
    this.addSettingTab(new KeepSpacesSettingTab(this.app, this));
  }

  onunload() {}

  /**
   * 覆盖 Obsidian 缩进单位：useTab 开启时它是 "\t"，这里用最高优先级
   * 把它换成空格，使缩进系统不再产生 Tab 字符。
   */
  private buildIndentExtension(): Extension {
    const unit = this.settings.keepSpacesAsSpaces
      ? " ".repeat(Math.max(1, this.settings.spacesPerTab))
      : "\t";
    return Prec.highest(indentUnit.of(unit));
  }

  buildEditorExtension(): Extension {
    const plugin = this;

    // 方案一：覆盖 indentUnit 为空格（消除 Tab 字符层面的转换）
    const indentOverride = this.indentCompartment.of(
      this.buildIndentExtension()
    );

    // 方案二：行首插入零宽字符（打破 Markdown 的「缩进」识别，
    // 消除缩进参考线 / 缩进代码块等由 4 空格触发的结构化效果）
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

      // 对受影响的行逐一检测：行首是 4+ 空格 / Tab 且不属于合法缩进场景时，
      // 在行首插入 ZWNJ
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

    // 方案三：事后纠正兜底——若仍有「空格被转成 Tab」的变化，立即换回空格
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
          if (
            /^[ \t]*$/.test(del) &&
            /^[ \t]*$/.test(ins) &&
            del.includes(" ") &&
            ins.includes("\t")
          ) {
            const tabCount = (ins.match(/\t/g) || []).length;
            const spaceCount = (ins.match(/ /g) || []).length;
            const spaces = " ".repeat(
              spaceCount + tabCount * plugin.settings.spacesPerTab
            );
            fix = { from: fromB, to: toB, insert: spaces };
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

    return [indentOverride, zwnjApplier, corrector];
  }

  /**
   * 设置变化后，把新的缩进单位应用到所有已打开的编辑器。
   */
  refreshIndentUnit() {
    const effect = this.indentCompartment.reconfigure(
      this.buildIndentExtension()
    );
    this.app.workspace.iterateAllLeaves((leaf) => {
      const anyView = leaf.view as { editor?: { cm?: EditorView } } | null;
      const cm = anyView?.editor?.cm;
      if (cm) {
        cm.dispatch({ effects: effect });
      }
    });
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
 * 条件：行首是 Tab 或 4+ 空格、尚未有 ZWNJ、
 *       且不属于「缩进合法」的场景（列表、引用、围栏代码块、YAML）。
 */
function lineNeedsZWNJ(
  doc: Text,
  lineNumber: number,
  lineText: string
): boolean {
  if (lineText.startsWith(ZWNJ)) {
    return false;
  }
  if (!/^(\t| {4})/.test(lineText)) {
    return false;
  }
  // 去掉缩进后是列表项 / 任务 / 引用 → 属于合法缩进，不处理
  const trimmed = lineText.replace(/^[ \t]+/, "");
  if (/^([-*+]|\d+[.)])\s/.test(trimmed) || /^>/.test(trimmed)) {
    return false;
  }
  // 围栏代码块 / YAML frontmatter 内不处理
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
      .setName("屏蔽「空格转 Tab / 缩进」")
      .setDesc(
        "开启后：输入的空格保持为普通空格——不会被转成 Tab，也不会触发" +
          "缩进参考线、缩进代码块等结构化效果。列表、代码块、引用中的缩进不受影响。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.keepSpacesAsSpaces)
          .onChange(async (value) => {
            this.plugin.settings.keepSpacesAsSpaces = value;
            await this.plugin.saveSettings();
            this.plugin.refreshIndentUnit();
          })
      );

    new Setting(containerEl)
      .setName("一个 Tab 对应的空格数")
      .setDesc("缩进单位宽度（默认 4）。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.spacesPerTab))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
              this.plugin.settings.spacesPerTab = parsed;
              await this.plugin.saveSettings();
              this.plugin.refreshIndentUnit();
            }
          })
      );
  }
}
