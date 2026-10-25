// js/dongpian6.js 的 redactPath 用例（SRC-02 / SRC-07）。
// 运行：node tests/js/test_dongpian6_redact.js（仓库根目录）。
// 只用 Node 内置 assert / fs / vm；不联网，不复制 redactPath 实现：
// 读取源码，截取到 function safeName 之前的前缀（含 PATH_STATIC 与 redactPath），
// 在沙箱中求值后直接调用源码里的 redactPath。
// 浏览器内无法运行，本轮未执行，待有 Node 环境时验证。

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(
  path.join(__dirname, "..", "..", "js", "dongpian6.js"),
  "utf8"
);
const marker = "function safeName";
const cut = src.indexOf(marker);
assert.ok(cut > 0, "dongpian6.js 中未找到 safeName 截断点");
const prefix = src.slice(0, cut);
assert.ok(prefix.indexOf("function redactPath") >= 0, "前缀中未找到 redactPath");
assert.ok(prefix.indexOf("PATH_STATIC") >= 0, "前缀中未找到 PATH_STATIC");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(prefix, sandbox);
const redactPath = sandbox.redactPath;
assert.strictEqual(typeof redactPath, "function", "沙箱中未得到 redactPath");

// 详情路径：非固定段折叠，query 丢掉。
assert.strictEqual(redactPath("/v1/catalog/abc123/detail"), "/v1/catalog/[id]/detail");
// 完整 URL：先取 pathname 再脱敏，不能把 https: 与 host 也折叠进结果。
assert.strictEqual(
  redactPath("https://dongpian6.com/v1/catalog/abc123/detail?x=1"),
  "/v1/catalog/[id]/detail"
);
// 剧集路径。
assert.strictEqual(
  redactPath("/v1/catalog/abc123/episodes"),
  "/v1/catalog/[id]/episodes"
);
// 线路列表路径：token 段折叠，query 丢掉。
assert.strictEqual(
  redactPath("https://dongpian6.com/v1/playback/resolve/abc123?view=compact"),
  "/v1/playback/resolve/[id]"
);
// 分类路径：query 丢掉，固定段保留。
assert.strictEqual(
  redactPath("/v1/browse/catalog?page=1&limit=20"),
  "/v1/browse/catalog"
);
// 详情 base（无 detail 后缀）：vid 段折叠。
assert.strictEqual(redactPath("/v1/catalog/abc123"), "/v1/catalog/[id]");

// 结果中不得残留原始 id、query 与 token。
const cleaned = redactPath("https://dongpian6.com/v1/catalog/VID999/detail?token=abc");
assert.ok(!cleaned.includes("VID999"), "结果残留影片 ID：" + cleaned);
assert.ok(!cleaned.includes("?"), "结果残留 query：" + cleaned);
assert.ok(!cleaned.includes("token"), "结果残留 token 字样：" + cleaned);

console.log("test_dongpian6_redact: 全部断言通过");
