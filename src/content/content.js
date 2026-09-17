// content.js — ISOLATED world bridge (no ES imports — inline helpers for MV3 content script)
(function () {
  const STORAGE_KEY = "sc_aggregated";
  const KEPT_KEY = "sc_keptCourses";
  const EXCLUDED_KEY = "sc_excludedCourses";

  function courseCode(sec) {
    return sec.subjectCourse || `${sec.subject || ""}${sec.courseNumber || ""}`;
  }

  // Capture, keep, and clear operations share one queue in this content-script world.
  // This prevents read-modify-write races between the overlay and the interceptor.
  const previousQueue = window.__scStorageQueue || Promise.resolve();
  window.__scStorageQueue = previousQueue;
  window.__scRunStorageTask = function (task) {
    const next = window.__scStorageQueue.catch(() => {}).then(task);
    window.__scStorageQueue = next.catch(() => {});
    return next;
  };

  function buildCoursesMeta(byCRN) {
    const meta = {};
    for (const sec of Object.values(byCRN)) {
      const code = courseCode(sec);
      if (!meta[code]) meta[code] = { code, title: sec.courseTitle || "", subject: sec.subject || "", count: 0, crns: [] };
      meta[code].count += 1;
      meta[code].crns.push(sec.courseReferenceNumber);
      if (!meta[code].title && sec.courseTitle) meta[code].title = sec.courseTitle;
    }
    return meta;
  }

  function mergePayload(existing, payload) {
    const byCRN = existing?.byCRN ? { ...existing.byCRN } : {};
    if (!payload || !payload.success || !Array.isArray(payload.data)) return existing || { byCRN: {}, coursesMeta: {}, rawSearchCount: 0 };
    for (const sec of payload.data) {
      const crn = sec.courseReferenceNumber;
      if (crn) byCRN[crn] = sec;
    }
    const coursesMeta = buildCoursesMeta(byCRN);
    const rawSearchCount = (existing?.rawSearchCount || 0) + 1;
    return { byCRN, coursesMeta, rawSearchCount };
  }

  // Inject MAIN world interceptor
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("src/content/interceptor-main.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    console.warn("[SCOptimizer] interceptor inject failed", e);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "SC_CAPTURE") return;
    const payload = event.data.payload;
    if (!payload || !payload.success || !Array.isArray(payload.data)) return;
    window.__scRunStorageTask(async () => {
      const stored = await chrome.storage.local.get([STORAGE_KEY, EXCLUDED_KEY]);
      const excluded = new Set(stored[EXCLUDED_KEY] || []);
      const existing = stored[STORAGE_KEY] || null;
      const filteredPayload = {
        ...payload,
        data: payload.data.filter(sec => !excluded.has(courseCode(sec))),
      };
      const next = mergePayload(existing, filteredPayload);
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      try { chrome.runtime.sendMessage({ type: "SC_UPDATED", aggregated: next }); } catch (e) {}
      window.dispatchEvent(new CustomEvent("sc-aggregated-update", { detail: next }));
    }).catch((e) => console.error("[SCOptimizer] merge failed", e));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.sc_aggregated || changes.sc_keptCourses || changes.sc_excludedCourses) {
      window.dispatchEvent(new CustomEvent("sc-storage-change"));
    }
  });
})();
