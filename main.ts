import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EditorView, keymap } from "@codemirror/view";
import { Prec, EditorSelection, type Extension } from "@codemirror/state";

/**
 * 插件设置结构。
 * - fourSpacesAsTab：是否开启「连续空格自动转换为 Tab」
 * - spacesPerTab：多少个连续空格等价于一个 Tab（默认 4）
 */
interface SpaceAsTabSettings {
  fourSpacesAsTab: boolean;
  spacesPerTab: number;
}

const DEFAULT_SETTINGS: SpaceAsTabSettings = {
  fourSpacesAsTab: false,
  spacesPerTab: 4,
};

export default class SpaceAsTabPlugin extends Plugin {
  settings: SpaceAsTabSettings;

  async onload() {
    // 读取持久化设置（保存在 .obsidian/plugins/space-as-tab/data.json）
    await this.loadSettings();

    // 注册 CodeMirror 6 编辑器扩展，实现空格 / Tab 的缩进处理
    this.registerEditorExtension(this.buildEditorExtension());

    // 注册设置面板
    this.addSettingTab(new SpaceAsTabSettingTab(this.app, this));
  }

  onunload() {
    // 编辑器扩展由 Obsidian 在插件卸载时自动移除，无需手动清理
  }

  /**
   * 构建编辑器扩展。
   *
   * 说明：这里的关键点是，handler 内部通过 `plugin.settings.xxx` 在「调用时」
   * 实时读取设置值（而不是在构建时快照），因此用户在设置面板里修改开关后
   * 无需重新加载即可立即生效。
   */
  buildEditorExtension(): Extension {
    const plugin = this;

    // 1) 空格输入处理：拦截「空格」键，判断是否应转换为 Tab
    const spaceHandler = EditorView.inputHandler.of((view, from, to, text) => {
      // 未开启功能 / 非单个空格 / 存在选区替换，均交回默认行为
      if (!plugin.settings.fourSpacesAsTab || text !== " " || from !== to) {
        return false;
      }
      return plugin.tryConvertSpacesToTab(view, from);
    });

    // 2) Tab 键处理：开启时在「行首空白区」直接插入一个 Tab 字符，
    //    保证与「连续空格→Tab」的结果一致
    const tabKeymap = keymap.of([
      {
        key: "Tab",
        run: (view) => plugin.handleTabKey(view),
      },
    ]);

    // Prec.highest 确保我们的 Tab 处理优先于 Obsidian 默认的 Tab 行为
    return [spaceHandler, Prec.highest(tabKeymap)];
  }

  /**
   * 处理空格输入：当光标处于「行首缩进区」，且再补一个空格正好凑满
   * 一个 Tab 的宽度时，把光标前那串空格替换为一个 Tab 字符。
   *
   * 注意：本方法只作用于「正在输入的空格」，绝不会扫描或改写文档中
   * 已存在的缩进，因此不会影响已有内容的缩进。
   *
   * @returns 是否已消费该空格输入（true 表示不再执行默认插入）
   */
  tryConvertSpacesToTab(view: EditorView, cursorPos: number): boolean {
    const state = view.state;
    const line = state.doc.lineAt(cursorPos);

    // 行首到光标之间的文本（即当前行的「缩进区」）
    const leadingText = state.doc.sliceString(line.from, cursorPos);

    // 缩进区必须只包含空格或 Tab；若夹杂正文内容则跳过，避免误转换
    if (!/^[ \t]*$/.test(leadingText)) {
      return false;
    }

    // 光标前连续空格的个数
    const trailingSpaces = countTrailingSpaces(leadingText);
    const spacesPerTab = Math.max(2, this.settings.spacesPerTab);

    // 仅当「再补一个空格正好凑满一个 Tab」时才转换（例如 4 个空格 → 1 个 Tab）
    if (trailingSpaces === spacesPerTab - 1) {
      const from = cursorPos - trailingSpaces;
      view.dispatch({
        // 把光标前 (spacesPerTab-1) 个空格替换为一个 Tab
        changes: { from, to: cursorPos, insert: "\t" },
        selection: EditorSelection.cursor(from + 1),
      });
      return true; // 已消费该空格输入
    }

    return false;
  }

  /**
   * 处理 Tab 键。
   *
   * 仅接管「功能开启 + 单光标 + 无选区 + 光标处于行首空白区」的简单场景，
   * 直接插入一个 Tab 字符；其余情况（多行选区块缩进、列表项缩进、表格跳格等
   * 高级行为）返回 false 交回 Obsidian 默认处理，避免破坏原有功能。
   */
  handleTabKey(view: EditorView): boolean {
    if (!this.settings.fourSpacesAsTab) {
      return false;
    }

    const { state } = view;
    const main = state.selection.main;

    // 仅处理「单光标 + 无选区」
    if (!main.empty || state.selection.ranges.length !== 1) {
      return false;
    }

    const line = state.doc.lineAt(main.from);
    const leadingText = state.doc.sliceString(line.from, main.from);

    // 光标必须位于行首空白区（尚未输入正文），否则交回默认处理
    if (!/^[ \t]*$/.test(leadingText)) {
      return false;
    }

    view.dispatch({
      changes: { from: main.from, insert: "\t" },
      selection: EditorSelection.cursor(main.from + 1),
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

/** 统计字符串末尾连续空格的数量 */
function countTrailingSpaces(str: string): number {
  let count = 0;
  for (let i = str.length - 1; i >= 0 && str[i] === " "; i--) {
    count++;
  }
  return count;
}

/**
 * 设置面板：提供开关与空格数配置，修改后立即写入持久化存储并即时生效。
 */
class SpaceAsTabSettingTab extends PluginSettingTab {
  plugin: SpaceAsTabPlugin;

  constructor(app: App, plugin: SpaceAsTabPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Space as Tab（空格即缩进）" });

    // 主开关：四个空格是否等价于一个 Tab
    new Setting(containerEl)
      .setName("四个空格等价于一个 Tab")
      .setDesc(
        "开启后，在行首连续输入指定数量的空格会自动转换为一个 Tab 缩进，" +
          "Tab 键也会插入 Tab 字符以保证行为一致；关闭后空格保持原样。修改后立即生效并自动保存。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.fourSpacesAsTab)
          .onChange(async (value) => {
            this.plugin.settings.fourSpacesAsTab = value;
            await this.plugin.saveSettings();
          })
      );

    // 一个 Tab 对应的空格数
    new Setting(containerEl)
      .setName("一个 Tab 对应的空格数")
      .setDesc("定义多少个连续空格才等价于一个 Tab（默认 4，最小为 2）。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.spacesPerTab))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed >= 2) {
              this.plugin.settings.spacesPerTab = parsed;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
