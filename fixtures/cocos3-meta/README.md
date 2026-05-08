# Cocos Creator 3.x `.meta` 样例目录

本目录用于存放 **从你本机 Creator 工程里复制出来的真实 `.meta` 片段**，便于对照 golden（UUID、`importer`、`subMetas` 等字段会随引擎版本与资源类型变化）。

## 你需要做什么

1. 在 Cocos Creator 3.8（或你目标版本）中新建或导入资源：`.png`、`.ttf`、`.prefab`。
2. 在磁盘上找到 `assets/` 下对应文件旁的同名 `.meta`，复制到本目录（可改名，但请保留扩展名 `.meta`）。
3. 跑测试或校准时，用这些文件作为「真实引擎输出」的参照；插件内建生成器见 `src/emitters/cocos3/uuidMeta.ts` 的 `makeMetaFile`。

## 附带的极简示例

`example.png.meta`、`example.ttf.meta`、`example.prefab.meta` 仅含 **最小字段集合**，结构与 Cocos Creator 3.8 测试项目中的资源接近，**不保证**覆盖所有 `subMetas` / 压缩选项；正式管线请以你粘贴的真实 meta 为准。

## UUID 格式说明

Cocos Creator 3.8 文档与工程中的 `uuid` 字段为 **标准 UUID v4 字符串**（小写十六进制 + 连字符，**36 字符**，例如 `911560ae-98b2-4f4f-862f-36b7499f7ce3`）。引擎内部库表可能再派生带 `@` 后缀的子资源 id；本仓库的 `newUuid()` 生成的是主资源 uuid。
