# UI 注意事项

Paseo 全局 `:focus-visible` 会给输入框加外圈。自定义聚焦边框时，在 Web DOM 上用 `style.setProperty("outline", "none", "important")` 禁用外圈（参考 `setBorderOnlyFocus`），避免双重边框。

持久化状态前先统一 schema，再比较变化；不要直接用 `JSON.stringify` 比较字段顺序可能不同的对象，否则会反复保存，触发 React 更新死循环（#185）。
