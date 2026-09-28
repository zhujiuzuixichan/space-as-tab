import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EditorView, keymap } from "@codemirror/view";
import { Prec, EditorSelection, type Extension } from "@codemirror/state";

/**
 * 插件设置结构。
 * - keepSpacesAsSpaces：是否屏蔽 Obsidian 原生「输入空格自动转 Tab」的行为
 */
interface KeepSpacesSettings {
  keepSpacesAsSpaces: boolean;
}

const DEFAULT_SETTINGS: KeepSpacesSettings = {
  // 默认开启：即本插件的核心目的——让输入的空格保持为空格
  keepSpacesAsSpaces: true,
};

export default class KeepSpacesPlugin extends Plugin {
  settings: KeepSpacesSettings;

  async onload() {
    // 读取持久化设置（保存在 .obsidian/plugins/space-as-tab/data.json）
    await this.loadSettings();

    // 注册 CodeMirror 6 编辑器扩展，屏蔽「空格 → Tab」的自动转换
    this.registerEditorExtension(this.buildEditorExtension());

    // 注册设置面板
    this.addSettingTab(new KeepSpacesSettingTab(this.app, this));
  }

  onunload() {
    // 编辑器扩展由 Obsidian 在插件卸载时自动移除，无需手动清理
  }

  /**
   * 构建编辑器扩展。
   *
   * 说明：Obsidian 在「使用制表符（Indent using tabs）」开启时，会把用户
   * 在行首输入的空格自动转换为 Tab。本插件通过「最高优先级」拦截空格输入，
   * 手动插入一个普通空格，从而阻止 Obsidian 的转换，让空格保持为空格。
   *
   * handler 内部通过 `plugin.settings.xxx` 在「调用时」实时读取设置值，
   * 因此用户在设置面板里修改开关后无需重新加载即可立即生效。
   */
  buildEditorExtension(): Extension {
    const plugin = this;

    // 双保险拦截：
    // 1) keymap 层拦截 Space 键（keydown 阶段，最根因，优先于 Obsidian 的默认行为）
    // 2) inputHandler 层拦截空格文本输入（input 阶段，作为兜底）
    const spaceKeymap = Prec.highest(
      keymap.of([
        {
          key: "Space",
          run: (view) => plugin.insertPlainSpace(view),
        },
      ])
    );

    const spaceInputHandler = Prec.highest(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (!plugin.settings.keepSpacesAsSpaces) {
          return false;
        }
        // 仅处理「单个空格」的普通输入（存在选区替换时交回默认行为）
        if (text !== " " || from !== to) {
          return false;
        }
        view.dispatch({
          changes: { from, to, insert: " " },
          selection: EditorSelection.cursor(from + 1),
          userEvent: "input.type",
        });
        return true;
      })
    );

    return [spaceKeymap, spaceInputHandler];
  }

  /**
   * 拦截空格键：手动插入一个普通空格，阻止 Obsidian 把空格转成 Tab。
   * @returns 是否已处理该按键（true 表示阻止默认行为）
   */
  insertPlainSpace(view: EditorView): boolean {
    if (!this.settings.keepSpacesAsSpaces) {
      return false;
    }
    const { from, to } = view.state.selection.main;
    view.dispatch({
      // 有选区时替换选区为空格，无选区时在光标处插入空格
      changes: { from, to, insert: " " },
      selection: EditorSelection.cursor(from + 1),
      userEvent: "input.type",
    });
    return true;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/**
 * 设置面板：提供「屏蔽空格自动转 Tab」开关，修改后立即写入持久化存储并即时生效。
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
        "开启后，输入的空格保持为普通空格，不会被 Obsidian 自动转换为 Tab。" +
          "关闭后恢复 Obsidian 原生行为。修改后立即生效并自动保存。"
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
