# GitHub 中文化脚本 🈺

将 GitHub 页面自动翻译为简体中文的 Tampermonkey 用户脚本。

## 🎯 功能特性

- ✅ **一键切换** — 右下角浮动按钮，点击即可开关翻译
- ✅ **自动翻译** — 页面加载后自动翻译所有英文内容
- ✅ **动态支持** — 监听页面变化，GitHub SPA 导航也会自动翻译
- ✅ **智能跳过** — 不翻译代码块、哈希值、文件路径、命令等
- ✅ **翻译缓存** — 已翻译内容缓存 1 小时，减少请求
- ✅ **暗色模式** — 自动适配 GitHub 暗色主题
- ✅ **暗色模式适配** — 按钮样式跟随 GitHub 主题变化

## 📥 安装方法

### 第一步：安装 Tampermonkey 扩展

| 浏览器 | 安装链接 |
|--------|----------|
| **Edge** | [Edge 加载项商店](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) |
| **Chrome** | [Chrome 网上应用店](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/) |

> ⚠️ 如果你在国内无法访问 Chrome 商店，可以用 Edge 浏览器安装，或搜索「篡改猴」离线安装包。

### 第二步：安装脚本

1. 点击 Tampermonkey 图标 → **「管理面板」**
2. 点击 **「已安装脚本」** 标签页 → 点击右上角 **「+」** 新建脚本
3. 删除默认内容，**把 `github-zh-cn.user.js` 的全部内容复制粘贴进去**
4. 按 `Ctrl+S` 保存

或者直接：

- 打开 [github-zh-cn.user.js](./github-zh-cn.user.js) 文件
- 复制全部内容
- 在 Tampermonkey 中新建脚本并粘贴

### 第三步：验证安装

打开任意 GitHub 页面（如 https://github.com），你应该看到：

- 右下角出现一个 **「🌐 中文翻译 ON」** 按钮
- 页面内容自动开始翻译为中文

## 🔧 使用方法

### 开关翻译

点击右下角的浮动按钮即可：

- 🟢 **绿色按钮** = 翻译已开启，点击关闭
- ⚫ **灰色按钮** = 翻译已关闭，点击开启

### 开关状态记忆

脚本会记住你的选择。关闭翻译后，下次打开 GitHub 仍然是关闭状态。

### 恢复原文

关闭翻译后，刷新页面（`F5`）即可恢复英文原文。

## ⚙️ 自定义配置

如果你想调整翻译行为，可以修改脚本顶部的 `CONFIG` 对象：

```javascript
const CONFIG = {
  targetLang: 'zh-CN',        // 目标语言（可改为 zh-TW 繁体中文）
  throttleDelay: 800,         // 请求间隔（毫秒），越小越快但可能被限流
  batchMaxChars: 4000,        // 单次翻译最大字符数
  translateCode: false,       // 是否翻译代码块（不建议）
  cacheTTL: 3600000,          // 缓存时间（毫秒），默认 1 小时
};
```

修改后保存脚本（`Ctrl+S`），刷新 GitHub 页面即可生效。

## 🔒 隐私说明

- 文本通过 Google Translate API（`translate.googleapis.com`）翻译
- 只发送页面上的**文本内容**，不发送 cookie 或个人信息
- 翻译缓存存储在浏览器本地，不上传到任何服务器
- 代码块、哈希值、文件路径等内容**不会**发送翻译请求

## 🌐 浏览器兼容性

| 浏览器 | 支持情况 | 备注 |
|--------|----------|------|
| Edge | ✅ | 推荐，Tampermonkey 可直接安装 |
| Chrome | ✅ | 需要能访问 Chrome 商店 |
| Firefox | ✅ | 完全支持 |
| Safari | ⚠️ | 需安装 Tampermonkey for Safari |

## 📝 常见问题

### Q: 某些文字没有被翻译？
正常的。脚本会**跳过**以下内容：
- 代码块（`code`、`pre`）
- Git 哈希值、文件路径
- 纯数字、日期、符号
- 命令行示例

这些内容翻译后反而会造成困扰。

### Q: 翻译速度慢？
Google Translate API 有速率限制。你可以调小 `throttleDelay`，但过快可能被临时封 IP。

### Q: Google API 在国内被墙怎么办？
你的网络环境（雷神加速器）可能已经可以访问。如果不行：
1. 开启加速器的「全局代理」模式
2. 或者换用其他翻译 API（需要自己修改脚本，接入百度/有道翻译 API）

### Q: 想翻译成繁体中文？
修改 `CONFIG.targetLang` 为 `'zh-TW'`。

## 📄 License

MIT

## 👤 Author

[AllanCheung282](https://github.com/AllanCheung282)
