# WeChat MP HTML Source Helper

`WeChat MP HTML Source Helper` 是一个面向微信公众号后台编辑器的 Chrome 扩展，用来辅助导入和读取正文区域中的 HTML 内容。

扩展会在 `https://mp.weixin.qq.com/` 的图文编辑页面注入一个 `HTML 源码` 入口；当工具栏无法挂载时，会自动降级为页面右下角的悬浮按钮。

## 功能

- 在微信公众号后台编辑器中提供 `HTML 源码` 入口
- 支持粘贴 HTML 并写入当前正文编辑区
- 支持读取当前编辑区 HTML，便于调试和排查
- 在导入前执行基础清洗，移除高风险标签和内联事件
- 自动触发常见输入事件，尽量让编辑器感知内容变更

## 适用范围

适合以下场景：

- 将已有 HTML 片段快速填入公众号正文
- 调试微信编辑器对某些 HTML 结构的兼容情况
- 读取当前编辑区内容做临时比对或排查

不适合以下场景：

- 复杂网页的完整无损迁移
- 依赖脚本、嵌入式组件或外部资源的内容导入
- 作为严格意义上的 HTML 安全沙箱

## 安装

当前项目以本地加载扩展的方式使用：

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开右上角的 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择目录 `wechat-html-source-extension`
5. 打开微信公众号后台图文编辑页面进行验证

## 使用方法

1. 进入 `https://mp.weixin.qq.com/` 的图文编辑页面
2. 找到 `HTML 源码` 按钮
3. 在弹窗中粘贴待导入的 HTML
4. 点击 `导入并预览` 写入正文编辑区
5. 如需查看当前内容，可点击 `读取当前 HTML`

## 安全说明

扩展在导入前会执行一层基础过滤，目前会移除以下内容：

- `script`
- `iframe`
- `object`
- `embed`
- `base`
- `meta[http-equiv="refresh"]`
- 所有以 `on` 开头的内联事件属性，例如 `onclick`、`onload`

这类过滤仅用于降低明显风险，不代表完整的安全隔离。

## 已知限制

- 微信公众号后台会再次清洗标签、属性和样式，最终结果可能与原始 HTML 不一致
- 工具栏 DOM 结构如果发生变化，按钮可能无法插入原位置；此时会回退到悬浮按钮
- 扩展仅在 `https://mp.weixin.qq.com/*` 范围内生效
- 当前版本不提供历史记录、模板管理或导出功能

## 项目结构

```text
.
|-- manifest.json
|-- content.js
|-- styles.css
|-- .gitignore
|-- LICENSE
`-- README.md
```

## 开发

这是一个 Manifest V3 扩展，当前通过 `content_scripts` 注入脚本和样式，不依赖构建工具或第三方包。

开发时通常只需要：

1. 修改 `content.js` 或 `styles.css`
2. 回到 `chrome://extensions/` 刷新扩展
3. 重新打开或刷新公众号编辑页面验证效果

## 权限范围

当前扩展仅匹配以下页面：

```json
"matches": ["https://mp.weixin.qq.com/*"]
```

这意味着扩展不会在其他站点注入脚本。

## License

本项目采用 `MIT` License，详见 [LICENSE](./LICENSE)。
