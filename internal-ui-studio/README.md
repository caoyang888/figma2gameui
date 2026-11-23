# 公司内部 UI 制作台

这是供公司内部使用的独立 Web 应用。首版主流程：项目 → 切图/ZIP（可加参考截图）→ 后台 AI 分析 → 预览与确认 → 取走 Cocos Creator 3.8.8 资源 ZIP。

## 本地启动

需要 Node.js 24 和 npm，不需要 Python。只在自己的开发机器上运行：

```sh
cd internal-ui-studio
npm ci
F2_DEV_LOCAL=1 F2_ALLOWED_AI_BASE_URLS=https://api.openai.com/v1 npm start
```

在 Mac 上可先用 `node -v` 确认是 `v24.x`。用 Homebrew 时，`brew install node@24` 后可执行 `export PATH="$(brew --prefix node@24)/bin:$PATH"`。首次安装依赖需要联网，之后重新启动无需再执行 `npm ci`。如果已有 Python 版数据：停掉旧服务，先备份整个 `studio-data`（包括 SQLite、素材与 `settings.key`），再启动新版。自定义过 `F2_DATA_DIR` 时沿用同一路径。不要同时启动两个版本。

在同机浏览器打开 `http://127.0.0.1:8765/`。没有配置允许地址时，应用仍可启动，但所有模型服务请求会被拒绝。设置页填写根地址和 API Key，拉取列表或直接输入模型 ID，再点「验证并设为默认」。切换型号会重新发两张随机合成图；必须能读取形状颜色和位置、返回有效结构、模型标识与请求相符。只拉取列表不算通过。首次在允许的真实提供方上测试时，请确认提供方协议兼容 `/models`（可选）与图像 `/chat/completions`、JSON 响应及 max_tokens。用合成图先测，不必上传公司素材验证。

## 公司内网试点

- 不用 `F2_DEV_LOCAL`。配置 `F2_WORKSPACE_PASSWORD`（至少 16 字符）及 `F2_SITE_ORIGIN`（如 `https://ui-studio.example.company`）；用户名 `studio`。建议由已有公司入口在 HTTPS 反代前提供登录、访问限制、速率限制。工作台自身保留基础认证；本版不区分细粒度项目或成员权限。**不要对公网直开这个首版。**
- 保持一个应用进程。默认仅监听 127.0.0.1:8765，可通过 `F2_HOST` 和 `F2_PORT` 调整。为 `F2_DATA_DIR` 配置独立持久卷、限制 OS 用户访问；SQLite 和加密密钥文件一起备份。数据目录、密钥、真实素材不进 Git。活动数据库用 SQLite 一致性快照；或者停服务后再备份整卷。
- 默认拒绝未知地址、重定向及内网/回环模型地址；只开启公司明确允许接收该类素材的服务。密钥使用服务器本地密钥加密，不回显，不入日志。提供方仍会收到该任务的图像和必要上下文；不要把真实素材发给不允许的服务。
- 任务串行处理，状态持久。重启打断分析时标记失败，可重试；同项目同任务内容、同模型配置优先复用已有任务。原图不用于前端服务日志。诊断包括 HTTP 状态和任务错误；生产指标、备份恢复和值守由部署方接入。

## 导入与资源打包

接受 PNG/JPEG/WebP、TTF/OTF 及有边界的 ZIP，单次原输入 32 MiB；同一界面送模型最多 24 张图（包含参考图），缩略图累计不超过 5 MiB。按全画布像素、色彩和透明边精确去重，跨界面复用但不自动合并近似图。图片和字体使用项目稳定 UUID，别名、已批准节点标签和引用回填 SQLite。已批准版本不被覆盖。纯参考图模式只产出候选结构及缺图提示，首版不从截图自动切出缺失图片。

审核通过后，界面包只带它的依赖；项目包同时包含已批准界面和项目中兼容的资源。同一资源在两种包中的路径、UUID 和 SpriteFrame UUID 一致。解压后把包内 `assets/` 下的项目资源目录及同名 `.meta` 一起复制进目标 Creator 工程，查看根目录的 `manifest.json`。不要丢弃、重写旧 `.meta`。当前输出独立 PNG、TTF、prefab、真实本地 Bundle 目录。OTF 可以收录但不允许绑定为要导出的字体；项目清单列出未导出的格式。

服务端按 Creator 3.8.8 格式序列化，保留稳定的资源身份，支持结构 Button、水平/垂直 Layout。按钮不带业务回调；自适应约束、合图和更复杂的组件不在本阶段。浏览器预览是布局审查辅助，不是引擎运行效果。发给 AI 的是压缩缩略图，最终 ZIP 使用完整资源。

## 回归

```sh
npm run typecheck
npm test
npm run sample -- /tmp/ui-studio-creator-smoke.zip
```

回归覆盖真实 HTTP API 的导入、审查、重复分析复用、单界面与项目 ZIP，以及注入模拟提供方的模型验证。没有提供方的真实 Key、公司素材、安装引擎的测试机时不能声称完成生产验收。Creator 验收步骤见 [CREATOR_ACCEPTANCE.md](CREATOR_ACCEPTANCE.md)。
