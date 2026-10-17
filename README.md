# 看剧AI 视频源（TVBox / FongMi / 影视TV）

面向 [kanju.ai](https://kanju.ai)（同源域名 `kanju3.com`）的多实现视频源仓库，提供 **Python / JS（两套运行时）/ Java** 版本，
按客户端能力任选其一。功能对齐：分类、筛选、搜索、详情、剧集、多线路播放。

> 本仓库只包含客户端源代码与配置，不存储、不转码、不分发任何媒体文件。

## 目录结构

```
source/
├─ README.md
├─ python/                     FongMi / 影视TV（type 3 · Python，Chaquopy）
│  ├─ kanju3.py                源本体
│  └─ kanju3.json              配置（api: ./kanju3.py）
├─ js/
│  ├─ kanju3.js                ★ FongMi QuickJS 版（export default，内置纯 JS HMAC）
│  ├─ kanju3.json              ★ QuickJS 配置
│  ├─ kanju.js                 drpy2 版（TVBox 系，rule 对象）
│  └─ kanju.json               drpy2 配置
└─ java/
   ├─ spider.jar               Java Spider（dex 格式，含 csp_Kanju + Proxy）
   ├─ spider.jar.md5           与 jar 对齐
   ├─ kanju_jar.json           配置（api: csp_Kanju）
   ├─ src/Kanju.java           源码
   ├─ src/Proxy.java           兼容壳（加载器必需）
   └─ BUILD.md                 编译/打包步骤
```

## 快速开始

### 1. Python 版（影视TV / FongMi TV / OKTV）

需要客户端带 **Chaquopy**。

```
https://raw.githubusercontent.com/z2004y/source/main/python/kanju3.json
https://cdn.jsdelivr.net/gh/z2004y/source@main/python/kanju3.json
```

### 2. JS 版

#### 2a. QuickJS（FongMi 内核：影视TV / OKTV / 影视仓新版）

不需要 Python、不需要 jar。

```
https://raw.githubusercontent.com/z2004y/source/main/js/kanju3.json
https://cdn.jsdelivr.net/gh/z2004y/source@main/js/kanju3.json
```

- 站点名：`看剧AI(JS)`；源码 `js/kanju3.js`。
- QuickJS 没有 WebCrypto，签名用内置纯 JS 的 SHA-256/HMAC 实现。
- 该分支的 QuickJS 桥接只提供全局 `http(url, opts)`（返回 `{code, headers, content}`）与 `local`，
  没有 `net.*` —— 源码按此适配，返回值为 JSON 字符串。

#### 2b. drpy2（TVBox 系）

```
https://raw.githubusercontent.com/z2004y/source/main/js/kanju.json
https://cdn.jsdelivr.net/gh/z2004y/source@main/js/kanju.json
```

- 依赖 drpy2 运行时（配置里的 `spider` 已指向公开 drpy2，走 gh-proxy 加速）。
- 站点名：`看剧AI`。

### 3. Java 版（TVBox / CatVodSpider）

```
https://raw.githubusercontent.com/z2004y/source/main/java/kanju_jar.json
https://cdn.jsdelivr.net/gh/z2004y/source@main/java/kanju_jar.json
```

- 入口类 `com.github.catvod.spider.Kanju`（`api: csp_Kanju`）。
- jar 为 **dex 格式**（`classes.dex`），并包含加载器必需的 `Proxy` 类。
- 构建方式见 `java/BUILD.md`。

## 三版对比

| 维度 | Python | JS · QuickJS | JS · drpy2 | Java |
|---|---|---|---|---|
| 适用客户端 | FongMi + Chaquopy | FongMi 内核（含 OKTV） | TVBox + drpy2 | TVBox / CatVodSpider |
| 额外依赖 | Chaquopy 运行时 | 无 | drpy2.js | 无（dx jar 自带） |
| 签名密钥 | 运行时提取 | 运行时提取 | 内置常量 | 运行时提取 |
| 热更新 | 改服务器文件 | 改服务器文件 | 改服务器文件 | 替换 jar |
| 配置 | `python/kanju3.json` | `js/kanju3.json` | `js/kanju.json` | `java/kanju_jar.json` |

## 接口与签名

```
分类/搜索  GET  /v1/browse/catalog?page=&limit=&kind=&year=&area=&q=
详情       GET  /v1/catalog/{id}/detail
剧集       GET  /v1/catalog/{id}/episodes?limit=48&offset=0
线路       GET  /v1/playback/resolve/{episode_token}?view=compact
最终地址   POST /v1/playback/resolve-line  {"ticket":"<public_id>"}
```

```
canonical = "{METHOD}\n{path?query}\n{timestamp_ms}\n{nonce_hex32}"
signature = HMAC-SHA256(key, canonical).hex()
```

必需请求头：`x-ai-movie-timestamp / -nonce / -signature / -client-name / -client-version / -build-version / -protocol-version`。

## 验证记录（模拟器实测）

环境：雷电 14（Android 14）+ OKTV 5.2.1（FongMi 内核）。

| 版本 | 载入 | 分类 | 详情 | 播放 |
|---|---|---|---|---|
| Python | ✅ | ✅ 8 分类 | ✅ | ✅ `state=3`，进度前进 |
| JS · QuickJS | ✅ | ✅ 8 分类 | ✅ | ✅ `state=3`，+6s/6s |
| Java（本仓库 jar） | ✅ | ✅ 8 分类 | ✅ | ✅ `state=3`，+6s/6s |
| JS · drpy2 | — | 需 TVBox + drpy2 客户端（OKTV 无 drpy2） | — | — |

> 结论：OKTV/影视TV 这类 FongMi 内核请用 **Python** 或 **JS · QuickJS**；drpy2 版留给 TVBox 系。

## 维护

- 站点换签名协议：Python / QuickJS / Java 改 `canonical` 与密钥正则；drpy2 版需同步 `SIGN_KEY` 与版本常量。
- Java 改完必须重新 d8 → 打包 → 更新 `spider.jar.md5`。
- 本地自测：把配置里的地址换成 `http://<设备可达IP>:8000/...`，或参考 `tools/`。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 站点出现但分类空白 | 客户端不支持该运行时 | 换对应版本（见对比表） |
| JS 报 `'net' is not defined` | 该分支未注入 `net` | 用本仓库 `js/kanju3.js`（已适配全局 `http`） |
| Java 报 `ClassNotFoundException: ...Proxy` | jar 缺 Proxy 类 | 用本仓库 jar（已含） |
| Java 报 `Failed to open dex files` | jar 是 `.class` 而不是 `classes.dex` | 用本仓库 jar 或按 BUILD.md 重新 d8 |
| 选集黑屏 | 线路失效 / 地址过期 | 源已做 5 条线路回退；仍失败可指定 `ext.line` |

## 免责

代码仅用于个人学习与自建源调试。内容版权归原站点与权利人所有，本仓库不存储、不转码、不分发任何媒体文件。
