// overlay.js — renders floating card for passive capture (no ES imports)
(function () {
  if (document.getElementById("sc-optimizer-host")) return;

  const STORAGE_KEY = "sc_aggregated";
  const KEPT_KEY = "sc_keptCourses";
  const EXCLUDED_KEY = "sc_excludedCourses";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
  const runStorageTask = window.__scRunStorageTask || (task => task());

  function buildExportPayload(byCRN, keptCourses) {
    const all = Object.values(byCRN || {});
    const sections = keptCourses == null ? all : all.filter(s => keptCourses.includes(s.subjectCourse || `${s.subject || ""}${s.courseNumber || ""}`));
    const finalSections = sections;
    return { success: true, totalCount: finalSections.length, data: finalSections };
  }

  const host = document.createElement("div");
  host.id = "sc-optimizer-host";
  // Ensure body exists (document_start may be too early)
  function attachHost() {
    if (document.body) document.body.appendChild(host);
    else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(host), { once: true });
  }
  attachHost();
  const shadow = host.attachShadow({ mode: "open" });
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = chrome.runtime.getURL("src/content/overlay.css");
  shadow.appendChild(styleLink);

  const card = document.createElement("div");
  card.className = "sc-card";
  shadow.appendChild(card);

  let aggregated = null;
  let keptCourses = null;
  let excludedCourses = [];

  async function loadState() {
    const res = await chrome.storage.local.get([STORAGE_KEY, KEPT_KEY, EXCLUDED_KEY]);
    aggregated = res[STORAGE_KEY] || null;
    keptCourses = res[KEPT_KEY] ?? null;
    excludedCourses = res[EXCLUDED_KEY] || [];
  }

  function coursesMeta() { return aggregated?.coursesMeta || {}; }
  function allCodes() { return Object.keys(coursesMeta()).sort(); }
  function isKept(code) { if (keptCourses === null) return true; return keptCourses.includes(code); }

  function buildCoursesMeta(byCRN) {
    const meta = {};
    for (const sec of Object.values(byCRN)) {
      const code = sec.subjectCourse || `${sec.subject || ""}${sec.courseNumber || ""}`;
      if (!meta[code]) meta[code] = { code, title: sec.courseTitle || "", subject: sec.subject || "", count: 0, crns: [] };
      meta[code].count += 1;
      meta[code].crns.push(sec.courseReferenceNumber);
      if (!meta[code].title && sec.courseTitle) meta[code].title = sec.courseTitle;
    }
    return meta;
  }

  async function persistKept(nextKept) {
    await runStorageTask(async () => {
      const stored = await chrome.storage.local.get([STORAGE_KEY, KEPT_KEY, EXCLUDED_KEY]);
      const current = stored[STORAGE_KEY] || aggregated;
      const previousExcluded = new Set(stored[EXCLUDED_KEY] || excludedCourses);
      const keepSet = new Set(nextKept);
      const removed = [];
      const nextByCRN = {};
      for (const [crn, sec] of Object.entries(current?.byCRN || {})) {
        const code = sec.subjectCourse || `${sec.subject || ""}${sec.courseNumber || ""}`;
        if (keepSet.has(code)) nextByCRN[crn] = sec;
        else removed.push(code);
      }
      removed.forEach(code => previousExcluded.add(code));
      nextKept.forEach(code => previousExcluded.delete(code));
      aggregated = {
        byCRN: nextByCRN,
        coursesMeta: buildCoursesMeta(nextByCRN),
        rawSearchCount: current?.rawSearchCount || 0,
      };
      excludedCourses = [...previousExcluded];
      await chrome.storage.local.set({
        [STORAGE_KEY]: aggregated,
        [KEPT_KEY]: nextKept,
        [EXCLUDED_KEY]: excludedCourses,
      });
      keptCourses = nextKept;
      if (removed.length) console.log(`[SCOptimizer] Keep Selected removed ${removed.length} sections from ${new Set(removed).size} courses`);
      render();
      try { chrome.runtime.sendMessage({ type: "SC_KEPT_UPDATED", keptCourses: nextKept }); } catch (e) {}
      try { chrome.runtime.sendMessage({ type: "SC_UPDATED", aggregated }); } catch (e) {}
    });
  }

  async function handleClear() {
    if (!confirm("Clear all captured search data? This persists until you clear — no auto-reset.")) return;
    await runStorageTask(async () => {
      await chrome.storage.local.remove([STORAGE_KEY, KEPT_KEY, EXCLUDED_KEY]);
      aggregated = null;
      keptCourses = null;
      excludedCourses = [];
      render();
      try { chrome.runtime.sendMessage({ type: "SC_CLEARED" }); } catch (e) {}
    });
  }

  function render() {
    const meta = coursesMeta();
    const codes = allCodes();
    const totalSections = aggregated ? Object.keys(aggregated.byCRN || {}).length : 0;
    const keptCount = keptCourses === null ? codes.length : keptCourses.length;
    const keptSections = (() => {
      if (!aggregated) return 0;
      if (keptCourses === null) return totalSections;
      let n = 0;
      for (const c of keptCourses) n += meta[c]?.count || 0;
      return n;
    })();

    if (!aggregated || codes.length === 0) {
      card.innerHTML = `
        <div class="sc-header">
          <div>
            <div class="sc-title">SCOptimizer</div>
            <div class="sc-subtitle">Course capture</div>
          </div>
          <span class="sc-badge">Ready</span>
        </div>
        <div class="sc-empty">
          <div class="sc-empty-title">Build your course pool</div>
          <span class="sc-muted">Search Banner for a course. Matching sections will appear here automatically.</span>
        </div>
        <div class="sc-divider"></div>
        <div class="sc-actions">
          <button class="sc-btn sc-btn-quiet" id="sc-clear">Clear data</button>
        </div>
      `;
      card.querySelector("#sc-clear")?.addEventListener("click", handleClear);
      return;
    }

    const rows = codes.map(code => {
      const m = meta[code];
      const checked = isKept(code) ? "checked" : "";
      const safeCode = esc(code);
      const safeTitle = esc(m.title || m.subject || "");
      return `
        <label class="sc-row">
          <input type="checkbox" data-code="${safeCode}" ${checked} />
          <span class="sc-course-code">${safeCode}</span>
          <span class="sc-course-title" title="${safeTitle}">${safeTitle}</span>
          <span class="sc-count">${esc(m.count)}</span>
        </label>
      `;
    }).join("");

    const warning = `<div class="sc-callout"><span class="sc-callout-dot"></span><span>Select the courses you want to plan. New Banner searches can be added later.</span></div>`;

    card.innerHTML = `
      <div class="sc-header">
        <div>
          <div class="sc-title">SCOptimizer</div>
          <div class="sc-subtitle">${totalSections} sections &middot; ${codes.length} courses &middot; ${keptSections} kept</div>
        </div>
        <span class="sc-badge">${keptCount}/${codes.length} kept</span>
      </div>
      ${warning}
      <div class="sc-toolbar">
        <span class="sc-toolbar-label">Course selection</span>
        <div class="sc-toolbar-actions">
          <button class="sc-btn sc-btn-ghost sc-btn-small" id="sc-all">Select all</button>
          <button class="sc-btn sc-btn-ghost sc-btn-small" id="sc-none">Clear selection</button>
        </div>
      </div>
      <div class="sc-course-list">${rows}</div>
      <div class="sc-actions sc-action-row">
        <button class="sc-btn sc-btn-primary sc-btn-grow" id="sc-keep">Keep selected</button>
        <button class="sc-btn sc-btn-quiet" id="sc-clear">Clear data</button>
      </div>
      <div class="sc-actions sc-plan-row">
        <button class="sc-btn sc-btn-plan" id="sc-optimize" ${keptSections===0? "disabled":""}>Plan a schedule <span aria-hidden="true">&rarr;</span></button>
        <span class="sc-muted">Time, ranking, and tutor preferences</span>
      </div>
    `;

    card.querySelector("#sc-all")?.addEventListener("click", () => {
      card.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    card.querySelector("#sc-none")?.addEventListener("click", () => {
      card.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    card.querySelector("#sc-keep")?.addEventListener("click", async () => {
      const checked = [...card.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.getAttribute("data-code"));
      const all = allCodes();
      const toRemove = all.filter(c => !checked.includes(c));
      if (checked.length === 0 && !confirm("Keep 0 courses? This will remove all captured courses.")) return;
      if (toRemove.length > 0 && !confirm(`Keep ${checked.length} course(s)? This will permanently remove ${toRemove.length} course(s): ${toRemove.join(", ")}`)) return;
      await persistKept(checked);
    });
    card.querySelector("#sc-clear")?.addEventListener("click", handleClear);
    card.querySelector("#sc-optimize")?.addEventListener("click", async () => {
      await loadState();
      if(!aggregated || allCodes().length===0) { alert("No courses captured"); return; }
      if(keptCourses===null){
        if(!confirm("You haven't pressed Keep Selected yet. Optimize will use all captured courses. Continue?")) return;
      } else if(keptCourses.length===0){ alert("No courses kept — check at least one"); return; }
      if(window.__scWizard) { await window.__scWizard.loadAggregated(); window.__scWizard.initWizard(); }
    });
  }

  (async () => {
    await loadState();
    render();
  })();

  window.addEventListener("sc-aggregated-update", async (e) => {
    aggregated = e.detail;
    render();
  });
  window.addEventListener("sc-storage-change", async () => {
    await loadState();
    render();
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    await loadState();
    render();
  });

  window.__scOverlay = { host, render, loadState };
})();
