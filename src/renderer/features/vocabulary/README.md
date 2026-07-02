# Vocabulary Capture Feature

词汇采集模块提供百词斩等 Android 词汇应用的实时单词采集前端。它只展示连接状态和已经筛选、去重后的词汇文档，不展示底层端口、数据库或调试信息。

## Scope

- `VocabularyCapturePanel.tsx`：词汇采集主页面，展示接收状态和只读词汇文档。
- `electron/vocabularyCaptureService.ts`：主进程 HTTP 接收器、文本筛选、去重、MySQL 持久化和本地兜底。
- `android/vocabulary-capture/`：Android Accessibility 伴随 APK，用于从百词斩窗口实时读取可访问性文本并发送到 AIstudy。

## Data Boundary

- 正式数据源：MySQL。
- 表：`vocabulary_capture_documents`、`vocabulary_capture_events`。
- 本地兜底：`AIstudyPublicData/state/vocabulary-capture.json`、`AIstudyPublicData/state/vocabulary-capture-pending-events.json`。
- 接收端口：`38673`，主进程启动时监听 `0.0.0.0`。

数据库不可用时，事件先进入本地 pending 文件；恢复连接后由主进程重放。前端不直接写数据库，也不保留第二套业务状态。

## Filtering Rules

- 只接受真实词卡结构里的英文单词。
- 需要能在候选词后方识别音标行，例如 `/.../`、`英 /.../`、`美 /.../`。
- 过滤首页、进度、按钮、选项释义、资源路径、Base64 和常见 UI 文案。
- 同一单词全局去重，前端文档只显示词本身，一词一行。

## Android APK

当前可安装调试 APK 固定放在：

```text
android/vocabulary-capture/dist/AIstudyVocabularyCapture-0.1.4-debug.apk
```

构建命令：

```powershell
$env:GRADLE_USER_HOME='F:\AIAPP\Codex\gradle-home'
gradle --no-daemon :app:assembleDebug
```

构建输出来自 `android/vocabulary-capture/app/build/outputs/apk/debug/app-debug.apk`，提交前复制到 `dist/` 的固定文件名。`app/build/` 只作为本机构建中间目录，不提交。

## Verification

- `npm run build`
- `npm run qa:data-boundaries`
- `gradle --no-daemon :app:assembleDebug`
- 打开 AIstudy 的“词汇采集”页面，状态应能在 APK 发送心跳后变为“已连接”。
- 百词斩新单词应实时追加；选项释义、首页进度和重复单词不应进入文档。
