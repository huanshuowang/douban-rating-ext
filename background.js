// 后台：装好后打开欢迎页 / 右键「查豆瓣评分」/ 卸载后打开反馈页。
// 这里不发任何网络请求 —— 查分仍然只在弹窗里、由你主动触发时进行。

const SITE = "https://huanshuowang.com/douban-rating-ext/";
const MENU_ID = "lookup-selection";
const isEdge = /\bEdg\//.test(navigator.userAgent);

// 卸载后打开的反馈页：只带版本号和浏览器，方便区分是哪个版本、哪家商店的用户
chrome.runtime.setUninstallURL(
  SITE + "bye.html?v=" + chrome.runtime.getManifest().version + "&b=" + (isEdge ? "edge" : "chrome")
);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // 右键菜单只需注册一次（升级时先清掉旧的，免得 id 重复报错）
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "查豆瓣评分：「%s」", contexts: ["selection"] });
  });
  // 只在首次安装时打开欢迎页；升级不打扰老用户
  if (reason === "install") chrome.tabs.create({ url: "welcome.html" });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) lookupSelection(info.selectionText, tab);
});

// 把选中的文字交给弹窗去查：弹窗打开后会先读这里（15 秒内有效，用完即删）
async function lookupSelection(text, tab) {
  const q = (text || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!q) return;
  let host = "";
  try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch (_) {}
  await chrome.storage.session.set({ pending: { q, host, t: Date.now() } });
  try {
    await chrome.action.openPopup(tab ? { windowId: tab.windowId } : {});
  } catch (_) {
    // 较旧的浏览器不能从右键直接弹出：退而在小窗口里打开同一个面板
    chrome.windows.create({ url: "popup.html", type: "popup", width: 380, height: 480 });
  }
}
