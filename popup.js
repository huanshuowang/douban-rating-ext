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

// 英文宣发噪声：如 “Official Teaser Trailer”“Final Trailer 2”“Official Clip”
// 英文“完整版”类后缀：如 “Full Comedy Special”“Full Movie”
const EN_FULL = /\b(?:full\s+)?(?:(?:stand[- ]?up\s+)?comedy\s+special|stand[- ]?up\s+special|special|movie|episode|show)\b(?=\s*$)|\bfull\s+(?:comedy\s+)?(?:special|movie|episode|show)\b/gi;
const EN_NOISE = /\b(?:official\s+)?(?:(?:final|first|new|main|teaser|launch|international|red[- ]band|extended|announcement)\s+)*(?:trailer|teaser|clip|promo|featurette|tv spot|sneak peek|first look|behind the scenes)(?:\s*#?\d+)?\b/gi;
const SITE_ONLY = new RegExp("^(?:" + SITE_NAMES + ")$", "i");

// 单段清洗：去括号、宣发噪声、单集标记
function cleanSegment(t) {
  return t
    .replace(/【.*?】|\[.*?\]|（.*?）|\(.*?\)|《|》/g, " ")
    // 剧集编号：S01E01 → 去掉；S02E03 → “第2季”
    .replace(/\bS(\d{1,2})\s*E\d{1,3}\b/gi, (_, s) => (+s > 1 ? " 第" + +s + "季 " : " "))
    .replace(/\b(?:EP?|Episode)\s*\d{1,3}\b/gi, " ")
    .replace(EN_NOISE, " ")
    .replace(EN_FULL, " ")
    // UGC 口播前后缀
    .replace(/(一口气看完|一口气|看完|全程(高能|无尿点)|建议收藏|好看到哭|封神|yyds)/gi, " ")
    // 宣发/花絮类噪声（任意位置）
    .replace(/(正式|先导|终极|独家|官方|首支|最新)?(预告片?|花絮|彩蛋|片段|MV|OST|开场|片头|片尾|reaction)/gi, " ")
    .replace(/(正片|完整版|无删减|导演剪辑版|全集|特辑|抢先看|官宣|定档|首播|开播|上线)/g, " ")
    // 字幕/翻译标记：“中英双语”“熟肉”“中字”
    .replace(SUB_MARKS, " ")
    // 画质/音轨：“1080P”“4K”“国语”
    .replace(/\b\d{3,4}[pP]\b|\b[48][kK]\b|国语|粤语|原声|超清|高清|蓝光|\bHDR\b|杜比/g, " ")
    .replace(/(完整)?(单口喜剧|脱口秀|喜剧)?专场/g, " ")
    // 结尾的单集标记（保留“第N季/部”，只去“第N集/话/期”）：如“繁花 第01集”→“繁花”
    .replace(/\s*第\s*[0-9]{1,4}\s*[集话期]\s*$/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-|·、,，.。!！?？~～:：]+|[\s\-|·、,，.。!！?？~～:：]+$/g, "")
    .trim();
}

// 《作品名》后紧跟的“第N季/部”或续作数字；数字后若是“-8集”“集”等则是集数范围，不要
// 例：“《亢奋》第三季正式预告” → “亢奋 第三季”；“《爱情重拍中》1-8集全” → “爱情重拍中”
const BOOK_RE = /《([^》]{1,40})》\s*(第[0-9一二三四五六七八九十]+[季部]|[0-9]{1,2}(?![0-9]|\s*[-–~～至到集话期]))?/;

// 字幕/翻译标记：“中英双语”“熟肉”“中字”
const SUB_MARKS = /(中英双语|中英字幕|双语字幕|中文字幕|中英|双语|中字|熟肉|生肉|自译|机翻|精校|英字|内封|字幕版?)/g;
const isCJK = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length >= (s.match(/[A-Za-z]/g) || []).length;

// 标题拆成若干“像片名”的段：第一个是主查询，其余作为候选
// 例：“【单口喜剧熟肉】快乐小偷–中英双语Thief of Joy –Gianmarco Soresi”
//   → main “快乐小偷 Thief of Joy”，parts [“快乐小偷”, “Thief of Joy”, “Gianmarco Soresi”]
function titleParts(raw) {
  let t = stripEmoji((raw || "").trim());
  // B站影视/正版片的 SEO 长标题：如“赌神2正片-电影-高清正版在线观看-bilibili-哔哩哔哩”
  // 特征是含“在线观看/哔哩哔哩/bilibili”，取第一段并去掉“正片”等尾巴
  if (/在线观看|哔哩哔哩|bilibili/i.test(t)) {
    t = t.split(/[-_|]/)[0];
  }
  // 含《作品名》：以书名号内为主，丢掉“正式预告”等宣发尾巴
  const bk = t.match(BOOK_RE);
  if (bk) {
    t = bk[1] + (bk[2] ? " " + bk[2] : "");
  }
  // 通用：剥离各网站塞进标题的站名 / “Watch” / “官方网站”等外壳
  t = stripSiteChrome(t);
  // 标题里括号中的年份，如“最后一案 El problema final (2026)”：搜索时带上，也用来核对结果
  const ym = (raw || "").match(/[(（\[【]\s*((?:19|20)\d{2})\s*[)）\]】]/);
  const year = ym ? ym[1] : "";
  // “片名 | Official Teaser Trailer | HBO Max” → 逐段清洗，取第一段像片名的
  // （先去括号，免得“【NEW自译|剧集】”里的竖线被当成分隔符）
  t = t.replace(/【.*?】|\[.*?\]|（.*?）|\(.*?\)/g, " ").replace(SUB_MARKS, "");
  // 分隔符：竖线、长短破折号；连字符只在一侧有空格、或中英文交界处才算
  // （“Spider-Man”“X战警-天启”不拆；“快乐小偷-Thief of Joy -Gianmarco Soresi”拆成三段）
  const segs = t.split(/\s*[|｜–—－]\s*|\s+-\s*|\s*-\s+|(?<=[\u4e00-\u9fff])-(?=[A-Za-z])|(?<=[A-Za-z])-(?=[\u4e00-\u9fff])/).map(cleanSegment)
    .filter((s) => s.length >= 2 && !SITE_ONLY.test(s));
  if (!segs.length) return { main: "", parts: [], year };
  let main = segs[0];
  // 前两段一中一英（同一部作品的中英文名）→ 合起来搜更准；
  // 后面紧跟的英文段（如演员名“Gianmarco Soresi”）也带上，豆瓣原名常是“演员: 专场名”
  if (segs[1] && isCJK(segs[0]) !== isCJK(segs[1]) && (segs[0] + segs[1]).length <= 40) {
    main = segs[0] + " " + segs[1];
    if (segs[2] && !isCJK(segs[2]) && !isCJK(segs[1]) && (main + segs[2]).length <= 60) main += " " + segs[2];
  }
  const parts = [...segs];
  // 同一段里“中文名 English Name”也拆出来当候选
  const mix = segs[0].match(/^(.*[\u4e00-\u9fff）」』])\s+([A-Za-z][^\u4e00-\u9fff]{3,})$/);
  if (mix) parts.push(mix[1].trim(), mix[2].trim());
  return { main, parts: parts.filter((x, i, a) => x !== main && a.indexOf(x) === i), year };
}
function cleanTitle(raw) {
  return titleParts(raw).main;
}

// ---------- 从标题 + 简介 + 标签里挑最可能的作品名 ----------
// 泛分类标签：单独出现时不当作片名
const GENERIC_TAGS = /^(?:(?:泰|韩|日|中|国|台|港|美|英|欧美|内地|华语)(?:百|腐|剧|影|综|片|漫)|(?:西班牙|法国|德国|意大利|俄罗斯|印度|英国|美国|日本|韩国|泰国|北欧|土耳其|墨西哥|巴西|澳洲|加拿大|欧洲|法|德|意|俄)(?:剧|片|电影|综艺|动漫)?|百合剧|GL剧|BL剧|.*搬运|正片|.*二创|cp|嗑cp|\d{1,4}|单口|单口喜剧|脱口秀|喜剧|幽默|stand[- ]?up(?:\s*comedy)?|.*comedy|talk ?show|搞笑.*|.*视频|熟肉|生肉|中英|双语|中英双语|中字|字幕|.*字幕组|翻译|英语|英语学习|英语听力|口语|电视剧|电影|剧集|韩剧|美剧|日剧|英剧|泰剧|国产剧|台剧|港剧|华语剧|网剧|短剧|神剧|新剧|好剧|追剧|综艺|动漫|动画|番剧|纪录片|影视|影视杂谈|影视剪辑|影视解说|影视解读|电影解说|电视剧解说|电视剧杂谈|电影杂谈|剧情|悬疑|爱情|喜剧|恐怖|惊悚|科幻|动作|犯罪|百合|耽美|GL|BL|甜宠|古装|搞笑|推荐|解说|盘点|混剪|剪辑|高能|名场面|哔哩哔哩|bilibili|B站|弹幕|知识|生活|娱乐|.*企划|.*挑战|.*计划|.*打卡)$/i;
// 带地区/类型前缀的标签：“泰剧可以爱吗”“电影盗梦空间” → 前缀后面就是片名，是很强的信号
const TAG_GENRE_PREFIX = /^(?:(?:泰|韩|日|美|英|台|港|国产|内地|华语|欧美|印度)(?:剧|影|综|片|漫)|电视剧|电影|网剧|短剧|纪录片|动漫|动画|番剧)\s*/;
// 标题像一句话而不是片名：“泰百最苏的一幕诞生了”“这剧谁懂”
const SENTENCE_TITLE = /[，！？。…!?]|[了吧啊呀呢么嘛哦哇]$|一幕|名场面|诞生|谁懂|绝了|太.{1,6}了|这.{0,2}[部剧片段]/;
// 画质/语言/字幕类标签：去掉后什么都不剩的就跳过
const TAG_TECH = /中文|英文|字幕|国语|粤语|原声|配音|高清|超清|蓝光|\d{3,4}p|4k|8k|hdr|杜比/gi;
// 简介里这类行的《》多半是歌名，跳过
const MUSIC_LINE = /BGM|音乐|歌曲|曲目|配乐|主题曲|片尾曲|片头曲|插曲|歌单/i;

function pickQuery(info) {
  const rawTitle = stripEmoji((info && info.title) || "");
  const { main: base, parts: titleAlts, year } = titleParts(rawTitle);
  // 【单口喜剧】【4K】这类方括号里是分类标签，不算“标题里提到了片名”
  const bracketText = (rawTitle.match(/【[^】]*】|\[[^\]]*\]/g) || []).join(" ");
  const norm = (s) => s.replace(/第[0-9一二三四五六七八九十]+[季部]|[\s·:：,，.。!！?？'"“”‘’\-—_/]/g, "").toLowerCase();
  // 用清洗后的标题判断“标题里提到了”：被洗掉的“中文字幕”“1080P”不算
  const titleKey = norm(titleBooks0(rawTitle) ? rawTitle.replace(/【[^】]*】|\[[^\]]*\]/g, " ") : base);
  const bracketKey = norm(bracketText);
  const cands = new Map(); // key -> { name, score, order }
  const add = (name, pts) => {
    name = (name || "").trim();
    const k = norm(name);
    if (k.length < 2 || SITE_ONLY.test(name)) return null;
    let c = cands.get(k);
    if (!c) { c = { name, score: 0, order: cands.size }; cands.set(k, c); }
    if (name.length > c.name.length) c.name = name; // 保留带“第N季”的完整名
    c.score += pts;
    return c;
  };

  // 1) 标题里的《》：最强信号（第一个带季数，即 base）
  const titleBooks = [...rawTitle.matchAll(/《([^》]{1,40})》/g)].map((m) => m[1]);
  if (titleBooks.length) {
    add(base, 6);
    titleBooks.slice(1).forEach((b) => add(b, 4));
  }
  // 2) 简介里的《》（如“电视剧选题：《现在不是出轨的问题》”）
  const descBooks = new Set();
  for (const line of ((info && info.desc) || "").split(/\n/)) {
    if (MUSIC_LINE.test(line)) continue;
    for (const m of line.matchAll(/《([^》]{1,40})》/g)) descBooks.add(m[1].trim());
  }
  for (const b of descBooks) {
    const c = add(b, 3);
    if (c && !titleBooks.length && titleKey.includes(norm(b))) c.score += 2; // 标题里也提到
  }
  // 3) 标签：与《》一致 → 强佐证；带“泰剧/电影”等前缀 → 强候选；其余非泛分类标签 → 弱候选
  for (const tag of new Set((info && info.tags) || [])) {
    let t = tag.replace(/^#|#$/g, "").trim();
    if (!t || /^发现《/.test(t) || GENERIC_TAGS.test(t)) continue; // “发现《一半一半》”是 BGM 标签
    if (!t.replace(SUB_MARKS, "").replace(TAG_TECH, "").trim()) continue; // “中文字幕”“1080P”“国语”
    if (bracketKey && bracketKey.includes(norm(t))) continue;        // 与【分类】重复
    const stripped = t.replace(TAG_GENRE_PREFIX, "").replace(/\s*(?:cut|混剪|剪辑|解说|名场面|片段)$/i, "").trim();
    const prefixed = stripped !== t;
    if (prefixed) {
      if (stripped.length < 2 || GENERIC_TAGS.test(stripped)) continue; // “韩剧推荐”“电影解说”
      t = stripped;
    }
    const existed = cands.has(norm(t));
    const c = add(t, existed ? 3 : prefixed ? 3 : 1);
    if (c && !existed && titleKey.includes(norm(t))) c.score += 2;
  }

  const ranked = [...cands.values()].sort((a, b) => b.score - a.score || a.order - b.order);
  const best = ranked[0];
  // 标题本身像片名（短、无感叹问句）时，要更强的证据才覆盖它
  // 中文部分不长（中英双名“最后一案 El problema final”也算）、且不像一句话
  const cjkLen = (base.match(/[\u4e00-\u9fff]/g) || []).length;
  const titleIsName = base && cjkLen <= 16 && base.length <= 60 && !SENTENCE_TITLE.test(base);
  const threshold = titleBooks.length ? 0 : titleIsName ? 5 : 3;
  const q = best && best.score >= threshold ? best.name : base;
  // 候选：标题里拆出来的其他段 > 原标题 > 证据较强的标签（只出现一次的弱标签不列，免得全是“幽默”“2026”）
  const alts = [...titleAlts, base, ...ranked.filter((c) => c.score >= 2 || cands.size <= 2).map((c) => c.name)]
    .filter((s, i, a) => s && s !== q && a.indexOf(s) === i)
    .slice(0, 4);
  return { q, alts, year };
}
const titleBooks0 = (t) => /《[^》]{1,40}》/.test(t);

// 在页面里执行（会被序列化注入，必须自包含）：读片名 + 简介 + 标签
function pageInfo() {
  const txt = (e) => (e ? (e.textContent || "").trim() : "");
  const first = (sel) => {
    for (const e of document.querySelectorAll(sel)) { const t = txt(e); if (t) return t; }
    return "";
  };
  const host = location.hostname;
  let title = "", desc = "", tags = [];
  if (/(^|\.)youtube\.com$/.test(host)) {
    title = first("ytd-watch-metadata h1, h1.ytd-video-primary-info-renderer, ytd-reel-video-renderer[is-active] h2, yt-shorts-video-title-view-model");
    desc = first("ytd-text-inline-expander #snippet-text, #description-inline-expander");
  } else if (/(^|\.)bilibili\.com$/.test(host)) {
    desc = first(".desc-info-text, .basic-desc-info, #v_desc");
    // 跳过 BGM 标签（.bgm-link，如“发现《一半一半》”）和活动话题（.topic-link）
    tags = [...document.querySelectorAll(".tag-link:not(.bgm-link):not(.topic-link)")].map(txt).filter(Boolean);
  }
  // 影视/番剧 PGC 页：媒体标题元素最干净（如“赌神2”）；UGC 视频页用 h1
  if (!title) title = first('[class*="mediaTitle"], [class*="media-title"], .media-info-title-t, .media-title, h1.video-title');
  if (!title) {
    const e = document.querySelector("h1[title]");
    if (e) title = (e.getAttribute("title") || txt(e)).trim();
  }
  // og:title 在单页应用里换视频后不更新，只有和当前 document.title 对得上才用
  if (!title) {
    const og = document.querySelector('meta[property="og:title"]');
    const v = og ? (og.content || "").trim() : "";
    if (v && document.title.includes(v)) title = v;
  }
  if (!title) title = document.title;
  return { title: (title || "").trim(), desc: desc.slice(0, 3000), tags: [...new Set(tags)].slice(0, 30) };
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
// 条目的所有名字：完整标题（中文名 + 原名）+ “又名”，用来核对查询词是不是这部
function extractSubjectAliases(html) {
  const full = (html.match(/<span property="v:itemreviewed">([^<]+)<\/span>/) || [])[1] || "";
  const aka = (html.match(/<span class="pl">又名:<\/span>([^<]*)/) || [])[1] || "";
  return (full + " / " + aka).replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}
function parseSubject(html) {
  const rating = extractStrictRating(html);
  const name = extractSubjectName(html);
  const aliases = extractSubjectAliases(html);
  const full = ((html.match(/<span property="v:itemreviewed">([^<]+)<\/span>/) || [])[1] || "").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const original = name && full.startsWith(name) ? full.slice(name.length).trim() : "";
  const year = (html.match(/<span class="year">\s*\((\d{4})\)/) || [])[1] || "";
  const text = html.replace(/<[^>]+>/g, " ");
  const unrated = !rating && /暂无评分|尚未上映|还未上映|评价人数不足/.test(text);
  return { rating, name, original, year, aliases, unrated };
}
// 豆瓣有时会把请求转去 sec.douban.com 做“人机验证”。浏览器里打开会自动通过，
// 但插件的后台请求过不去 —— 要识别出来，提示用户打开一次条目页，而不是含糊地说“没读到分数”。
const isDoubanPage = (html) => /property="v:itemreviewed"|<title>[^<]*\(豆瓣\)\s*<\/title>/.test(html);
async function fetchDoubanSubject(id) {
  const url = "https://movie.douban.com/subject/" + id + "/";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    // 先不跟随跳转：被转去验证页时，能明确知道是“被拦”而不是网络错误
    const r = await fetch(url, { signal: ctrl.signal, credentials: "include", redirect: "manual" });
    if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
      // 也可能是条目合并后的正常跳转：跟随一次，拿到的是条目页就照常解析
      const r2 = await fetch(url, { signal: ctrl.signal, credentials: "include" }).catch(() => null);
      const html2 = r2 ? await r2.text() : "";
      return r2 && !/sec\.douban\.com/.test(r2.url) && isDoubanPage(html2) ? parseSubject(html2) : { blocked: true };
    }
    const html = await r.text();
    if (/sec\.douban\.com/.test(r.url) || !isDoubanPage(html)) return { blocked: true };
    return parseSubject(html);
  } catch (_) {
    return { failed: true };
  } finally {
    clearTimeout(timer);
  }
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

// 有条目的全部名字时，用它来核对：中文看连续词是否出现，英文看主要单词是否过半出现
// 例：“Thief of joy” vs “欢愉的艺术 L'arte della gioia” → 对不上；
//     “Spirited Away” vs “千与千寻 千と千尋の神隠し / 神隐少女 / Spirited Away” → 对得上
const EN_STOP = new Set(["the", "and", "for", "with", "from", "season", "part"]);
function nameMatches(query, aliases) {
  const hay = aliases.toLowerCase();
  const runs = (query.replace(/第[0-9一二三四五六七八九十]+[季部集]/g, " ").match(/[\u4e00-\u9fff]{2,}/g) || []);
  if (runs.some((r) => hay.includes(r))) return true;
  const hayRuns = (aliases.match(/[\u4e00-\u9fff]{2,}/g) || []);
  if (hayRuns.some((h) => query.includes(h))) return true;
  const words = (query.toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !EN_STOP.has(w));
  const hayWords = new Set(hay.match(/[a-z]{3,}/g) || []);
  if (words.length) return words.filter((w) => hayWords.has(w)).length / words.length > 0.5;
  return !runs.length; // 查询词既没中文也没英文单词（如纯数字）→ 没法判断，不报警
}

// 完整解析：汇总搜索 → 优先读条目页（官方数据）→ 失败才用“与查询词匹配”的摘要评分
async function resolve(q, year) {
  const { id, pairs } = await gatherSources(year ? q + " " + year : q);
  // 只保留片名和查询词对得上的评分对（分数与片名同出一条摘要）
  // 摘要里的“片名”可能是网址碎片（如“doulist 豆瓣评分 8.0”），这种不算
  const junk = (n) => /doulist|douban|subject|豆瓣|^https?|^www/i.test(n);
  // 必须“正向对得上”：英文查询 + 中文摘要名（如“相关搜索 豆瓣评分 9.0”）不再放行
  const matched = pairs.find((p) => !junk(p.name) && nameMatches(q, p.name)) || null;

  let rating = null, name = null, original = "", subYear = "", aliases = "", unrated = false, failed = false, blocked = false;

  if (id) {
    const sub = await fetchDoubanSubject(id); // 官方数据最准
    if (!sub.failed && !sub.blocked) {
      name = sub.name || null;
      aliases = sub.aliases || "";
      original = sub.original || "";
      subYear = sub.year || "";
      if (sub.rating) rating = sub.rating;
      else unrated = sub.unrated;
    } else if (matched) {
      // 条目页读不到：只信“与查询词匹配”的摘要评分，绝不用别的电影的分
      rating = matched.rating;
      name = matched.name;
    } else if (sub.blocked) {
      blocked = true; // 豆瓣要求人机验证，摘要里也没有对得上的分
    } else {
      failed = true; // 有条目但读不到分、摘要也没匹配的分
    }
  } else if (matched) {
    rating = matched.rating;
    name = matched.name;
  }

  return { rating, id, name, original, year: subYear, aliases, unrated, failed, blocked };
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function bindManual(q) {
  for (const id in SEARCH) $(id).href = SEARCH[id](q || "");
}

// 分数档位：颜色 + 一句话评价
function tierOf(r) {
  r = parseFloat(r);
  if (r >= 9) return { tier: 5, verdict: "封神" };
  if (r >= 8) return { tier: 4, verdict: "好看" };
  if (r >= 7) return { tier: 3, verdict: "还行" };
  if (r >= 6) return { tier: 2, verdict: "一般" };
  return { tier: 1, verdict: "慎入" };
}

let countTimer = 0;
function countUp(el, target) {
  cancelAnimationFrame(countTimer);
  const end = parseFloat(target);
  if (reduceMotion || !(end > 0)) { el.textContent = target; return; }
  const t0 = performance.now(), dur = 520;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = (end * eased).toFixed(1);
    if (k < 1) countTimer = requestAnimationFrame(step);
  };
  countTimer = requestAnimationFrame(step);
}

// state: loading | rated | na | idle
function renderCard(state, o = {}) {
  const card = $("card");
  card.className = "card " + state;
  card.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  if (o.tier) card.dataset.tier = o.tier; else delete card.dataset.tier;

  const score = $("score");
  if (state === "rated") countUp(score, o.score);
  else { cancelAnimationFrame(countTimer); score.textContent = state === "loading" ? "0.0" : "—"; }

  $("stars").style.setProperty("--pct", o.pct ? o.pct + "%" : "0%");
  $("title").textContent = o.title || " ";
  $("title").title = o.title || "";
  $("sub").textContent = o.sub || "";
  $("verdict").textContent = o.verdict || "";
  $("verdict").hidden = !o.verdict;
}

function setWarn(text) {
  $("warn").hidden = !text;
  $("warnText").textContent = text || "";
}

function setOpen(url, text, ghost) {
  const open = $("open");
  if (!url) { open.hidden = true; return; }
  open.hidden = false;
  open.href = url;
  open.classList.toggle("ghost", !!ghost);
  $("openText").textContent = text;
}

function showResult(query, res, hintYear) {
  const rating = res && res.rating;
  const id = res && res.id;
  // 豆瓣官方名：“中文译名 · 原名”，取不到就用搜索词
  const name = res && res.name
    ? res.name + (res.original && res.original !== res.name ? " · " + res.original : "")
    : query;
  const url = id ? "https://movie.douban.com/subject/" + id + "/" : SEARCH.doubanS(name);

  if (rating) {
    const { tier, verdict } = tierOf(rating);
    renderCard("rated", { score: rating, pct: parseFloat(rating) * 10, title: name, sub: "豆瓣评分", tier, verdict });
  } else if (res && res.unrated) {
    renderCard("na", { title: name, sub: "豆瓣暂无评分（未上映或评价人数不足）" });
  } else if (res && res.blocked) {
    renderCard("na", { title: name, sub: "豆瓣要求先验证一下" });
  } else if (id) {
    renderCard("na", { title: name, sub: "找到了条目，但没读到分数" });
  } else {
    renderCard("na", { title: query, sub: "没找到 · 换个片名试试，或用下方搜索" });
  }
  // 匹配到的其实是相似的别的条目 → 明确提醒（片名已按豆瓣官方显示）
  // 名字对不上，或年份差了一年以上（标题写着 2026，条目是 2015 的同名片）
  const yearOff = hintYear && res && res.year && Math.abs(+hintYear - +res.year) > 1;
  const mismatch = (rating || (res && res.unrated)) && (yearOff ||
    (res.aliases ? !nameMatches(query, res.aliases) : looksMismatch(query, res && res.name)));
  if (res && res.blocked) {
    setWarn("点下方按钮打开豆瓣页面，通过验证后再点一次插件，就能直接出分了。通常验证一次，之后一段时间都不用再验");
    setOpen(url, "打开豆瓣验证", false);
    return;
  }
  setWarn(mismatch ? "豆瓣上最接近的是《" + name + "》，可能不是「" + query + "」" : "");
  setOpen(url, id ? "在豆瓣查看" : "去豆瓣搜索", !id);
}

let lookupSeq = 0;
let pageYear = "", pageQueries = new Set(); // 年份只用于从本页认出来的片名，手动输入的别的片不带
async function lookup(q) {
  const year = pageQueries.has(q) ? pageYear : "";
  const seq = ++lookupSeq; // 连续回车/点候选时，只显示最后一次的结果
  bindManual(q);
  setWarn("");
  setOpen(null);
  renderCard("loading", { sub: "正在问 Google · Bing · 百度…" });

  const key = "db7:" + q + (year ? "|" + year : ""); // 升版失效旧缓存（此前可能存了误抓的评分）
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.t < CACHE_TTL) {
    if (seq === lookupSeq) showResult(q, cached.v, year);
    return;
  }
  const res = await resolve(q, year);
  // 只缓存确定的结果（有分 / 暂无评分）；被拦、没找到、读取失败下次重新查
  if (res.rating || res.unrated) await chrome.storage.local.set({ [key]: { t: Date.now(), v: res } });
  if (seq === lookupSeq) showResult(q, res, year);
}

// 其他候选片名：点一下就换成它重查
function renderAlts(alts) {
  const box = $("alts");
  box.hidden = !alts.length;
  for (const a of alts) {
    const b = document.createElement("button");
    b.className = "alt";
    b.textContent = a;
    b.title = "用「" + a + "」重查";
    b.addEventListener("click", () => { $("kw").value = a; lookup(a); });
    box.appendChild(b);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { $("host").textContent = new URL(tab.url).hostname.replace(/^www\./, ""); } catch (_) {}

  let info = null;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageInfo });
    info = r?.result || null;
  } catch (_) {}
  if (!info || !info.title) info = { title: tab?.title || "", desc: "", tags: [] };

  let { q, alts, year } = pickQuery(info);
  // 页面元素没读到像样的片名（如只剩“YouTube”）→ 退回标签页标题再试一次
  if (!q && tab?.title && tab.title !== info.title) ({ q, alts, year } = pickQuery({ title: tab.title }));
  pageYear = year || "";
  pageQueries = new Set([q, ...alts]);

  const kw = $("kw");
  kw.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      const v = kw.value.trim();
      if (v) lookup(v);
    }
  });

  if (!q) {
    // 没读到片名也不是死路：直接让用户输入
    $("hint").textContent = "这个页面没读到片名，输入片名回车即可";
    bindManual("");
    renderCard("idle", { title: "输入片名开始", sub: "支持中文名、英文名、原名" });
    kw.focus();
    return;
  }
  kw.value = q;
  renderAlts(alts);
  lookup(q);
  kw.focus();
  kw.select(); // 想换片名时直接打字即可覆盖
}

init();
