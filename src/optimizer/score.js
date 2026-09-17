// score.js — schedule scoring
import { DAYS_ORDER } from "./clean.js";
export function scoreCombination(combination, constraints, preferDays = false) {
  const allDays = new Set();
  for (const sec of combination) for (const m of sec.meetings) for (const d of m.days) allDays.add(d);
  const daysUsed = allDays.size;
  const daySlots = Object.fromEntries(DAYS_ORDER.map(d => [d, []]));
  for (const sec of combination) for (const m of sec.meetings) for (const d of m.days) daySlots[d].push([m.begin, m.end]);
  let weightedBreak = 0, rawBreak = 0;
  for (const day of DAYS_ORDER) {
    const slots = daySlots[day].sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < slots.length; k++) {
      const gap = slots[k][0] - slots[k - 1][1];
      if (gap <= 10) continue;
      rawBreak += gap;
      if (gap <= 135) weightedBreak += gap * 5;
      else weightedBreak += gap * 50;
    }
  }
  let prefBonus = 0;
  for (const sec of combination) {
    const cons = constraints[sec.course] || { must: [], prefer: [] };
    if (cons.prefer?.includes(sec.tutor)) prefBonus += 10;
  }
  const score = preferDays ? prefBonus * 100 - daysUsed * 100 - weightedBreak : prefBonus * 100 - daysUsed * 10 - weightedBreak;
  return { score, daysUsed, rawBreak, prefBonus };
}
