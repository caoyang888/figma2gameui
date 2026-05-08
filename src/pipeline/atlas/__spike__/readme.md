# free-tex-packer-core 依赖探测（Task 1，历史）

> **2026-04-20 起**：MVP 合图技术栈已改为 **`maxrects-packer` + `fast-png` + RGBA blit**（见 `docs/superpowers/specs/2026-04-20-atlas-packing-design.md` §4）。下文仍保留对 **`free-tex-packer-core`** 的探测记录，仅供对比；**新功能实现请勿依赖本目录下的 Node-only spike 作为运行时路径**。

## 当前栈（浏览器可打包探测，修订 Task 1）

- **依赖**：**`maxrects-packer`**（装箱）+ **`fast-png`**（PNG 编解码）；仓库已不再依赖 **`free-tex-packer-core`**。
- **验证**：根目录执行 **`npm run spike:atlas-browser-probe`** — 使用 esbuild **`--platform=browser`** 将 `browser-bundle-probe.ts` 打成单文件 ESM；**打包通过**即表示该依赖图可在 Figma 插件类浏览器环境中作为 bundle 候选。
- **行为**：脚本内对微型 RGBA 图做 **encode → decode** 往返，用 **`allowRotation: false`** 装入 2 个矩形，再做最小 **RGBA source-over blit** 与输出 PNG 编码（探测链路完整）。
- **定位**：本栈为 **Figma 插件 runtime 合图路径的候选实现**（与下文历史 free-tex 结论对照：旧栈无法浏览器 bundle）。

---

## 执行的命令（历史记录）

在仓库根目录执行：

```bash
npm install free-tex-packer-core --save
```

验证脚本（不经过 `src/main.ts`，避免撑大 Figma 插件包）：

```bash
npm run spike:atlas-pack
npm run spike:atlas-pack:browser   # 预期失败，见下文
```

**（修订说明）** 上述 `spike:atlas-pack*` 脚本与对应 `bundleProbe.ts` 已从仓库移除；当前请使用 **`npm run spike:atlas-browser-probe`**（见上文「当前栈」）。

根目录 `npm run build`（Vite + Figma 管线）在添加依赖与 spike 文件后仍应通过。

## 浏览器目标打包（`--platform=browser`）

**结论：当前无法用 esbuild 打成纯浏览器 bundle（未完成解析即失败）。**

`npm run spike:atlas-pack:browser` 使用：

`esbuild src/pipeline/atlas/__spike__/bundleProbe.ts --bundle --platform=browser --format=esm --outfile=dist/spike-atlas-pack.mjs`

典型错误（节选）：无法解析内置模块 `fs`、`path`、`https`、`url`、`net` 等。来源包括 `free-tex-packer-core/exporters` 与传递依赖 `tinify` / `https-proxy-agent` 等。

**说明：** 该检查只证明「依赖图在浏览器平台下不可直接打包」，**不**代表在真实浏览器里绝对不能跑（未尝试 polyfill / 替换实现）。

## Node 目标打包 + 运行（`--platform=node`）

**结论：可以。** 用于验证 **Jimp + free-tex-packer-core 在打平为单文件后仍能完成一次最小合图**。

`npm run spike:atlas-pack` 使用：

`esbuild ... --bundle --platform=node --format=cjs --outfile=dist/spike-atlas-pack.cjs && node dist/spike-atlas-pack.cjs`

成功时标准输出类似：

`spike-atlas-pack ok outW=1 outH=2`（两张 1×1 PNG 竖排为 1×2 图集）。

**该检查证明什么：** 在 **Node + CJS 单文件 bundle** 场景下，核心打包链路可运行。

**与 `npm run build` 的关系：** 主构建仍是 Vite；本 spike **未**把 `free-tex-packer-core` 挂进 Figma 插件入口，因此不增加 `dist/code.js` 体积。

## 错误与规避

| 现象 | 处理 |
|------|------|
| `--platform=browser` 无法解析 `fs` / `path` / `https` 等 | 预期结果；后续若要在浏览器侧使用，需另选架构（见脚注）或引入替代/垫片并评估 jimp 体积与兼容性。 |
| `--format=esm` + Node 运行报 `Dynamic require of "fs" is not supported` | 本仓库 spike 改用 **`--format=cjs`** 输出并由 `node` 执行。 |
| 使用字符串 exporter（如 `"JsonHash"`）时，`node dist/...` 报找不到 `JsonHash.mst` | 打 bundle 后 exporter 模块内 `__dirname` 落在 `dist/`，模板文件不在同目录。**规避：** 使用自定义 exporter，内联 `JsonHash.mst` 的 `content`（历史实现见 git 中的 `bundleProbe.ts`）。 |
| Node 控制台 `punycode` / `Buffer()` 弃用警告 | 来自依赖链；不影响本次 exit code。 |

## 脚注：架构 Plan B（若不能浏览器直打包）

若产品要求 **在浏览器 / Figma UI 沙箱** 内完成合图且不接受 Node 侧预处理，可考虑：

- 将合图放在 **支持 Node API 的独立进程**（本地 CLI、或配套小服务），插件只传 PNG 与配置；
- 评估 **WASM / 纯前端** 图集方案替换 `jimp` + `free-tex-packer-core`；
- 或对依赖做 **深度 external + 分块加载**（仍须解决 `fs` 等仅 Node 模块问题）。

（具体条目以项目 Architecture 文档「Plan B」为准。）
