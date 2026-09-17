// popup.js — ESM, uses storage helpers
import { loadAggregated, clearAll } from "../storage/aggregate.js";

const summary = document.getElementById("summary");
const detail = document.getElementById("detail");
const keptEl = document.getElementById("kept");

async function render() {
  const { aggregated, keptCourses } = await loadAggregated();
  if (!aggregated || !aggregated.byCRN || Object.keys(aggregated.byCRN).length === 0) {
    summary.textContent = "No courses captured yet.";
    detail.textContent = "Search Banner to capture course sections.";
    keptEl.textContent = "Your capture stays until you clear it.";
    return;
  }
  const totalSections = Object.keys(aggregated.byCRN).length;
  const coursesMeta = aggregated.coursesMeta || {};
  const codes = Object.keys(coursesMeta).sort();
  const keptList = keptCourses === null ? codes : keptCourses;
  summary.textContent = `${totalSections} sections • ${codes.length} courses`;
  detail.textContent = `Courses: ${codes.join(", ")}`;
  keptEl.textContent = `Kept: ${keptList.length ? keptList.join(", ") : "none"} ${keptCourses===null ? "(choose in the overlay to filter)" : "(saved until clear)"}`;
}

document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("Clear all captured course data?")) return;
  await clearAll();
  await render();
});

render();
chrome.storage.onChanged.addListener(render);
