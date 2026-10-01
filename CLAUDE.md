# vibe-review 项目开发须知

## 每次改完代码后必须自查卡片效果

改动本插件（卡片渲染、提示词、审核逻辑等）后，自己打开审核卡片页面确认实际效果，不要等用户反复提醒：

- 卡片页面：`http://127.0.0.1:6767/h/srv_re6jvpV_BY1D/workspace/wks_340a623e47cf0591`，看页面尾部的审核卡片。
- 优先通过浏览器 DOM 定位页面尾部的审核卡片，读取卡片文本、结构和展开后的详情，核对实际渲染内容。需要检查颜色、排版等 DOM 无法充分说明的视觉问题时，再截图。
- 改 server 代码需 `paseo plugin reload vibe-review` 才生效；安装/卸载走 `paseo plugin install/remove vibe-review`。
