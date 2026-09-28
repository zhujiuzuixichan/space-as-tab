import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EditorView } from "@codemirror/view";
import {
  Annotation,
  Compartment,
  EditorSelection,
  Prec,
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
   * 生成覆盖 Obsidian 缩进单位的扩展。
   *
   * 原理：Obsidian 的整个缩进系统（Tab 键、智能缩进、以及把行首空格
   * 「归一化」为缩进单位的行为）都依赖 CodeMirror 的 `indentUnit` facet，
   * 而「使用制表符」开启时它的值是 "\t"。我们用最高优先级把它覆盖为
   * 空格，就能从根源消除 Tab——空格永远保持空格。
   */
  private buildIndentExtension(): Extension {
    const unit = this.settings.keepSpacesAsSpaces
      ? " ".repeat(Math.max(1, this.settings.spacesPerTab))
      : "\t";
    return Prec.highest(indentUnit.of(unit));
  }

  buildEditorExtension(): Extension {
    const plugin = this;

    // 方案一：覆盖 indentUnit 为空格（从根源消除 Tab）
    const indentOverride = this.indentCompartment.of(
      this.buildIndentExtension()
    );

    // 方案二：事后纠正兜底——若仍有「空格被转成 Tab」的变化，立即换回空格
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

    return [indentOverride, corrector];
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
      .setName("屏蔽「空格转 Tab」")
      .setDesc(
        "开启后，缩进统一使用空格：输入的空格保持为空格，不会被 Obsidian 当作 Tab 缩进。修改后立即生效并自动保存。"
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
