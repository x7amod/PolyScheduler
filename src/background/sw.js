// sw.js — background service worker: badge + storage helpers
const STORAGE_KEY = "sc_aggregated";
const KEPT_KEY = "sc_keptCourses";

function badgeFor(aggregated, keptCourses) {
  const meta = aggregated?.coursesMeta || {};
  const totalCourses = Object.keys(meta).length;
  if (!totalCourses) return "";
  if (keptCourses && keptCourses.length !== totalCourses) return `${keptCourses.length}/${totalCourses}`;
  return String(totalCourses);
}

async function updateBadge() {
  const res = await chrome.storage.local.get([STORAGE_KEY, KEPT_KEY]);
  const text = badgeFor(res[STORAGE_KEY], res[KEPT_KEY]);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f883d" });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SC_UPDATED" || msg.type === "SC_KEPT_UPDATED" || msg.type === "SC_CLEARED") {
    updateBadge();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEY] || changes[KEPT_KEY])) updateBadge();
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
