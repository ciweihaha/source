// 看剧AI 源（kanju.ai）· FongMi QuickJS
//
// 兼容两种 QuickJS 桥接：
//   1) 官方：net.http(url, opts) / net.cached / local
//   2) 部分分支（如 OKTV）：全局 http(url, opts) / local，且方法返回值必须是 JSON 字符串
// 启动时自动探测，无需改配置。
//
// 配置：{"type":3,"api":"./kanju.js","ext":{"host":"https://kanju.ai","line":""}}

var DEFAULT_HOST = "https://kanju.ai";
var UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
var PAGE_LIMIT = 20;
var PIC_PROXY = "https://ysp.ciweihaha.win/agg?ac=img&u=";
  function proxyPic(u) { u = String(u || ""); if (u.indexOf("http://") !== 0 && u.indexOf("https://") !== 0) return u; if (u.indexOf("/agg?ac=img&u=") >= 0) return u; try { return PIC_PROXY + encodeURIComponent(u); } catch (_) { return u; } }

var MAX_LINE_TRIES = 5;

var KINDS = [["", "全部"], ["movie", "电影"], ["series", "剧集"], ["short_drama", "短剧"],
             ["anime", "动漫"], ["variety", "综艺"], ["documentary", "纪录片"], ["sports", "体育"]];
var AREAS = ["大陆", "香港", "台湾", "日本", "韩国", "欧美"];

var HAS_NET = (typeof net !== "undefined") && net && typeof net.http === "function";
var HAS_HTTP = (typeof http === "function");

// ───────────────────────── SHA-256 / HMAC（纯 JS，QuickJS 无 WebCrypto）
var K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function utf8Bytes(s) {
  s = String(s == null ? "" : s);
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var c2 = s.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function sha256Bytes(bytes) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var msg = bytes.slice();
  var bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  msg.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  var w = new Array(64);
  var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };

  for (var off = 0; off < msg.length; off += 64) {
    for (var i = 0; i < 16; i++) {
      var j = off + i * 4;
      w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
    }
    for (var i2 = 16; i2 < 64; i2++) {
      var s0 = rotr(w[i2 - 15], 7) ^ rotr(w[i2 - 15], 18) ^ (w[i2 - 15] >>> 3);
      var s1 = rotr(w[i2 - 2], 17) ^ rotr(w[i2 - 2], 19) ^ (w[i2 - 2] >>> 10);
      w[i2] = (w[i2 - 16] + s0 + w[i2 - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var i3 = 0; i3 < 64; i3++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K256[i3] + w[i3]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  var out = [];
  for (var i4 = 0; i4 < 8; i4++) out.push((H[i4] >>> 24) & 0xff, (H[i4] >>> 16) & 0xff, (H[i4] >>> 8) & 0xff, H[i4] & 0xff);
  return out;
}

function toHex(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return s;
}

function hmacSha256Hex(key, msg) {
  var block = 64;
  var k = utf8Bytes(key);
  if (k.length > block) k = sha256Bytes(k);
  while (k.length < block) k.push(0);
  var ipad = [], opad = [];
  for (var i = 0; i < block; i++) { ipad.push(k[i] ^ 0x36); opad.push(k[i] ^ 0x5c); }
  return toHex(sha256Bytes(opad.concat(sha256Bytes(ipad.concat(utf8Bytes(msg))))));
}

// 注意：QuickJS 无 WebCrypto，注入桥接也不提供密码学随机源，Math.random 是唯一可用来源。
// 影响有限：nonce 只是 HMAC 输入之一，签名安全性主要依赖密钥不泄露与时间戳/路径绑定；
// 仅凭可预测的 nonce、没有密钥无法伪造请求。如宿主日后提供更强随机源，再替换此处。
function nonceHex() {
  var s = "";
  var chars = "0123456789abcdef";
  for (var i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * 16));
  return s;
}

// ───────────────────────── spider
export default function createSpider(site) {
  var host = DEFAULT_HOST;
  var linePref = "";
  var sign = null;
  var cookie = "";
  var sessionReady = false;

  function init(ext) {
    var e = ext;
    if (!e) return;
    if (typeof e === "string") {
      try { e = JSON.parse(e); } catch (err) { e = null; }
    }
    if (e && typeof e === "object") {
      if (e.host) host = String(e.host).replace(/\/+$/, "");
      if (e.line) linePref = String(e.line);
    }
  }

  // 注意：重定向行为由宿主桥接（net.http / http）控制，脚本内无法禁用、也无法看到中间跳转。
  // 若桥接跟随跨站重定向，本函数注入的 Cookie 可能被带到第三方；这是桥接层限制，脚本无法从内部封堵。
  // 统一请求：返回 Promise<{code, headers, content}>
  function call(url, headers, method, body) {
    var h = {};
    for (var k in (headers || {})) h[k] = headers[k];
    if (cookie) h["Cookie"] = cookie;

    var opt = { headers: h, timeout: 15000 };
    if (body != null) {
      opt.method = method || "POST";
      opt.data = body;
      opt.postType = "json";
    }
    var p = HAS_NET ? net.http(url, opt) : (HAS_HTTP ? http(url, opt) : Promise.reject(new Error("无可用 HTTP 桥接")));
    return Promise.resolve(p).then(function (r) {
      try {
        var hs = (r && r.headers) || {};
        for (var k2 in hs) {
          if (String(k2).toLowerCase() === "set-cookie") {
            var v = hs[k2];
            if (v && String(v).length) cookie = String(v).split(";")[0];
          }
        }
      } catch (e) { }
      return r;
    });
  }

  function fetchSigning() {
    return call(host + "/", { "User-Agent": UA }, "GET", null).then(function (res) {
      var html = String((res && res.content) || "");
      var m = html.match(/\/assets\/movie-card-runtime-[A-Za-z0-9_\-]+\.js/);
      if (!m) throw new Error("未找到站点脚本");
      return call(host + m[0], { "User-Agent": UA }, "GET", null).then(function (r2) {
        var js = String((r2 && r2.content) || "");
        var km = js.match(/x-ai-movie-signature",[^;]{0,200}?"([0-9a-f]{64})"/);
        if (!km) throw new Error("未找到签名密钥（站点可能改版）");
        var bm = js.match(/dianyingtiantang-v[0-9][A-Za-z0-9._\-]*-web/);
        var pm = js.match(/\d{4}-\d{2}-\d{2}\.[a-z0-9.\-]*playback-v\d+/);
        var vm = js.match(/x-ai-movie-client-version",\s*"([^"]+)"/);
        return {
          key: km[1],
          client_version: vm ? vm[1] : "1.0.0",
          build_version: bm ? bm[0] : "",
          protocol_version: pm ? pm[0] : ""
        };
      });
    });
  }

  function signing() {
    if (sign) return Promise.resolve(sign);
    return Promise.resolve(fetchSigning()).then(function (s) { sign = s; return s; });
  }

  function baseHeaders(s, target, method) {
    var ts = String(Date.now());
    var nonce = nonceHex();
    var sig = hmacSha256Hex(s.key, method + "\n" + target + "\n" + ts + "\n" + nonce);
    var h = {
      "User-Agent": UA,
      "Accept": "application/json",
      "Referer": host + "/",
      "Origin": host,
      "x-ai-movie-timestamp": ts,
      "x-ai-movie-nonce": nonce,
      "x-ai-movie-signature": sig,
      "x-ai-movie-client-name": "dianyingtiantang-frontend",
      "x-ai-movie-client-version": s.client_version
    };
    if (s.build_version) h["x-ai-movie-build-version"] = s.build_version;
    if (s.protocol_version) h["x-ai-movie-protocol-version"] = s.protocol_version;
    return h;
  }

  function ensureSession() {
    if (sessionReady) return Promise.resolve(true);
    var target = "/v1/users/anonymous";
    return signing().then(function (s) {
      var headers = baseHeaders(s, target, "POST");
      headers["Content-Type"] = "application/json";
      return call(host + target, headers, "POST",
                  { anonymous_id: "web_" + nonceHex() });
    }).then(function (r) {
      sessionReady = !!(r && r.code >= 200 && r.code < 300);
      return sessionReady;
    }).catch(function () { return false; });
  }

  function api(path, params, method, payload) {
    return signing().then(function (s) {
      var parts = [];
      if (params) {
        Object.keys(params).forEach(function (k) {
          var v = params[k];
          if (v !== null && v !== undefined && String(v) !== "")
            parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
        });
      }
      var target = path + (parts.length ? "?" + parts.join("&") : "");
      var body = payload == null ? null : payload;

      function once(isRetry) {
        var headers = baseHeaders(s, target, method);
        if (body != null) headers["Content-Type"] = "application/json";
        return call(host + target, headers, method, body).then(function (res) {
          var code = res && res.code ? Number(res.code) : 0;
          var text = String((res && res.content) || "");
          if (code === 401 && !isRetry && !sessionReady &&
              (text.indexOf("session") >= 0 || text.indexOf("login_required") >= 0)) {
            return ensureSession().then(function (ok) {
              if (!ok) throw new Error("HTTP 401 @" + redactPath(target));
              return once(true);
            });
          }
          if (code < 200 || code >= 300) throw new Error("HTTP " + code + " @" + redactPath(target));
          try { return JSON.parse(text); } catch (err) { throw new Error("响应不是 JSON @" + redactPath(target)); }
        });
      }
      return once(false);
    });
  }

  function cards(list) {
    var out = [];
    (list || []).forEach(function (c) {
      if (!c || !c.id) return;
      out.push({
        vod_id: String(c.id),
        vod_name: c.title || "",
        vod_pic: proxyPic(c.poster_url || c.backdrop_url || ""),
        vod_remarks: c.remarks || "",
        vod_year: String(c.year || ""),
        vod_area: c.area || "",
        type_name: c.content_kind || ""
      });
    });
    return out;
  }

  function pageCount(data, page) {
    var pg = (data && data.pagination) || {};
    var total = Number(pg.total || 0), limit = Number(pg.limit || PAGE_LIMIT);
    if (total > 0) return Math.max(page, Math.min(Math.ceil(total / limit), 50));
    return pg.has_more ? page + 1 : Math.max(1, page);
  }

  // 部分分支把返回值强转 String，统一输出 JSON 字符串
  function J(o) { return JSON.stringify(o); }

  function home(filter) {
    var classes = KINDS.map(function (k) { return { type_id: k[0] || "all", type_name: k[1] }; });
    var result = { class: classes };
    if (filter) {
      var thisYear = new Date().getFullYear();
      var years = [{ n: "全部", v: "" }];
      for (var y = thisYear; y >= 2015; y--) years.push({ n: String(y), v: String(y) });
      var areas = [{ n: "全部", v: "" }].concat(AREAS.map(function (a) { return { n: a, v: a }; }));
      var rows = [
        { key: "year", name: "年份", init: "", value: years },
        { key: "area", name: "地区", init: "", value: areas }
      ];
      result.filters = {};
      classes.forEach(function (c) { result.filters[c.type_id] = rows; });
    }
    return J(result);
  }

  function homeVod() {
    return api("/v1/feed/home", { scope: "public", mode: "preview", sections: 3, cards: 10 }, "GET", null)
      .then(function (d) {
        var all = [];
        (d.sections || []).forEach(function (sec) { all = all.concat(sec.cards || []); });
        if (all.length) return J({ list: cards(all) });
        return api("/v1/browse/catalog", { page: 1, limit: PAGE_LIMIT }, "GET", null)
          .then(function (r) { return J({ list: cards(r.cards) }); });
      })
      .catch(function () { return J({ list: [] }); });
  }

  function category(tid, pg, filter, extend) {
    var e = extend || {};
    var params = { page: Number(pg || 1), limit: PAGE_LIMIT };
    if (tid && tid !== "all") params.kind = tid;
    if (e.year) params.year = e.year;
    if (e.area) params.area = e.area;
    var page = params.page;
    return api("/v1/browse/catalog", params, "GET", null).then(function (d) {
      return J({ list: cards(d.cards), page: page, pagecount: pageCount(d, page), limit: PAGE_LIMIT });
    });
  }

  function search(key, quick, pg) {
    var word = String(key || "").trim();
    var page = Number(pg || 1);
    if (!word) return Promise.resolve(J({ list: [], page: 1, pagecount: 1, limit: PAGE_LIMIT }));
    return api("/v1/browse/catalog", { page: page, limit: PAGE_LIMIT, q: word }, "GET", null)
      .then(function (d) {
        return J({ list: cards(d.cards), page: page, pagecount: pageCount(d, page), limit: PAGE_LIMIT });
      });
  }

  function episodes(vid) {
    var all = [];
    var seen = {};
    var pages = 0;
    function step(offset) {
      // 有界：最多 50 页（48 条/页），且 offset 必须前进、总量不超过服务端 episode_count；
      // token 去重，避免服务端重复返回同一集时无限循环。
      if (pages >= 50) return Promise.resolve(all);
      pages++;
      return api("/v1/catalog/" + encodeURIComponent(vid) + "/episodes", { limit: 48, offset: offset }, "GET", null)
        .then(function (d) {
          var batch = d.episodes || [];
          batch.forEach(function (ep) {
            var t = ep && ep.token;
            if (t) { if (seen[t]) return; seen[t] = 1; }
            all.push(ep);
          });
          var pg = d.episode_pagination || {};
          var total = Number(d.episode_count || 0);
          if (!pg.has_more || !batch.length) return all;
          if (total > 0 && all.length >= total) return all;
          var next = Number(pg.offset || offset) + Number(pg.returned_count || batch.length);
          if (next <= offset) return all;
          return step(next);
        });
    }
    return step(0);
  }

  function detail(id) {
    var vid = String(id);
    // 顺序请求：部分 QuickJS 桥接不支持并发 HTTP
    return api("/v1/catalog/" + encodeURIComponent(vid) + "/detail", null, "GET", null).then(function (d) {
      return episodes(vid).then(function (eps) { return [d, eps]; });
    }).then(function (res) {
      var d = res[0], eps = res[1] || [];
      if (!eps.length) throw new Error("该片暂无可用集数");
      var lines = [];
      eps.forEach(function (ep) {
        if (!ep.token) return;
        lines.push(safe(ep.title || ("第" + (ep.number || "") + "集")) + "$" + ep.token);
      });
      if (!lines.length) throw new Error("剧集缺少播放 token");
      return J({
        list: [{
          vod_id: vid,
          vod_name: d.title || "",
          vod_pic: proxyPic(d.poster_url || d.backdrop_url || ""),
          vod_remarks: d.remarks || d.episode_progress_text || "",
          vod_year: String(d.year || ""),
          vod_area: d.area || "",
          type_name: (d.genres || []).slice(0, 3).join(", "),
          vod_director: (d.directors || []).join(", "),
          vod_actor: (d.actors || []).slice(0, 8).join(", "),
          vod_content: d.description || "",
          vod_play_from: "看剧AI",
          vod_play_url: lines.join("#")
        }]
      });
    });
  }

  function rank(o) {
    var score = 0;
    if (String(o.url).indexOf("resolve://") !== 0) score -= 10;
    if (o.selected) score -= 3;
    if (linePref) {
      var label = String(o.label || "") + " " + String(o.provider_id || "");
      if (label.toLowerCase().indexOf(linePref.toLowerCase()) >= 0) score -= 100;
    }
    return score;
  }

  function resolveLine(ref, depth) {
    depth = depth || 0;
    if (!ref) return Promise.resolve("");
    if (String(ref).indexOf("resolve://") !== 0) return Promise.resolve(ref);
    if (depth >= 2) return Promise.resolve("");
    return api("/v1/playback/resolve-line", { view: "compact" }, "POST",
               { ticket: String(ref).replace("resolve://", "") })
      .then(function (d) { return resolveLine((d.line || {}).url || "", depth + 1); });
  }

  function play(flag, id, vipFlags) {
    var ticket = String(id || "").trim();
    if (!ticket) return Promise.resolve(J({ parse: 0, msg: "缺少播放标识" }));
    return api("/v1/playback/resolve/" + encodeURIComponent(ticket), { view: "compact" }, "GET", null)
      .then(function (d) {
        var options = (d.line_options || [])
          .filter(function (o) { return o && o.url && Number(o.minimum_user_level || 0) === 0; })
          .sort(function (a, b) { return rank(a) - rank(b); });
        if (!options.length) return J({ parse: 0, msg: "该集暂无可用线路" });

        var idx = 0, lastErr = "";
        function next() {
          if (idx >= options.length || idx >= MAX_LINE_TRIES)
            return J({ parse: 0, msg: "线路暂不可用" + (lastErr ? "：" + lastErr : "") });
          var o = options[idx++];
          return resolveLine(o.url || "").then(function (media) {
            if (!media) return next();
            var out = { parse: 0, url: media, header: { "User-Agent": UA, "Referer": host + "/" } };
            if (String(media).split("?")[0].toLowerCase().indexOf(".m3u8") >= 0)
              out.format = "application/x-mpegURL";
            return J(out);
          }).catch(function (err) {
            lastErr = String(err && err.message || err).slice(0, 80);
            return next();
          });
        }
        return next();
      });
  }

  // 错误文本用路径脱敏：去掉 query，非固定段折叠为 [id]，只保留接口名与状态码。
  // 影片 id / 播放 token 本身就在路径里，原样写进报错会随日志外泄。
  var PATH_STATIC = { v1: 1, browse: 1, catalog: 1, detail: 1, episodes: 1,
    playback: 1, resolve: 1, "resolve-line": 1, feed: 1, home: 1, users: 1, anonymous: 1 };
  function redactPath(target) {
    var path = String(target || "").split("?")[0];
    var parts = path.split("/").filter(function (p) { return p !== ""; })
      .map(function (p) { return PATH_STATIC[p] ? p : "[id]"; });
    return "/" + parts.join("/");
  }

  function safe(s) {
    return String(s || "").replace(/\$/g, "＄").replace(/#/g, "＃").trim() || "正片";
  }

  return {
    init: init,
    home: home,
    homeVod: homeVod,
    category: category,
    search: search,
    detail: detail,
    play: play
  };
}
