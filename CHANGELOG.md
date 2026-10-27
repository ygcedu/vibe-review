# Changelog

## [1.3.0](https://github.com/ygcedu/vibe-review/compare/v1.2.0...v1.3.0) (2026-10-27)


### Features

* 历史提交列表支持独立调整各列宽度 ([1b134e5](https://github.com/ygcedu/vibe-review/commit/1b134e5e8f54c84d40baafb269cc36e5ffe9a264))
* 提交更改面板的 Commit 和 Shelf 文件树支持键盘导航 ([30fe3af](https://github.com/ygcedu/vibe-review/commit/30fe3af468079c8ab8dcd0ef26b454b8942ec8d7))
* 提交面板增加追加提交、历史说明选择及间距调整 ([67575a3](https://github.com/ygcedu/vibe-review/commit/67575a3cb512d25706f02cf4679fdb3d4e57a052))
* 支持从历史提交新建分支 ([023372a](https://github.com/ygcedu/vibe-review/commit/023372aefddc589043717bc65dea2c9516001980))
* 支持从历史提交新建标签 ([dba3338](https://github.com/ygcedu/vibe-review/commit/dba33382446556fc1bbf7c64164cf38de7ad00ad))
* 支持以分离 HEAD 模式检出历史版本 ([4c69c37](https://github.com/ygcedu/vibe-review/commit/4c69c375651b73c1258cae45a30fe67251c325c0))
* 支持历史提交与本地工作区比较 ([0dfde31](https://github.com/ygcedu/vibe-review/commit/0dfde31a7f12f5aa29ae11d5cad5f6f98352fed0))
* 支持将历史提交压缩到指定祖先并保留备份 ([9c5aefb](https://github.com/ygcedu/vibe-review/commit/9c5aefbde2b05f10892d3398208e3cf2429d7d87))
* 支持拣选历史提交并在冲突时自动恢复 ([973fd4f](https://github.com/ygcedu/vibe-review/commit/973fd4f33167a5c3e7562434c391eb5e331125b6))
* 支持方向键切换分支树中的可见分支 ([337fc00](https://github.com/ygcedu/vibe-review/commit/337fc00f591d5a2be26e6be9c6b9ba4c267c4cd8))
* 支持方向键切换历史提交并移除查看详情菜单项 ([47796ee](https://github.com/ygcedu/vibe-review/commit/47796eee4cbb3345d198ff5483d96db58b1eea80))
* 支持方向键导航历史变更文件树 ([1feb9ca](https://github.com/ygcedu/vibe-review/commit/1feb9ca59c0116976ae79a28dd8e8f4455ffc3ce))
* 支持重置当前分支并保留恢复备份 ([608aba9](https://github.com/ygcedu/vibe-review/commit/608aba99079150c1f78994f279db69e72fbf3cf7))
* 支持隔离变基编辑历史提交说明并保留备份 ([2671cf1](https://github.com/ygcedu/vibe-review/commit/2671cf17a420d83d04ef892405a5950588cad9af))
* 支持隔离重放丢弃历史提交并保留备份 ([c0037fc](https://github.com/ygcedu/vibe-review/commit/c0037fcc6dd68e6c472dffb861d74f51ee33849f))


### Bug Fixes

* 从diff 组件面板中移除 rtl 方向 ([cc83689](https://github.com/ygcedu/vibe-review/commit/cc83689b3562f7674a1421b17daa14c2e79ad68f))
* 侧边栏面板屏蔽默认右键菜单并修正自定义菜单遮罩拦截 ([81918e9](https://github.com/ygcedu/vibe-review/commit/81918e955b07dc0c4931d8f7425161a612df5f4e))
* 修复提交面板聚焦双边框、操作反馈及确认弹窗布局 ([14dec42](https://github.com/ygcedu/vibe-review/commit/14dec42195e66f708c4759872dc202fdd69a16cb))
* 分支树键盘导航支持目录选中及展开折叠 ([d42606b](https://github.com/ygcedu/vibe-review/commit/d42606b2ce4cdbeb0d53aa53492697e6f16b44ca))
* 列宽调节不显示分割线并以提交时间线为拖动位置 ([3fbbe7e](https://github.com/ygcedu/vibe-review/commit/3fbbe7ef380ef8fe1c1655868c6c4bf444cac3a9))
* 将历史变更列表的删除文件颜色统一为灰色 ([d982eef](https://github.com/ygcedu/vibe-review/commit/d982eefa98297cfe22b1c8276d428ea97b89f414))
* 将提交反馈移至分割线上方并支持手动关闭 ([71c0561](https://github.com/ygcedu/vibe-review/commit/71c05614fba4e3f5991b0b03f891ea413f520626))
* 恢复历史变更列表中已修改文件的蓝色文字 ([d63bf53](https://github.com/ygcedu/vibe-review/commit/d63bf53f6615f07c6bf4c2af5a9ab43328568043))
* 提交与搁置列表中图标固定尺寸防止文件名过长挤压 ([148e993](https://github.com/ygcedu/vibe-review/commit/148e993cac0323789c06a477739e03a88533e82e))
* 移除历史列表列头并支持直接拖动列间隙调宽 ([e85d2d5](https://github.com/ygcedu/vibe-review/commit/e85d2d5f0063769cb166d7328c67ebf9891632d7))
* 移除历史提交键盘选中时的焦点外框和侧边框 ([cac6ff9](https://github.com/ygcedu/vibe-review/commit/cac6ff9770813366ed5de8d06455f9ce174dbc6a))
* 移除提交列表最右侧的列宽拖动区域 ([59ebbb2](https://github.com/ygcedu/vibe-review/commit/59ebbb24527c98bd8172f783818c388f6b01983d))
* 调节内部列宽时保持历史列表总宽度和右边缘固定 ([46893da](https://github.com/ygcedu/vibe-review/commit/46893da54c978b38cfb6682159fe8c33a4925560))
* 重构提交列表为单行横向布局并统一主题样式与本地化文案 ([3e6296f](https://github.com/ygcedu/vibe-review/commit/3e6296fabeea76c230e92f5fa3ba3eea416bd465))

## [1.2.0](https://github.com/ygcedu/vibe-review/compare/v1.1.0...v1.2.0) (2026-10-20)


### Features

* Edit 卡片与评估卡片统一差异视图交互，按需还原完整上下文并支持折叠与同步滚动 ([da0d9d3](https://github.com/ygcedu/vibe-review/commit/da0d9d377f9d7a858a20fe3fefffffbd3a9c18fd))
* Web 端无换行差异按可视窗口虚拟渲染，并统一使用固定高度边界计算 ([b9a8fed](https://github.com/ygcedu/vibe-review/commit/b9a8fed01e992318b26047dca92d082cbc45c35e))
* 分支面板默认折叠远程与标签，本地仅展开当前分支所在路径 ([f5eca0c](https://github.com/ygcedu/vibe-review/commit/f5eca0c074c546974705d87e9b600a20d9fe06cd))
* 增加 test 脚本，用 node --test 直接运行 TS 测试 ([6980788](https://github.com/ygcedu/vibe-review/commit/6980788f913faaca0f53a0d260a48a670292c4d6))
* 增加会话历史面板及实时状态展示 ([b151ae1](https://github.com/ygcedu/vibe-review/commit/b151ae1b7a6901b6a61bd4d9513b72e8e3a2e44e))
* 增加通用右键菜单及回滚删除搁置操作 ([c9fc60f](https://github.com/ygcedu/vibe-review/commit/c9fc60fd206daab1f0633e8b5401eecd618b7fca))
* 差异视图支持折叠未变更代码与左右同步滚动，点击波浪可展开省略行 ([2dd85e4](https://github.com/ygcedu/vibe-review/commit/2dd85e477362251a60d7c6d91a82df864b637c05))
* 差异视图支持折叠未变更代码与左右同步滚动，点击波浪可展开省略行 ([62d1926](https://github.com/ygcedu/vibe-review/commit/62d1926e0cfe118428677cb56bb9181a9ecf1330))
* 提交面板增加 Shelf 文件树与差异预览 ([073346a](https://github.com/ygcedu/vibe-review/commit/073346aee326a82f1f4a6d8195c7ba03adb6d85f))


### Bug Fixes

* AppleScript 通知转义反斜杠与引号，补齐 git-history 解析与 review 核心路径测试 ([772e58d](https://github.com/ygcedu/vibe-review/commit/772e58dd2748b50891f9b1096c3681a1dfbd1222))
* Git 历史分页丢弃过期响应避免跨维度拼接 ([9de286e](https://github.com/ygcedu/vibe-review/commit/9de286ea202972124e0966be47f3e9ef50801dbf))
* SplitDiff 波浪展开加载失败时提示可点击重试 ([8ce09c1](https://github.com/ygcedu/vibe-review/commit/8ce09c146ddceedcd5ffd9a31521ec065d6a9fb7))
* 优化 Git 面板工具栏提示与分组布局 ([2cc2424](https://github.com/ygcedu/vibe-review/commit/2cc242468cc14db20209e9ec2dea4a52865bfa58))
* 分支图标固定宽高并禁用收缩，长分支名下保持图标尺寸一致 ([6704dbc](https://github.com/ygcedu/vibe-review/commit/6704dbc06bd919e9a88a5994c22b45ea39ad2b12))
* 多分栏场景优先在当前聚焦分栏定位输入框 ([78d8023](https://github.com/ygcedu/vibe-review/commit/78d8023319aedd098c440f3fb13fbfbd799d550e))
* 提交预览卡片在终态后不再被轮询降级 ([14df1fb](https://github.com/ygcedu/vibe-review/commit/14df1fb10bcf04628071958607d1f0730def345b))
* 提示词编辑器 read() 失败时仍上报可编辑段内容 ([25e0398](https://github.com/ygcedu/vibe-review/commit/25e039856d6d6950118c8087400d7ca383de603b))
* 提示词编辑器输入失败时保留用户已键入内容 ([350221c](https://github.com/ygcedu/vibe-review/commit/350221c211d5d8b3cc911f388f8eee304cd330e2))
* 统一差异按钮提示显示在上方并提升按钮层级，修复折行提示错位与 Edit 卡片提示被遮挡 ([784d637](https://github.com/ygcedu/vibe-review/commit/784d637d1bc0d4a0a1f1c1405b1197b02ea6301c))
* 补漏 VerificationResult 导入 ([27b8d8e](https://github.com/ygcedu/vibe-review/commit/27b8d8e75e435d5da42928d1fd24aff76c9cde41))


### Performance Improvements

* CommitPreview 3s 轮询在卡片不可见时暂停 ([ced8bd5](https://github.com/ygcedu/vibe-review/commit/ced8bd5907e5c9a437df5ac85143977a02a1ea57))
* 卡片不可见时跳过提交可用性 15s 轮询 ([f4cfa9c](https://github.com/ygcedu/vibe-review/commit/f4cfa9c475ba2db9141061a5c3a0818f472e18c9))
* 虚拟滚动支持原生端并跳过超长文件语法着色，修复桌面端卡顿 ([8a186d6](https://github.com/ygcedu/vibe-review/commit/8a186d673976222358a3934992f9f994a23fe268))

## [1.1.0](https://github.com/ygcedu/vibe-review/compare/v1.0.0...v1.1.0) (2026-10-12)


### Features

* Diff 预览支持多标签切换与拖拽排序，溢出时下拉菜单管理标签 ([50faef2](https://github.com/ygcedu/vibe-review/commit/50faef24bd20cd202c5592b925c680b98814a674))
* Git 历史时间列改为相对/本地化显示并左对齐等宽，hash 列同步收紧左对齐 ([dc7232b](https://github.com/ygcedu/vibe-review/commit/dc7232b6c53308f5ec3ac8ffaa6e868d596b450a))
* Git 历史面板增加可拖拽分割条、最小化切换及分支信息栏 ([06ede20](https://github.com/ygcedu/vibe-review/commit/06ede20189a997d3ba8e427a3abfce3fc6bd50db))
* Git 历史面板增加留白与四角圆角，窄屏列宽动态收缩 ([58bd81a](https://github.com/ygcedu/vibe-review/commit/58bd81a2810bc1b05ae2d0f829b7650edc90b046))
* Git 历史面板统一上方共享 Diff 预览，新增折行切换按钮组件 ([0566b8b](https://github.com/ygcedu/vibe-review/commit/0566b8b04dc2dc0f635d04e3353024fae54e6ee7))
* Git 历史项重构为作者-提交-时间-hash 布局，当前用户加粗，hash 列等宽字体 ([b390ce5](https://github.com/ygcedu/vibe-review/commit/b390ce5156391ffb8b55b3b62f61162efbbbb074))
* render Edit tool patches with split diff ([649f534](https://github.com/ygcedu/vibe-review/commit/649f534f46779e27e85f71ffd42c2fd9d90bd126))
* 分支列增加标签分组、搜索过滤及本地分支领先/落后指示，主分支与当前分支专属图标 ([545254d](https://github.com/ygcedu/vibe-review/commit/545254de427f2ad522d33b512903f959b40bc56f))
* 提交详情区支持完整 message 换行、作者邮箱与包含分支，文件树与说明区高度可拖动 ([c101470](https://github.com/ygcedu/vibe-review/commit/c1014705de9084ec232ec62c7c15ab57e995b3d0))
* 新增 Git 历史面板，支持分支筛选、提交搜索及文件差异展示 ([ee69ca5](https://github.com/ygcedu/vibe-review/commit/ee69ca59b412f6a9a5395917311143b3d1ada1c9))
* 新增提交更改工作区面板 ([b47e03d](https://github.com/ygcedu/vibe-review/commit/b47e03d0ec22def01338752c7f9292ca34981b32))
* 标签文件名按状态着色并悬停显示完整路径 ([3468c85](https://github.com/ygcedu/vibe-review/commit/3468c855ee40f12c32f89479b7a35aae38484eee))


### Bug Fixes

* adapt review and verifier to Paseo 0.11 types ([6ca508c](https://github.com/ygcedu/vibe-review/commit/6ca508c40037e81a062b82eceac133d44fa21886))

## 1.0.0 (2026-10-10)


### Features

* add collapsible Pi prompt preview with hidden diff to commit card ([44eb235](https://github.com/ygcedu/vibe-review/commit/44eb2352681f893a02d462aa245fc0d807dbaf2c))
* add inline prompt template editor ([03bf39d](https://github.com/ygcedu/vibe-review/commit/03bf39d1ca7245402db2d9f9a715cd4d0e187257))
* add mobile clarify composer action ([5978381](https://github.com/ygcedu/vibe-review/commit/5978381e986f4448b0663bf4be349d44d5c5dc66))
* add task classification and Paseo verification agent to review ([4b0026a](https://github.com/ygcedu/vibe-review/commit/4b0026a301a3b236752b6fa8144caf376782f31c))
* clarify selected composer text inline ([c4fb5f9](https://github.com/ygcedu/vibe-review/commit/c4fb5f9fb9c8111753a21e415516d4305ba77761))
* collapse file tree folders by default in review results ([c4b9d1c](https://github.com/ygcedu/vibe-review/commit/c4b9d1c252c1450d745c35c9fd7fef5cf2eb17e6))
* color changed files by status ([de3ab07](https://github.com/ygcedu/vibe-review/commit/de3ab07b7e303c6ec7ceff4140c0da6e2b534f57))
* connect split diff wave separators ([accc486](https://github.com/ygcedu/vibe-review/commit/accc48621dc50d399c9289b6236a812d0d9a1498))
* design and track verification cases for the review agent ([61f04dc](https://github.com/ygcedu/vibe-review/commit/61f04dc2c16383bbc7791170ff54d00d47ea94c7))
* group review changes by file ([5ac9113](https://github.com/ygcedu/vibe-review/commit/5ac91132b5edf14e33cbce0ced92d82aac0cb36c))
* highlight changed text within diff lines ([3ed27bc](https://github.com/ygcedu/vibe-review/commit/3ed27bc926ec9c30a67ed64056914d9b15f6e5df))
* laya-vibe-review 插件 —— agent 轮次结束后 LLM 审核任务完成情况 ([f5aec9e](https://github.com/ygcedu/vibe-review/commit/f5aec9eced6f4d89ef7cbea416a27caf10bcc914))
* link review verification to verifier agent ([1319a1c](https://github.com/ygcedu/vibe-review/commit/1319a1cd788c05402c3c59951fd546d0c1569f01))
* make commit message editable in Pi commit preview ([870315e](https://github.com/ygcedu/vibe-review/commit/870315e64f2e34991b82c15151e85ea5d3dbc818))
* make review, verification and Pi commit prompts editable templates ([992c837](https://github.com/ygcedu/vibe-review/commit/992c837012470c62332eeeedb006cf276e221901))
* match Paseo file tree icons ([70a81c1](https://github.com/ygcedu/vibe-review/commit/70a81c11ca0f03c4baa087296698cb73728479e6))
* preserve turn snapshots and compact split diff ([633e884](https://github.com/ygcedu/vibe-review/commit/633e884b8d0360dedfc3209a06d65a54f6079bdf))
* preview Pi commit with styled proposal card ([aa80f9c](https://github.com/ygcedu/vibe-review/commit/aa80f9c15d85e0010eb1797903d9536bf1395273))
* review net file changes from turn snapshots ([3910040](https://github.com/ygcedu/vibe-review/commit/3910040dd16e45e119d46e4075650fbfc9c92c7c))
* show changed files as a directory tree ([25d41f5](https://github.com/ygcedu/vibe-review/commit/25d41f5878403b80bec4490dabbde535d0bf6ece))
* show file changes inline with row actions ([60c1239](https://github.com/ygcedu/vibe-review/commit/60c123927691411c5085285d1037ba3614a72ca2))
* show review before verification and support canceling it ([345ad28](https://github.com/ygcedu/vibe-review/commit/345ad28b1ac4d3d99f67306ab1a8e3caf494ccc9))
* show review diffs in card details ([714ea74](https://github.com/ygcedu/vibe-review/commit/714ea74a2ebdebc018f3dfa09dc96c7623c0b424))
* show side-by-side review diffs ([f17e8eb](https://github.com/ygcedu/vibe-review/commit/f17e8eb06f069ba19d5d76133352359b9024c700))
* suggest follow-up questions after reviews ([b380a8e](https://github.com/ygcedu/vibe-review/commit/b380a8e219a4c3c4ec1201e2a1c01e0b6a2ed536))
* synchronize split diff vertical scrolling ([c633912](https://github.com/ygcedu/vibe-review/commit/c633912e3414b4a58c061de68ef0387f7593c3a9))
* use Paseo syntax highlighter in split diffs ([0302ea6](https://github.com/ygcedu/vibe-review/commit/0302ea63ef7ae04dcff6d4db55157ae4469b1852))


### Bug Fixes

* avoid misattributed review diffs and resize split view ([c17862f](https://github.com/ygcedu/vibe-review/commit/c17862f5bd55d31b1fa6ac83ef2f9544bcb52f1f))
* await verifier completion with Paseo native wait ([59a4bb3](https://github.com/ygcedu/vibe-review/commit/59a4bb3be2413fc94df800641f7c834116d66243))
* connect mobile diff change blocks across panes ([9a98bfe](https://github.com/ygcedu/vibe-review/commit/9a98bfe94c72c568db61fc7259638ad91a45fd13))
* default diff wrapping to off ([393ab4d](https://github.com/ygcedu/vibe-review/commit/393ab4dc7eaf922d5887c57c9bdc6f395f7a0ff7))
* defer diff syntax highlighting for mobile plugin loading ([0dfaf79](https://github.com/ygcedu/vibe-review/commit/0dfaf795a4ff3024af4f2f827098f43f16c2d8f8))
* fade desktop diff scrollbars over content ([0318314](https://github.com/ygcedu/vibe-review/commit/03183140553f0e34d291debb6553b0347cce32ff))
* group repeated file edits in review card ([b08c7a0](https://github.com/ygcedu/vibe-review/commit/b08c7a0aa76c500955b12f922096677bb9f2d276))
* hide Pi commit preview on earlier turns ([baaeb1a](https://github.com/ygcedu/vibe-review/commit/baaeb1a0da069743afbbfba3c63a0a5dbcae2e1c))
* hide stale Pi commit preview and guard focus outline ([006a380](https://github.com/ygcedu/vibe-review/commit/006a380076f5a585027b174c23eb72a16f271df6))
* include all turn messages in review prompt ([fac80f6](https://github.com/ygcedu/vibe-review/commit/fac80f6573d4b8336550f951202971e7ce018b50))
* include shell-created files in review diffs ([c501491](https://github.com/ygcedu/vibe-review/commit/c5014911f534885fee1c0abd5e064481f0b82314))
* include snapshot diff helpers for Pi commit preview ([7eeee3a](https://github.com/ygcedu/vibe-review/commit/7eeee3a1bfe44c8ec428c23725848947b75eb9b9))
* keep diff scrollbars fixed on hover ([06aebd4](https://github.com/ygcedu/vibe-review/commit/06aebd40d145499e8607ae013676a2724d36a5f4))
* keep no-wrap diff separators fixed while scrolling ([dd73324](https://github.com/ygcedu/vibe-review/commit/dd7332479361b612df43ff431d8daeef46c4bef5))
* keep Pi commit preview in sync across devices ([42a177c](https://github.com/ygcedu/vibe-review/commit/42a177cba45c689d353417fab7341586cd424c57))
* keep split diff connector aligned while scrolling ([0f523b1](https://github.com/ygcedu/vibe-review/commit/0f523b112c8799a66b213d9eee5e045dcdc40501))
* keep verification running across wait timeouts ([4e58089](https://github.com/ygcedu/vibe-review/commit/4e58089019106e6fdffd0e09ffb2d79030de2d5c))
* left-align before-side diff code ([d466a53](https://github.com/ygcedu/vibe-review/commit/d466a533af4e2c0ba3e17a06b3da3a961374c46c))
* omit numbering from assistant messages ([f66348c](https://github.com/ygcedu/vibe-review/commit/f66348cd98bb34457ba215f8c03f76dcdcd82a25))
* open verifier without reloading Paseo ([90566d3](https://github.com/ygcedu/vibe-review/commit/90566d3a4ee5d58cceb5779d1a1fec18a66fffe5))
* overlay mobile diff horizontal scrollbar ([879b914](https://github.com/ygcedu/vibe-review/commit/879b914828f4cd403f96c462c266b5eefc7785f3))
* persist Pi commit proposals and retry preview reads on transport close ([696fa56](https://github.com/ygcedu/vibe-review/commit/696fa5697d797bb8995e4da12b150d08901660f2))
* preserve full assistant text in review prompt ([c8bc80b](https://github.com/ygcedu/vibe-review/commit/c8bc80bd6b470af1039b324bfc74369daf4c6bb7))
* prevent mobile diff horizontal overscroll ([2bb7b45](https://github.com/ygcedu/vibe-review/commit/2bb7b45eccd7240e53a82c23b0104448fe6832f7))
* prevent premature commit poll and show submitted hash on completion card ([45087d8](https://github.com/ygcedu/vibe-review/commit/45087d861e65de132e25a07771b50550018a92d1))
* recover new files after plugin reload ([b60170d](https://github.com/ygcedu/vibe-review/commit/b60170d71c62193de19da323fbc0355b46b15340))
* recover verification cards after plugin reload ([8586d21](https://github.com/ygcedu/vibe-review/commit/8586d21f1732b2e813e8984222d8324bd4acb037))
* refine split diff scrolling and layout ([2e01322](https://github.com/ygcedu/vibe-review/commit/2e013225889e3cc570b3668a1e6efee02d1f4d5a))
* reliably open the verifier bound to each card ([10185c9](https://github.com/ygcedu/vibe-review/commit/10185c9516a669a666abb89a53e7a234a71fe1bd))
* replace running accent with spinner and add verification progress updates ([9587bd3](https://github.com/ygcedu/vibe-review/commit/9587bd3a5b0e8ac0908d0bfcc4711febfa6e148e))
* revive archived verifier before opening its page ([2a0805e](https://github.com/ygcedu/vibe-review/commit/2a0805ebfb8221ea9a4a7b17836471a80cd341e7))
* send complete review diff to model ([ae34f26](https://github.com/ygcedu/vibe-review/commit/ae34f2674a3e270289b470126a2b1bb9b019523a))
* skip review for session control commands ([a162f65](https://github.com/ygcedu/vibe-review/commit/a162f653d1752037aeeabfdff58fbe401128faa4))
* synchronize mobile diff vertical scrolling ([564096c](https://github.com/ygcedu/vibe-review/commit/564096c4e83cd048910c6014391ff2114973a59b))
* treat punctuated no-drift reviews as passing ([ef2fa74](https://github.com/ygcedu/vibe-review/commit/ef2fa74263120036d52accdedcd09af2d3ae7baa))
* verify agent transport reconnect and settings section grouping ([16fcf3c](https://github.com/ygcedu/vibe-review/commit/16fcf3c8a8ac32a7b7746cb8525818f5585950db))
* wrap long diff lines ([48f8724](https://github.com/ygcedu/vibe-review/commit/48f8724df68228694f5c5aa3b166bed9bfbac489))
* 移除多处对用户内容的硬性截断，保留完整标题、详情与验证用例 ([b3eec65](https://github.com/ygcedu/vibe-review/commit/b3eec656ab9c4700ee9fe337da47e17fe8e93a3d))
