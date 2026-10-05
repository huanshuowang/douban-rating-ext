// 欢迎页：实时检查图标有没有固定、演示有没有点过，并显示实际分配到的快捷键
const isEdge = /\bEdg\//.test(navigator.userAgent);
const $ = (id) => document.getElementById(id);
document.documentElement.dataset.browser = isEdge ? "edge" : "chrome";
document.title = WELCOME_TITLE;

// ---------- 演示视频 ----------
$("vTitle").textContent = DEMO_PAGE.title;
$("vDesc").textContent = DEMO_PAGE.desc;
for (const t of DEMO_PAGE.tags) {
  const s = document.createElement("span");
  s.textContent = t;
  $("vTags").appendChild(s);
}

// 直接双击文件打开（file://）时没有插件接口：只提示从插件里打开，不显示状态和快捷键
if (!(window.chrome && chrome.runtime && chrome.runtime.id)) {
  $("outside").hidden = false;
  document.querySelectorAll(".status, .sc-wrap, #scEdit").forEach((el) => { el.hidden = true; });
} else {
  function setStep(id, done, status) {
    $(id).dataset.done = done;
    if (status) $(id).querySelector(".status").textContent = status;
  }

  // ---------- 1. 固定到工具栏 ----------
  async function checkPin() {
    try {
      const { isOnToolbar } = await chrome.action.getUserSettings();
      setStep("stepPin", isOnToolbar, isOnToolbar ? "✓ 已固定" : "还没固定");
    } catch (_) {
      $("pinStatus").hidden = true; // 浏览器太旧，查不了就不显示状态
    }
  }
  checkPin();
  setInterval(checkPin, 1000);

  // 弹窗在这一页查到分后会写入 demoDone
  function showDemo(d) {
    if (!d) return;
    setStep("stepTry", true, "✓ 认出来了");
    const r = $("tryResult");
    r.hidden = false;
    r.textContent = "认出来了：《" + d.name + "》，豆瓣 ";
    const b = document.createElement("b");
    b.textContent = d.rating;
    r.appendChild(b);
  }
  chrome.storage.session.get("demoDone").then(({ demoDone }) => showDemo(demoDone));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes.demoDone) showDemo(changes.demoDone.newValue);
  });

  // ---------- 3. 快捷键 ----------
  // 建议的快捷键如果和别的插件撞了，浏览器不会分配，这里就提示用户自己设
  async function showShortcut() {
    const cmds = await chrome.commands.getAll();
    const sc = (cmds.find((c) => c.name === "_execute_action") || {}).shortcut || "";
    document.querySelectorAll(".sc").forEach((el) => { el.textContent = sc; });
    document.querySelectorAll(".sc-wrap").forEach((el) => { el.hidden = !sc; });
    $("scMissing").hidden = !!sc;
    $("scEdit").textContent = sc ? "改成别的快捷键" : "设置快捷键";
  }
  showShortcut();
  // 从快捷键设置页回来时刷新
  document.addEventListener("visibilitychange", () => { if (!document.hidden) showShortcut(); });
  $("scEdit").addEventListener("click", () => {
    chrome.tabs.create({ url: (isEdge ? "edge" : "chrome") + "://extensions/shortcuts" });
  });
}
