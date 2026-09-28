import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EditorView } from "@codemirror/view";
import {
  Annotation,
  EditorSelection,
  Prec,
  type Extension,
} from "@codemirror/state";

/**
 * 插件设置结构。
 * - keepSpacesAsSpaces：是否屏蔽 Obsidian 原生「输入空格自动转 Tab」
 * - spacesPerTab：纠正时 1 个 Tab 等价于多少个空格（默认 4）
 */
interface KeepSpacesSettings {
  keepSpacesAsSpaces: boolean;
  spacesPerTab: number;
}

const DEFAULT_SETTINGS: KeepSpacesSettings = {
  keepSpacesAsSpaces: true,
  spacesPerTab: 4,
};

/** 用于标记本插件自己产生的更正事务，避免纠正逻辑进入死循环 */
const Correction = Annotation.define<boolean>();

export default class KeepSpacesPlugin extends Plugin {
  settings: KeepSpacesSettings;

  async onload() {
    await this.loadSettings();
    this.registerEditorExtension(this.buildEditorExtension());
    this.addSettingTab(new KeepSpacesSettingTab(this.app, this));
  }

  onunload() {}

  /**
   * 构建编辑器扩展。采用「拦截 + 事后纠正」双保险：
   *
   * 1) inputHandler 抢占式拦截空格输入（若优先级足够，则直接插入普通空格，
   *    从源头阻断 Obsidian 的空格→Tab 转换）。
   * 2) updateListener 事后纠正（兜底）：Obsidian 的转换即使发生在更底层，
   *    最终都会反映为「文档中的空格变成了 Tab」，我们检测到这种变化后，
   *    立即把 Tab 换回等量的空格。
   */
  buildEditorExtension(): Extension {
    const plugin = this;

    // 拦截空格文本输入（input 阶段）
    const spaceInputHandler = Prec.highest(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (!plugin.settings.keepSpacesAsSpaces) {
          return false;
        }
        if (text !== " " || from !== to) {
          return false;
        }
        view.dispatch({
          changes: { from, to, insert: " " },
          selection: EditorSelection.cursor(from + 1),
          userEvent: "input.type",
          annotations: Correction.of(true),
        });
        return true;
      })
    );

    // 事后纠正：检测「空格被转成 Tab」的变化，换回空格
    const corrector = EditorView.updateListener.of((update) => {
      if (!plugin.settings.keepSpacesAsSpaces) {
        return;
      }
      // 跳过本插件自己产生的事务，避免死循环
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
          // 关键判定：删除了「含空格的纯空白」，插入了「含 Tab 的纯空白」
          // —— 这正是 Obsidian 把输入的空格转换成 Tab 的特征。
          if (
            /^[ \t]*$/.test(del) &&
            /^[ \t]*$/.test(ins) &&
            del.includes(" ") &&
            ins.includes("\t")
          ) {
            // 把插入的 Tab 换算回等量空格（1 个 Tab = spacesPerTab 个空格）
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
        // 延迟到当前事务结束之后执行，避免在 update 回调内再触发 dispatch
        setTimeout(() => {
          view.dispatch({
            changes: { from, to, insert },
            annotations: Correction.of(true),
          });
        }, 0);
      }
    });

    return [spaceInputHandler, corrector];
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
      .setName("屏蔽「空格自动转 Tab」")
      .setDesc(
        "开启后，输入的空格保持为普通空格，不会被 Obsidian 自动转换为 Tab。修改后立即生效并自动保存。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.keepSpacesAsSpaces)
          .onChange(async (value) => {
            this.plugin.settings.keepSpacesAsSpaces = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("一个 Tab 对应的空格数")
      .setDesc("纠正缩进时，1 个 Tab 换算成多少个空格（默认 4）。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.spacesPerTab))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
              this.plugin.settings.spacesPerTab = parsed;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
