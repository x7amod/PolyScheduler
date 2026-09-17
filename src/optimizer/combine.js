// combine.js — product + filter helpers
import { timeStr } from "./clean.js";

export function parseTimeRange(text) {
  text = (text||"").trim();
  if (!text) return [null, null];
  const m = text.match(/^\s*(\d{1,2})\s*(?:[-:]\s*(\d{1,2})?)?\s*$/);
  if (!m) return [null, null];
  const sh = Number(m[1]), eh = m[2] == null ? null : Number(m[2]);
  if (sh < 1 || sh > 12 || (eh != null && (eh < 1 || eh > 12))) return [null, null];
  const start = sh*60;
  let end = eh == null ? 18*60 : eh*60;
  if (end <= start) end += 12*60;
  return [start, end];
}
export function filterByTime(courseGroups, tStart, tEnd) {
  if (tStart == null) return courseGroups;
  if (tEnd == null) tEnd = 18*60;
  const filtered = {};
  for (const [course, secs] of Object.entries(courseGroups)) {
    filtered[course] = secs.filter(sec => sec.meetings.every(m => m.begin >= tStart && m.end <= tEnd));
  }
  return filtered;
}
export function applyConstraints(courseGroups, constraints) {
  const filtered = {};
  for (const [course, secs] of Object.entries(courseGroups)) {
    const cons = constraints[course] || {must:[], prefer:[]};
    if (cons.must && cons.must.length) filtered[course] = secs.filter(s => cons.must.includes(s.tutor));
    else filtered[course] = [...secs];
  }
  return filtered;
}
export function parseSelection(text, maxVal) {
  const result = new Set();
  text = (text||"").trim();
  if (!text) return null;
  for (const part of text.split(",").map(p=>p.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [aStr,bStr] = part.split("-",2);
      const a = parseInt(aStr,10), b = parseInt(bStr,10);
      if (isNaN(a)||isNaN(b)) continue;
      for (let v=a; v<=b; v++) if (v>=1 && v<=maxVal) result.add(v);
    } else {
      const v = parseInt(part,10);
      if (!isNaN(v) && v>=1 && v<=maxVal) result.add(v);
    }
  }
  return result.size ? result : null;
}
export function generateCombinations(courseGroups) {
  const courses = Object.keys(courseGroups).sort();
  const lists = courses.map(c => courseGroups[c]);
  // cartesian product (like itertools.product)
  let combos = [[]];
  for (const list of lists) {
    const next = [];
    for (const prefix of combos) for (const item of list) next.push([...prefix, item]);
    combos = next;
  }
  return combos;
}
