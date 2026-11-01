# WeChat MP HTML Source Helper

`WeChat MP HTML Source Helper` 是一个面向微信公众号后台编辑器的 Chrome 扩展，用来辅助导入和读取正文区域中的 HTML 内容。

扩展会在 `https://mp.weixin.qq.com/` 的图文编辑页面注入一个 `HTML 源码` 入口；当工具栏无法挂载时，会自动降级为页面右下角的悬浮按钮。

## 功能

- 在微信公众号后台编辑器中提供 `HTML 源码` 入口
- 支持粘贴 HTML 并写入当前正文编辑区
- 支持读取当前编辑区 HTML，便于调试和排查
- 在导入前执行基础清洗，移除高风险标签和内联事件
- 自动触发常见输入事件，尽量让编辑器感知内容变更
- 阻止空内容覆盖；每次覆盖前提示，当前页面可恢复最近一次导入前的正文
- 提示样式表移除、非微信图片地址和复杂布局的兼容风险
- 保留常见 SVG 图形和 SMIL 视觉动画，包括 `begin="click"`
- 仅在唯一识别到正文时允许写入；ProseMirror 编辑器可读取，暂不直接覆盖

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
4. 点击 `导入正文`，阅读兼容提示与全文替换提醒后继续
5. 如需查看当前内容，可点击 `读取当前 HTML`
6. 误导入时，在当前页面点击 `恢复导入前正文`；该操作也会覆盖导入后的手动修改
7. 手动保存草稿，重新打开，检查手机浅色与深色预览。扩展不会自动保存、发布或发送

备份仅保存在当前页面内存中，不写入本地存储或上传。只保留最近一次导入前的内容，刷新/关闭页面后失效。恢复操作会核对编辑区节点和页面地址；不要将它当作跨文章历史记录。

如果提示 ProseMirror 编辑器，请使用微信原生富文本粘贴入口。扩展暂时阻止直接修改其 DOM，因为这种写法可能绕过编辑器事务和保存机制；这不是已完成的新版编辑器写入适配。

## 安全说明

扩展在导入前会执行一层基础过滤，目前会移除以下内容：

- `script`
- `iframe`
- `object`
- `embed`
- `base`
- `meta`、`link`、`style` 和 `template`
- SVG `foreignObject`、表单及输入控件
- 所有以 `on` 开头的内联事件属性，例如 `onclick`、`onload`
- URL 属性中的 `javascript:`、`data:`、`vbscript:` 等非允许协议，以及 `srcdoc`、`srcset`
- 含危险资源引用或转义难以可靠检查的行内样式
- 可能通过 `attributeName` 改写链接、事件或样式的 SVG 动画

允许 URL 协议为 HTTP、HTTPS、mailto、tel；相对地址与页内锚点可保留。普通 SVG 图形及透明度、颜色、位移、旋转等常见动画可保留，但保留代码不代表微信一定接受。

样式表会被移除而非自动转为行内样式；图片不会自动上传到微信。此过滤用于降低明显风险，不是完整的安全沙箱或微信官方白名单复刻。

## 已知限制

- 微信公众号后台会再次清洗标签、属性和样式，最终结果可能与原始 HTML 不一致
- 工具栏 DOM 结构如果发生变化，按钮可能无法插入原位置；此时会回退到悬浮按钮
- 扩展仅在 `https://mp.weixin.qq.com/*` 范围内生效
- 当前版本不提供持久历史记录、模板管理或导出功能
- 暂不支持直接覆盖 ProseMirror 正文；无法唯一识别正文或识别到隐藏编辑区时拒绝写入
- 当前测试覆盖 Chromium 中的模拟编辑页，未完成真实微信公众号账号下的保存、重新打开及 iOS/Android 预览验收

## 项目结构

```text
.
|-- manifest.json
|-- content.js
|-- styles.css
|-- .gitignore
|-- LICENSE
|-- tests/browser.test.cjs
`-- README.md
```

## 开发

这是一个 Manifest V3 扩展，当前通过 `content_scripts` 注入脚本和样式，不依赖构建工具或第三方包。

开发时通常只需要：

1. 修改 `content.js` 或 `styles.css`
2. 回到 `chrome://extensions/` 刷新扩展
3. 重新打开或刷新公众号编辑页面验证效果

### 浏览器回归检查

运行时不需要任何依赖。测试使用 Node.js 内置测试运行器和开发用 `playwright-core`，需要 Node.js 20+ 与已安装的 Chrome：

```powershell
npm install --no-save --package-lock=false playwright-core
node --test tests/browser.test.cjs
```

也可通过 `PLAYWRIGHT_MODULE` 指向已安装的 Playwright 模块目录，`CHROME_PATH` 指向 Chromium/Chrome 可执行文件，复用现有环境。测试覆盖空内容、取消覆盖、备份恢复与跨编辑区拦截、编辑器识别、URL/SVG 清洗、兼容提示、iframe 事件以及键盘焦点。

### 0.2.0（2026-11-01）

增加防误覆盖与单次恢复、兼容提示和 URL/SVG 安全处理；收紧正文识别，阻止 ProseMirror 直接 DOM 覆盖；修复工具栏延迟出现时悬浮入口不迁移的问题，改善小窗口和键盘操作。

本次验证：Chromium 浏览器回归 13/13 通过；已解压 Manifest V3 扩展在拦截的模拟页上自动注入脚本/样式及导入通过；1280×900、390×844、760×480 弹窗截图已检查。上述结果不包含真实微信服务器保存和手机端验收。

## 权限范围

当前扩展仅匹配以下页面：

```json
"matches": ["https://mp.weixin.qq.com/*"]
```

这意味着扩展不会在其他站点注入脚本。

## License

本项目采用 `MIT` License，详见 [LICENSE](./LICENSE)。
