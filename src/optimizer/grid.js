// grid.js — schedule grid builder
import { DAYS_ORDER, DAY_SHORT, timeStr } from "./clean.js";

export function buildScheduleGrid(combination) {
  const grid = Object.fromEntries(DAYS_ORDER.map(d => [d, []]));
  for (const sec of combination) {
    for (const m of sec.meetings) {
      for (const d of m.days) {
        grid[d].push({
          begin: m.begin, end: m.end,
          course: sec.course, section: sec.section, tutor: sec.tutor,
          room: `${m.building} ${m.room}`.trim(),
        });
      }
    }
  }
  for (const d of grid) grid[d].sort((a,b)=>a.begin-b.begin);
  return grid;
}
export function getSlotStatus(daySlots, t) {
  for (const s of daySlots) if (s.begin <= t && t < s.end) return ["class", s];
  for (let i=0;i<daySlots.length-1;i++) if (daySlots[i].end <= t && t < daySlots[i+1].begin) return ["break", null];
  return ["empty", null];
}
