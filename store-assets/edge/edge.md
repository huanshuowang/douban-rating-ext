# 上架 Edge 加载项商店

上传包：仓库根目录的 `douban-rating-ext.zip`（v1.2.0，和 Chrome 商店用同一个包）
官方文档：<https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension>

## 第 0 步：注册开发者账号（免费，一次性）

1. 打开 Partner Center：<https://partner.microsoft.com/dashboard/microsoftedge/public/login>
   用 Microsoft 账号（Outlook / Hotmail）登录；没有的话可以直接用 GitHub 账号登录，会自动帮你建一个。
   **不能用公司或学校账号。**
2. 弹出「Microsoft Edge Developer Account Registration」表单（没弹出就去 Account settings → Programs → Microsoft Edge → Get started）：
   - **Account country/region**：选你所在的国家（注册后不能改）
   - **Account type**：选 **Individual**（个人；验证快，公司账号要几天到几周，注册后也不能改）
   - **Publisher display name**：商店里显示的开发者名，比如 `Happy`（最多 50 个字符，不能和别人重名）
   - **Contact info**：填你的邮箱，比如 `happywang.dev@gmail.com`
   - 勾选同意 App Developer Agreement → **Finish**
3. 等确认邮件。个人账号一般很快；等的时候可以先做下面的步骤。

## 第 1 步：新建扩展、上传包

Partner Center → Edge → **Create new extension** → 把 `douban-rating-ext.zip` 拖进去 → 校验通过后点 **Continue**。

## 第 2 步：Availability（谁能看到）

- **Visibility**：`Public`
- **Markets**：保持默认的「所有市场」（包含中国大陆，这就是上 Edge 的主要目的）

→ **Save & Continue**

## 第 3 步：Properties（属性）

| 字段 | 填 |
| --- | --- |
| Category | **Entertainment**（和 Chrome 商店一致） |
| Website | `https://huanshuowang.com/douban-rating-ext/` |
| Support contact detail | `happywang.dev@gmail.com` |
| Mature content | 不勾 |

→ **Save & Continue**

## 第 4 步：Privacy（隐私）

**Single Purpose Description**（审核员看，用英文）：

```
Shows the Douban rating of the movie or TV show on the current page. When the user clicks the toolbar icon, presses the keyboard shortcut, or right-clicks selected text, the extension reads the page title/description (or the selected text), finds the matching Douban entry via public search results, and displays its rating with a link to the Douban page.
```

**Permission justification**（每个权限一栏）：

| 权限 | 填 |
| --- | --- |
| activeTab | `Read the title, description and tags of the current tab only after the user clicks the icon or presses the shortcut, to identify the movie/show name.` |
| scripting | `Inject a one-time function into the active tab (granted by activeTab) to read the page title, video description and tags. No persistent content scripts.` |
| storage | `Cache lookup results locally for 7 days, and store a local counter used to show a one-time "leave a review" prompt. Nothing is uploaded.` |
| contextMenus | `Adds a "查豆瓣评分 (Look up Douban rating)" item for selected text, so the user can look up any title they select.` |
| Host permissions (google.com / bing.com / baidu.com / movie.douban.com) | `Fetch search result pages from Google, Bing and Baidu to find the Douban entry and rating, and read at most one Douban movie page to confirm the official rating. Requests are made only when the user triggers a lookup.` |

**Are you using remote code?** → `No, I am not using remote code`

**Data usage**：
- 「What user data do you plan to collect」：勾 **Website content**（和 Chrome 商店的声明保持一致——插件会读页面标题并作为关键词发给搜索引擎；开发者不收集、不上传）
- 下面三条认证声明（不出售数据 / 不用于无关用途 / 不用于信用评估）全部勾上

**Privacy policy URL**：`https://huanshuowang.com/douban-rating-ext/privacy.html`

→ **Save & Continue**

## 第 5 步：Store listings（商店页）

包里没有多语言文件，Partner Center 一般只会列出一种语言。在那一行点 **Edit details** 填中文；再用 **Add a language** 加一个 English，填下面的英文版（多一个英文搜索入口，海外用户也能搜到）。

| 字段 | 中文 / 英文都用 |
| --- | --- |
| Extension logo | `store-assets/edge/logo-300.png`（300×300），上传后点 Duplicate 复制到所有语言 |
| Small promotional tile | `store-assets/promo-small-440x280.png` |
| Large promotional tile | `store-assets/promo-marquee-1400x560.png` |
| Screenshots（最多 6 张） | `store-assets/screenshot-1.png` ~ `screenshot-5.png`（都是 1280×800，符合要求） |
| YouTube video URL | 宣传片传到 YouTube 后填上；**记得在 YouTube 关掉这个视频的广告**（Edge 要求） |

名字和简短描述来自 manifest，这里改不了。

### 中文 Description（至少 250 字，直接粘贴）

```
一秒看懂「这部电影 / 电视剧豆瓣多少分」。

看电影、追剧、刷 B 站解说、逛 Netflix / YouTube / 爱奇艺 / 必应搜索时，只要页面上有片名，点一下工具栏图标，立刻显示它的豆瓣评分，并一键直达豆瓣条目页。看片前想先看口碑？再也不用切来切去手动搜豆瓣了。

【为什么好用】
✅ 哪都能用：电影、电视剧、综艺、动漫、纪录片，流媒体详情页、影视解说、预告片、搜索结果页都能查
✅ 解说视频也认得：标题没写片名时，会读 B 站简介和标签找出片名（自动跳过 BGM、话题、分类标签）
✅ 直接出分：豆瓣评分 + 星级 + 一句话结论（封神 / 好看 / 还行 / 一般 / 慎入），片名按「中文名 · 原名」显示
✅ 中英文片名都认得：Interstellar → 星际穿越，Spirited Away → 千与千寻
✅ 认错会提醒：名字或年份对不上时提示「可能不是…」，并给出「也可能是」候选，一点即换
✅ 快捷键：按 Alt+Shift+D（Mac：⌃⇧D）等于点图标
✅ 右键查分：在任何网页选中片名，右键「查豆瓣评分」
✅ 国内能用：Google 打不开时自动用必应、百度的结果
✅ 深色模式：跟随系统自动切换

【隐私安全】
不碰豆瓣搜索接口，不会被封 IP；只在你点图标、按快捷键或右键查分时联网，浏览网页期间零请求；没有开发者服务器，不收集任何数据。

本插件为非官方工具，与豆瓣无关联。
```

### English Description

```
See the Douban rating of any movie or TV show you're looking at — in one click.

Browsing Netflix, YouTube, Bilibili, iQIYI or a search results page? Click the toolbar icon and the extension reads the title on the page, finds the matching Douban entry and shows its rating, stars and a one-word verdict, with a button that opens the Douban page.

WHY IT'S HANDY
• Works on any page with a title: streaming detail pages, trailers, recap videos, search results
• Understands recap videos: when the video title doesn't name the film, it reads the Bilibili description and tags (skipping BGM and topic tags)
• Chinese and English titles: Interstellar → 星际穿越, Spirited Away → 千与千寻
• Warns you when the match looks wrong (different name or year) and offers alternative candidates
• Keyboard shortcut: Alt+Shift+D (Mac: Control+Shift+D)
• Right-click any selected title → "查豆瓣评分" (look up Douban rating)
• Works in mainland China: falls back to Bing and Baidu when Google isn't reachable
• Dark mode

PRIVACY
Never calls Douban's search API, so no IP bans. Goes online only when you click the icon, press the shortcut or use the right-click menu — zero requests while you browse. No developer server, no data collection.

Unofficial tool, not affiliated with Douban.
```

### Search terms（每种语言最多 7 个，每个 ≤30 字符，合计 ≤21 个词）

- 中文：`豆瓣评分` `豆瓣` `豆瓣电影` `查豆瓣评分` `电影评分` `电视剧评分` `Netflix 豆瓣`
- English：`Douban` `Douban rating` `Douban movie` `Chinese movie rating` `movie rating` `Netflix rating` `Bilibili`

## 第 6 步：Notes for certification → Publish

在 Store listings 页右上角点 **Publish**，把下面这段贴进 Notes for certification：

```
No account or login is needed.

How to test:
1. After installing, a welcome page opens automatically. Click the extension's toolbar icon (or press Alt+Shift+D) while on that page: the popup identifies the demo video as "盗梦空间 (Inception)" and shows its Douban rating.
2. Open any movie page, e.g. https://www.imdb.com/title/tt0816692/ , and click the icon: it shows the Douban rating of Interstellar (星际穿越).
3. Select the text "星际穿越" on any page, right-click and choose "查豆瓣评分：「星际穿越」".

Network: the extension only makes requests when the user triggers a lookup. It fetches Google/Bing/Baidu search result pages and at most one movie.douban.com subject page. Where Google is unreachable (e.g. mainland China), Bing/Baidu results are used. Occasionally Douban asks for a human check; the popup then shows a button to open the Douban page once.

Uninstalling opens a short optional feedback page on our website (huanshuowang.com/douban-rating-ext/bye.html).
```

再点一次 **Publish**。审核最多 7 个工作日；通过后状态变成 **In the Store**。

## 上架之后

- 在 Partner Center 的 Extension Overview 里复制商店链接，发给我，我把它加到介绍页（加一个「添加至 Edge」按钮）和 README。
- 弹窗里的「去评价」会自动识别：从 Edge 商店装的用户跳 Edge 商店页，从 Chrome 商店装的跳 Chrome 商店评论页。
- 以后每次发新版：Chrome 和 Edge 都要各传一次 zip。Edge 在 Partner Center → 你的扩展 → **Packages** → 上传新包 → Publish。
