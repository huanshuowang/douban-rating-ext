// 这豆瓣评分多少？ —— popup 直接显示评分（Netflix / YouTube / 爱奇艺 / Bilibili / Google 搜索…通用）
// 流程：点图标 → 读当前页片名 → 同时问 Google/Bing/Baidu → 谁先解析出评分就用谁
//       → 显示评分 + 豆瓣直达链接。结果本地缓存 7 天。
// 只在“打开插件”时查询一次；抓的是搜索引擎摘要，不直接抓豆瓣。

const CACHE_TTL = 7 * 864e5;
const FETCH_TIMEOUT = 6000;

// ---------- 标题清洗（保守：只去括号/emoji，保留正文交给搜索引擎排名） ----------
function stripEmoji(s) {
  return s
    .replace(/[‍️⃣]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "");
}
// 站点名：用于从 <title> 里剥离“| Netflix”“- YouTube”“- Google Search”这类外壳
const SITE_NAMES =
  "YouTube|Bilibili|哔哩哔哩|Netflix|Disney\\+?|Hulu|HBO ?Max|Max|Prime Video|Amazon Prime Video|Amazon|Apple TV\\+?|Paramount\\+?|Peacock|Google Search|Google|Bing|Yahoo|DuckDuckGo|百度百科|百度|腾讯视频|优酷|爱奇艺|iQIYI|芒果TV|搜狐视频|1905电影网|WeTV|Viki|IMDb|Rotten Tomatoes|烂番茄|Metacritic|Letterboxd|TMDB|The Movie Database|Douban|豆瓣|Wikipedia|维基百科|Fandom|MyDramaList";

// 通用外壳清洗：把各大网站塞进标题的站名/动词/后缀去掉，只留片名
// 例：“Watch Margaret Cho: PsyCHO | Netflix” → “Margaret Cho: PsyCHO”
//     “长安的荔枝 - Google Search” → “长安的荔枝”
function stripSiteChrome(t) {
  t = t.replace(/^\(\d+\)\s*/, "");                        // YouTube 未读数前缀 "(3) "
  // 尾部站名段：如 “| Netflix”“- YouTube”“_腾讯视频”
  const tailRe = new RegExp(
    "\\s*[|｜_\\-–—]\\s*(?:" + SITE_NAMES + ")(?:[\\s,，、].*)?$", "i");
  // 国内流媒体 SEO 长标题的分类尾段：如 “-电视剧”“-电影”“_综艺”
  const catRe = /\s*[|｜_\-–—]\s*(?:电影|电视剧|剧集|综艺|动漫|动画|番剧|纪录片|微电影|短剧|预告片?|高清完整版|在线观看)\s*$/;
  let prev;
  do {
    prev = t;
    t = t.replace(tailRe, "").replace(catRe, "").trim();
  } while (t && t !== prev);
  t = t.replace(/^(?:Watch|观看|播放|Stream)\s+/i, "");      // Netflix 的 “Watch …”
  t = t.replace(/\s*[|｜\-–—]?\s*(?:Official Site|官方网站|官网)\s*$/i, "").trim();
  return t;
}

function cleanTitle(raw) {
  let t = stripEmoji((raw || "").trim());
  // B站影视/正版片的 SEO 长标题：如“赌神2正片-电影-高清正版在线观看-bilibili-哔哩哔哩”
  // 特征是含“在线观看/哔哩哔哩/bilibili”，取第一段并去掉“正片”等尾巴
  if (/在线观看|哔哩哔哩|bilibili/i.test(t)) {
    t = t.split(/[-_|]/)[0];
  }
  // 含《作品名》：以书名号内为主，保留紧随的“第N季/部/集”或数字，丢掉“正式预告”等宣发尾巴
  // 例：“《亢奋》第三季正式预告” → “亢奋 第三季”
  const bk = t.match(/《([^》]{1,40})》\s*(第[0-9一二三四五六七八九十]+[季部集]|[0-9]{1,3})?/);
  if (bk) {
    t = bk[1] + (bk[2] ? " " + bk[2] : "");
  }
  // 通用：剥离各网站塞进标题的站名 / “Watch” / “官方网站”等外壳
  t = stripSiteChrome(t);
  t = t
    .replace(/【.*?】|\[.*?\]|（.*?）|\(.*?\)|《|》/g, " ")
    // UGC 口播前后缀
    .replace(/(一口气看完|一口气|看完|全程(高能|无尿点)|建议收藏|好看到哭|封神|yyds)/gi, " ")
    // 宣发/花絮类噪声（任意位置）
    .replace(/(正式|先导|终极|独家|官方|首支|最新)?(预告片?|花絮|彩蛋|片段|MV|OST|开场|片头|片尾|reaction)/gi, " ")
    .replace(/(正片|完整版|无删减|导演剪辑版|全集|特辑|抢先看|官宣|定档|首播|开播|上线)/g, " ")
    // 结尾的单集标记（保留“第N季/部”，只去“第N集/话/期”）：如“繁花 第01集”→“繁花”
    .replace(/\s*第\s*[0-9]{1,4}\s*[集话期]\s*$/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-|·、,，.。!！?？~～:：]+|[\s\-|·、,，.。!！?？~～:：]+$/g, "")
    .trim();
  return t;
}
function pageTitle() {
  const pick = (sel) => {
    const e = document.querySelector(sel);
    return e ? (e.textContent || "").trim() : "";
  };
  // 影视/番剧 PGC 页：媒体标题元素最干净（如“赌神2”）
  let t = pick('[class*="mediaTitle"], [class*="media-title"], .media-info-title-t, .media-title');
  // UGC 视频页
  if (!t) t = pick("h1.video-title, .video-title");
  if (!t) {
    const e = document.querySelector("h1[title]");
    if (e) t = (e.getAttribute("title") || e.textContent || "").trim();
  }
  if (!t) {
    const og = document.querySelector('meta[property="og:title"]');
    if (og) t = (og.content || "").trim();
  }
  if (!t) t = document.title;
  return (t || "").trim();
}

// ---------- 搜索引擎入口（手动备用按钮也用它们） ----------
const SEARCH = {
  baidu:  (q) => "https://www.baidu.com/s?wd=" + encodeURIComponent(q + " 豆瓣 评分"),
  doubanS:(q) => "https://search.douban.com/movie/subject_search?search_text=" + encodeURIComponent(q),
  google: (q) => "https://www.google.com/search?q=" + encodeURIComponent(q + " 豆瓣 评分") + "&hl=zh-CN",
  // 去掉 site: 限定，让摘要里既可能有评分数字、也带豆瓣条目链接
  bing:   (q) => "https://www.bing.com/search?q=" + encodeURIComponent(q + " 豆瓣 评分"),
};

// ---------- 解析工具 ----------
function extractRating(html) {
  // 先试豆瓣条目页/结构化数据里的原始字段（最准）
  const direct = [
    /"ratingValue"\s*:\s*"?([0-9]\.[0-9])"?/,
    /rating_num[^>]*>\s*([0-9]\.[0-9])/,
    /v:average[^>]*>\s*([0-9]\.[0-9])/,
  ];
  for (const re of direct) {
    const m = html.match(re);
    if (m) { const v = parseFloat(m[1]); if (v > 0 && v <= 10) return m[1]; }
  }
  // 再试搜索摘要里的文字
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const pats = [
    /豆瓣评分[^0-9]{0,4}([0-9]\.[0-9])/,
    /豆瓣[：: ]{0,3}([0-9]\.[0-9])\s*分/,
    /豆瓣[^0-9]{0,6}?([0-9]\.[0-9])/,
    /评分[：:]\s*([0-9]\.[0-9])/,
    /([0-9]\.[0-9])\s*\/\s*10/,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 0 && v <= 10) return m[1];
    }
  }
  return null;
}
function extractName(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  let m = text.match(/《([^》]{1,30})》\s*豆瓣/);
  if (m) return m[1].trim();
  // “玩具总动员5豆瓣评分：8.1” → 取“豆瓣评分”前、遇标点就停的那段
  m = text.match(/([^，。！？、,.!?：:\s]{2,40})豆瓣评分/);
  if (m) return m[1].replace(/^[《]|[》]$/g, "").trim();
  return null;
}

function extractDoubanId(html) {
  const h = html.replace(/\\u002F/gi, "/").replace(/%2F/gi, "/").replace(/\\\//g, "/");
  const m = h.match(/douban\.com\/(?:movie\/)?subject\/(\d+)/);
  return m ? m[1] : null;
}

function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  // credentials:"include" —— 带上浏览器 cookie，让搜索引擎返回与你手动搜一致的完整页面，
  // 而不是给无 cookie 自动请求的“需要 JS 的空壳页”。豆瓣条目页同理（公开页，无害）。
  return fetch(url, { signal: ctrl.signal, credentials: "include" })
    .then((r) => r.text())
    .finally(() => clearTimeout(timer));
}

// 成对抓取“片名+评分”：只认同一条摘要里的 “XXX豆瓣评分：8.1”，让分数和片名绑定，
// 避免把页面上另一部电影的分/名拼到一起（四不像）。
function extractPairs(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const pairs = [];
  const re = /([^，。！？、,.!?：:\s《》]{2,40})\s*豆瓣评分[：: ]{0,3}([0-9]\.[0-9])/g;
  let m;
  while ((m = re.exec(text))) {
    const v = parseFloat(m[2]);
    if (v > 0 && v <= 10) pairs.push({ name: m[1].trim(), rating: m[2] });
  }
  return pairs;
}

// 单个来源：返回 { source, id, pairs }
function querySource(source, q) {
  return fetchText(SEARCH[source](q))
    .then((html) => ({ source, id: extractDoubanId(html), pairs: extractPairs(html) }))
    .catch(() => ({ source, id: null, pairs: [] }));
}

// 汇总三家：取第一个豆瓣条目 id + 合并所有“片名+评分”对
function gatherSources(q) {
  return Promise.all(["google", "baidu", "bing"].map((s) => querySource(s, q))).then((rs) => {
    let id = null;
    let pairs = [];
    for (const r of rs) {
      if (!id && r.id) id = r.id;
      if (r.pairs && r.pairs.length) pairs = pairs.concat(r.pairs);
    }
    return { id, pairs };
  });
}

// 读取单个豆瓣条目页：拿权威片名 + 评分 + “暂无评分”状态
function extractSubjectName(html) {
  let m = html.match(/<span property="v:itemreviewed">([^<]+)<\/span>/);
  if (!m) m = html.match(/<title>\s*([^<]+?)\s*\(豆瓣\)\s*<\/title>/);
  if (!m) return null;
  return m[1].split(/\s{2,}|\s(?=[A-Za-z])/)[0].trim(); // 去掉后面的英文/别名
}
// 条目页“严格取分”：只信结构化字段，绝不跑宽松文字正则
// （否则会误抓页面别处如侧边推荐/广告里的数字，把“尚未上映”当成 6.0）
function extractStrictRating(html) {
  const pats = [
    /"ratingValue"\s*:\s*"?([0-9]\.[0-9])"?/,   // JSON-LD（主条目唯一）
    /rating_num[^>]*>\s*([0-9]\.[0-9])\s*</,     // <strong class="rating_num">8.1</strong>
    /v:average[^>]*>\s*([0-9]\.[0-9])/,
  ];
  for (const re of pats) {
    const m = html.match(re);
    if (m) { const v = parseFloat(m[1]); if (v > 0 && v <= 10) return m[1]; }
  }
  return null; // 未上映/无评分时字段为空或 0，这里返回 null
}
function parseSubject(html) {
  const rating = extractStrictRating(html);
  const name = extractSubjectName(html);
  const text = html.replace(/<[^>]+>/g, " ");
  const unrated = !rating && /暂无评分|尚未上映|还未上映|评价人数不足/.test(text);
  return { rating, name, unrated };
}
function fetchDoubanSubject(id) {
  return fetchText("https://movie.douban.com/subject/" + id + "/")
    .then((html) => parseSubject(html))
    .catch(() => ({ failed: true }));
}

// 片名与查询词是否明显对不上（如“逃出绝命街”≠“逃出绝命镇”）
function looksMismatch(query, name) {
  if (!name || !query) return false;
  // 跨语言时（一个主要中文、一个主要英文）字符重叠没意义，跳过“可能不是”的误报
  const cjk = (s) => (s.match(/[一-鿿]/g) || []).length;
  const lat = (s) => (s.match(/[A-Za-z]/g) || []).length;
  if ((cjk(query) >= lat(query)) !== (cjk(name) >= lat(name))) return false;
  const norm = (s) => s.replace(/[\s第季部集话弹·:：0-9一二三四五六七八九十]/g, "");
  const a = norm(query), b = norm(name);
  if (a.length < 2 || b.length < 2) return false;
  return !(a.includes(b) || b.includes(a));
}

// 完整解析：汇总搜索 → 优先读条目页（官方数据）→ 失败才用“与查询词匹配”的摘要评分
async function resolve(q) {
  const { id, pairs } = await gatherSources(q);
  // 只保留片名和查询词对得上的评分对（分数与片名同出一条摘要）
  const matched = pairs.find((p) => !looksMismatch(q, p.name)) || null;

  let rating = null, name = null, unrated = false, failed = false;

  if (id) {
    const sub = await fetchDoubanSubject(id); // 官方数据最准
    if (!sub.failed) {
      name = sub.name || null;
      if (sub.rating) rating = sub.rating;
      else unrated = sub.unrated;
    } else if (matched) {
      // 条目页读不到：只信“与查询词匹配”的摘要评分，绝不用别的电影的分
      rating = matched.rating;
      name = matched.name;
    } else {
      failed = true; // 有条目但读不到分、摘要也没匹配的分
    }
  } else if (matched) {
    rating = matched.rating;
    name = matched.name;
  }

  return { rating, id, name, unrated, failed };
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);

function bindManual(q) {
  for (const id in SEARCH) $(id).href = SEARCH[id](q);
}

function showResult(query, res) {
  $("spin").style.display = "none";
  const meta = $("meta");
  const rating = res && res.rating;
  const id = res && res.id;
  const name = (res && res.name) || query; // 真实片名，取不到就用搜索词
  const url = id
    ? "https://movie.douban.com/subject/" + id + "/"
    : SEARCH.doubanS(name);

  meta.innerHTML =
    '<div id="title"></div><div id="sub"></div>';
  $("title").textContent = name;
  $("title").title = name;

  // 评分数字放到左侧
  let scoreEl = document.querySelector("#score");
  if (!scoreEl) {
    scoreEl = document.createElement("div");
    scoreEl.id = "score";
    $("result").insertBefore(scoreEl, meta);
  }
  let sub;
  if (rating) {
    scoreEl.className = "";
    scoreEl.textContent = rating;
    sub = "豆瓣评分";
  } else if (res && res.unrated) {
    scoreEl.className = "na";
    scoreEl.textContent = "暂无评分";
    sub = "该条目豆瓣暂未评分";
  } else if (id) {
    scoreEl.className = "na";
    scoreEl.textContent = "获取失败";
    sub = "点开在豆瓣查看";
  } else {
    scoreEl.className = "na";
    scoreEl.textContent = "未找到";
    sub = "试试改关键词，或用下方按钮手动查";
  }
  // 匹配到的其实是相似的别的条目 → 明确提醒（片名已按豆瓣官方显示）
  if ((rating || (res && res.unrated)) && looksMismatch(query, res && res.name)) {
    sub = "⚠ 可能不是《" + query + "》";
  }
  $("sub").textContent = sub;

  const open = $("open");
  open.href = url;
  open.style.display = "inline-block";
  open.textContent = id ? "在豆瓣查看" : "去豆瓣搜";
}

async function lookup(q) {
  bindManual(q);
  $("spin").style.display = "block";
  $("open").style.display = "none";
  const existScore = document.querySelector("#score");
  if (existScore) existScore.remove();
  $("meta").innerHTML = '<div id="title">查询中…</div><div id="sub"></div>';

  const key = "db3:" + q; // 升版失效旧缓存（此前可能存了误抓的评分）
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.t < CACHE_TTL) {
    showResult(q, cached.v);
    return;
  }
  const res = await resolve(q);
  await chrome.storage.local.set({ [key]: { t: Date.now(), v: res } });
  showResult(q, res);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let raw = "";
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageTitle });
    raw = r?.result || "";
  } catch (_) {
    raw = tab?.title || "";
  }

  const q = cleanTitle(raw) || stripEmoji(raw);
  if (!q) { $("empty").hidden = false; return; }

  $("app").hidden = false;
  const kw = $("kw");
  kw.value = q;
  kw.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = kw.value.trim();
      if (v) lookup(v);
    }
  });
  lookup(q);
}

init();
