// aggregate.js — shared storage helpers (imported via dynamic import in content/popup/sw)
const STORAGE_KEY = "sc_aggregated";
const KEPT_KEY = "sc_keptCourses";
const EXCLUDED_KEY = "sc_excludedCourses";

function courseCode(sec) {
  return sec.subjectCourse || `${sec.subject || ""}${sec.courseNumber || ""}`;
}

// Dedup by courseReferenceNumber, group by subjectCourse
export function mergePayload(existing, payload) {
  // existing: { byCRN: {crn: section}, coursesMeta: {} } or null
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

export function buildCoursesMeta(byCRN) {
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

export function getKeptSections(byCRN, keptCourses) {
  if (keptCourses == null) return Object.values(byCRN);
  const set = new Set(keptCourses);
  return Object.values(byCRN).filter(s => set.has(courseCode(s)));
}

export function buildExportPayload(byCRN, keptCourses) {
  const sections = getKeptSections(byCRN, keptCourses);
  return { success: true, totalCount: sections.length, data: sections };
}

// storage wrappers using chrome.storage.local
export async function loadAggregated() {
  const res = await chrome.storage.local.get([STORAGE_KEY, KEPT_KEY, EXCLUDED_KEY]);
  return { aggregated: res[STORAGE_KEY] || null, keptCourses: res[KEPT_KEY] ?? null, excludedCourses: res[EXCLUDED_KEY] || [] };
}

export async function saveAggregated(aggregated) {
  await chrome.storage.local.set({ [STORAGE_KEY]: aggregated });
}

export async function saveKeptCourses(kept) {
  await chrome.storage.local.set({ [KEPT_KEY]: kept });
}

export async function clearAll() {
  await chrome.storage.local.remove([STORAGE_KEY, KEPT_KEY, EXCLUDED_KEY]);
}
