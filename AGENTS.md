# UI 注意事项

Paseo 全局 `:focus-visible` 会给输入框加外圈。自定义聚焦边框时，在 Web DOM 上用 `style.setProperty("outline", "none", "important")` 禁用外圈（参考 `setBorderOnlyFocus`），避免双重边框。
