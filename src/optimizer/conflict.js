// conflict.js — conflict detection
export function timesOverlap(s1, e1, s2, e2) { return s1 < e2 && s2 < e1; }
export function hasConflict(combination) {
  const all = [];
  for (const sec of combination) {
    for (const m of sec.meetings) all.push([m.begin, m.end, m.days, sec.course]);
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [b1, e1, d1, c1] = all[i];
      const [b2, e2, d2, c2] = all[j];
      if (c1 === c2) continue;
      const shared = d1.some(d => d2.includes(d));
      if (shared && timesOverlap(b1, e1, b2, e2)) return true;
    }
  }
  return false;
}
