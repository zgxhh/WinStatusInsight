# WinStatusInsight 2.0

WinStatusInsight 是一个本地 Windows 状态分析桌面工具，用来快速判断电脑卡顿主要来自 CPU、内存、磁盘、浏览器、资源管理器、本地开发服务，还是后台自启/服务进程。

## 下载

- [下载便携版 WinStatusInsight.exe](https://github.com/zgxhh/WinStatusInsight/releases/latest/download/WinStatusInsight.exe)
- [下载安装版 WinStatusInsight-Setup-2.0.0.exe](https://github.com/zgxhh/WinStatusInsight/releases/latest/download/WinStatusInsight-Setup-2.0.0.exe)

便携版是单文件运行，不安装，适合临时使用、拷贝到 U 盘或放在桌面直接打开。安装版会安装到固定目录，创建快捷方式和卸载入口，适合长期使用。

如果安装在 `D:\Download` 等特殊权限目录后出现窗口瞬退，可以改装到普通目录，例如 `D:\Apps\WinStatusInsight`，或对安装目录断开继承并授予当前用户完全控制权限。

## 产品截图

### 总览

![总览](docs/assets/win-status-insight-dashboard.png)

### 应用聚合

![应用聚合](docs/assets/win-status-insight-app-groups.png)

### 本地项目

![本地项目](docs/assets/win-status-insight-local-projects.png)

### 历史对比

![历史对比](docs/assets/win-status-insight-history-compare.png)

### 磁盘检查

![磁盘检查](docs/assets/win-status-insight-disk-check.png)

## 功能

- 读取 Windows 当前 CPU、内存、磁盘和进程状态。
- 聚合多进程应用，例如 Chrome、Edge、Node/Vite、Codex、Windows 资源管理器。
- 给出流畅度评分、当前瓶颈和可处理建议。
- 识别正在运行的本地开发项目，支持 Vite、Next、Node、.NET Web API、.NET watch 等。
- 支持停止可确认的本地项目进程，并保护当前分析面板不被误停。
- 支持保存历史快照，并做两次读取结果的历史对比，显示对比分析、变重应用、变轻应用。
- 新增磁盘检查：展示 C/D 盘容量、C 盘大项、开发缓存、应用缓存、已迁移目录和执行日志。
- 支持低风险安全清理：24 小时前 Temp 临时项、旧 Electron 便携版解压残留、回收站单独确认清空。
- 支持开发缓存迁移到 `D:\MovedFromC` 并创建 Junction，包括 Yarn、npm-cache、NuGet、pnpm、ms-playwright、AzureFunctionsTools。
- Chrome 本地模型、Codex、微信、剪映、抖音、微信开发者工具等高风险应用数据只做分析和建议，不提供直接删除/迁移按钮。
- 支持打包为 Windows 便携版和 NSIS 安装版。

## 技术栈

- Vue 3
- Vite
- Element Plus
- ECharts
- lucide-vue-next
- Node.js + Express
- PowerShell Windows 状态采集
- Electron + electron-builder

## 开发运行

```powershell
npm install
npm run dev
```

默认地址：

```text
前端：http://127.0.0.1:5273
后端：http://127.0.0.1:5274
```

## 桌面调试

```powershell
npm run electron:dev
```

## 打包

生成便携版：

```powershell
npm run package:win
```

生成安装版：

```powershell
npm run package:win:installer
```

产物默认位于：

```text
release/WinStatusInsight.exe
release/WinStatusInsight-Setup-2.0.0.exe
```

## 数据位置

- 开发环境快照：`data/snapshots`
- 打包版快照：Electron 用户数据目录下的 `data/snapshots`
- PowerShell 采集脚本：`scripts/collect-status.ps1`
- 开发缓存迁移目标：`D:\MovedFromC\Users\HUAWEI\...`

## 注意

Windows 首次运行未签名的本地打包程序时，可能会触发 SmartScreen 或安全软件提示。
