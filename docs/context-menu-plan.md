# 插件右键菜单调研与接入计划

## 当前交付

`client/components/context-menu.tsx` 提供 `ContextMenu`：传入 `children`、`label`、`theme` 和 `items`。每个操作使用稳定 `id`，支持 `icon`、展示用 `shortcut`、`disabled`、`destructive` 和异步 `onSelect`；分隔线使用 `{ id, separator: true }`。快捷键文本本身不会注册全局快捷键。

桌面支持右键、Shift+F10 / ContextMenu 键；菜单支持上下方向键、Home、End、Escape、Tab 关闭和焦点恢复。移动端提供长按与更多按钮，紧凑布局展示底部菜单。菜单使用主题色，自动避让窗口边界，点击外部关闭，窗口尺寸变化关闭。执行前关闭菜单，执行期间拦截该实例重复打开，异常通过 `onError` 或宿主 toast 报告。

DOM 事件和焦点适配位于 `client/web.ts`，非 web 环境不执行。SDK 0.11.2 未导出通用菜单，因此使用 React Native `Modal` 承载浮层，避免滚动容器和面板的 overflow 裁切。组件不自动选择目标，也不执行确认、Git 命令或缓存刷新。调用方闭包必须捕获右键命中的目标；破坏性操作由业务确认框处理。尚未提供子菜单、多选模型、拖动时菜单或全局快捷键注册。

首个真实接入在 `client/git-diff.tsx` 的 `ReorderableTab`：复制文件路径、关闭当前、关闭其他、关闭所有标签。全部是已有客户端能力，不需要增加 RPC。

随后已接入：Commit 文件（查看差异、复制路径、选择/取消选择）和目录（复制路径、展开/折叠、批量选择）；Shelf 记录（复制说明、展开/折叠）与文件（查看差异、复制路径）；Git 历史分支/标签（查看历史、复制名称）、提交（详情、复制 Hash 和完整说明）及文件（查看差异、复制路径）。Git 写操作尚未接入。

实际桌面自测：提交行和分支行右键弹出、Esc 关闭；Commit 文件右键选择更新已选统计并恢复选择；Shelf 文件右键打开 package.json 的版本差异。类型检查和 92 项测试通过。

## 各模块的位置与操作

P0：优先补齐常用操作；P1：随后扩展；P2：低频或语义复杂。以下列出完整候选范围；已实现项见上文，其余尚未实现。

| 模块 / 代码位置 | 右键命中对象 | 建议操作 | 优先级 / 依赖 |
| --- | --- | --- | --- |
| 提交更改 `client/workspace-commit.tsx` / `renderNodes` | 工作区文件 | 查看 Diff、复制相对路径、勾选/取消提交、暂存/取消暂存、搁置改动、还原改动、重命名、删除 | P0。目前已有 Diff 和勾选；`track` 仅支持未跟踪文件的 git add，不能替代通用暂存 RPC。其余需要写操作和状态刷新。 |
| 同上 | 文件夹、已跟踪/未跟踪分组 | 展开/折叠、勾选/取消全部、批量暂存/搁置/还原 | P0。文件夹操作范围应锁定显示的后代文件，不能直接使用整个目录 pathspec，避免误处理隐藏或忽略文件。 |
| Shelf 同文件 / `Shelf` | 暂存记录 | 展开/折叠、重命名说明、应用并保留、恢复并移除、删除记录 | P0。区分 WebStorm Shelf 与 Git stash，分别实现；恢复有冲突时保留原记录。 |
| Shelf / `renderTree` | 暂存中的文件、文件夹 | 查看 Diff、复制路径、恢复选中文件、从暂存记录移除选中文件 | P1。这里的删除修改针对快照；不能误删工作区文件。更新 IDE XML/patch 要保留兼容性、原子写入并与 IDE 并发变更检测。 |
| Git 历史 `client/git-history.tsx` / `renderBranches` | 本地分支 | 查看历史、复制名称、切换、从此创建分支、重命名、合并到当前分支、变基到此分支、删除 | P0。当前分支禁用切换/删除；被其他 worktree 使用的分支也禁止删除；合并/变基需处理脏工作区和冲突。 |
| 同上 | 远程分支 | 查看历史、复制名称、创建跟踪分支、删除远程分支 | P1。远程删除单独标明 remote 与分支名并确认，不能沿用本地删除。 |
| 同上 | 标签 | 查看历史、复制名称、从此创建分支、删除本地标签 | P1。远程标签删除属于单独操作，后续考虑。 |
| Git 历史 / `commits.map` | 提交行 | 复制 hash/提交说明、查看详情、从此创建分支/标签、cherry-pick、revert、reset 当前分支到此提交 | P0 复制与创建；P1 Git 写操作。reset 区分 soft/mixed/hard；revert/cherry-pick 遇合并提交须选择主线，先禁用不支持情形。 |
| Git 历史 / `renderFiles` | 历史文件、文件夹 | 查看 Diff、复制路径、查看此版本、恢复此版本到工作区 | P1。历史快照只读；不提供“删除历史文件”或“修改历史内容”。恢复是覆盖当前文件，需要明确目标和确认。 |
| Git Diff `client/git-diff.tsx` / `ReorderableTab` | 文件标签页 | 复制路径、关闭、关闭其他、关闭所有（已接入）；关闭右侧、重新加载差异 | P0。现有 `useGitDiffState` 可完成；重新加载需增加对外刷新入口。 |
| Git Diff / `SplitDiff` | 差异文本、行、代码块 | 复制选中文本、复制行内容、复制补丁；后续按块暂存/还原 | P1 复制；P2 按块写操作。已有文本选择必须保留，不要统一拦截默认复制菜单。需准确保留原始 patch 的 hunk 坐标，不能根据可视行号生成补丁。 |
| 评估卡片 `client/review/review.tsx` | 卡片、建议气泡、文件树 | 复制评估/建议、填入追问、打开验证 agent、预览 Pi 提交、展开/折叠文件 | P1。复用已有按钮能力；按验证、提交运行状态禁用。删除 timeline 项需要宿主 API，当前没有插件删除契约。 |
| Pi 提交 `client/commit/commit-preview.tsx` | 预览文件、提交说明、卡片 | 复制路径/补丁/说明、展开/折叠；重新读取预览 | P1。确认提交和取消继续保留显式按钮，写操作通过现有预览校验。 |
| 编辑差异 `client/edit-diff.tsx`、公共 `client/diff/file-tree.tsx` | 快照文件、目录、代码 | 复制路径/补丁、展开/折叠、查看 Diff | P1。不能把旧回合快照当作当前工作区状态来还原。 |
| 设置 `client/settings/settings.tsx` / `prompt-template-editor.tsx` | 提示词编辑区 | 复制、自定义模板重置为默认 | P2。输入框保留系统剪切/粘贴菜单；不要覆盖密钥输入的系统行为，也不增加复制密钥入口。 |
| 澄清 `client/clarify/*` | 建议结果 | 复制、填入输入框、重新生成 | P2。已有按钮足够，优先保留文本系统菜单。 |

## 服务端与状态设计

目前 `shared/workspace-commit.ts` 仅有 status/diff/track/commit/push/shelf/shelf-diff；`shared/git-history.ts` 仅有历史、提交详情与文件 diff。删除、重命名、restore、stash apply/drop、branch 操作、reset 等都需要新契约，菜单本身不能补齐这些能力。

下一步按业务拆成工作区文件、Shelf、Git 引用和提交操作 RPC；不设计允许任意 Git argv 的通用执行接口。所有路径、引用、stash hash 与预期状态必须在服务端重新核对，使用 argv 调用和路径分隔 `--`。文件修改/删除不得逃逸工作区。破坏性操作显示明确对象、范围和后果；可恢复删除优先提供回收/备份机制。分支删除首先使用安全删除，强制删除单独区分。

每个仓库内串行化 Git 写操作，执行后重新读取状态；若数据已变化，拒绝并提示刷新。成功后更新 Commit、Shelf、历史列表和已打开 Diff 的缓存；失败保留错误与冲突信息。对于跨面板操作，需要统一仓库刷新信号，目前各面板的局部 revision 尚未互通。

## 建议实施顺序

1. 扩展 Diff 标签菜单，接入各文件树和历史行的复制/预览/选择操作。
2. 增加工作区文件暂存/取消暂存、重命名与还原，再实现本地分支创建/切换/安全删除。
3. 分别实现 WebStorm Shelf 与 Git stash 的恢复、重命名和删除。
4. 添加 cherry-pick/revert/merge，最后考虑 rebase、reset、按块操作和远程删除。

每一批均需：契约类型检查与真实 Git 临时仓库测试；重新加载准确的插件 ID 并确认 running；实际右键、键盘、窄布局和主题验证。验证过程使用临时仓库，不能用用户仓库执行删除或历史重写来测试。

参考：Paseo 插件模块与 UI 契约 https://paseo.sh/docs/plugins/reference.md ，以及本项目安装的 `@getpaseo/plugin` 0.11.2 类型声明。
