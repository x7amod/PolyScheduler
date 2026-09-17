// clean.js — core helpers (DAYS_ORDER, parse_time, flip_name, clean_sections)
export const DAYS_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
export const DAY_SHORT = { Sunday: "Sun", Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu" };
export const DAY_BOOL_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday"];

export function parseTime(t) {
  if (t == null) return null;
  const value = String(t).trim();
  if (!/^\d{4}$/.test(value)) return null;
  const h = Number(value.slice(0, 2));
  const m = Number(value.slice(2));
  return h < 24 && m < 60 ? h * 60 + m : null;
}
export function timeStr(minutes) {
  return timeStr12(minutes);
}
export function timeStr12(minutes) {
  if (minutes == null) return "";
  const h24 = Math.floor(minutes / 60), mins = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mins).padStart(2,"0")} ${period}`;
}
export function formatDuration(mins) {
  if (mins == null) return "0:00";
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}:${String(m).padStart(2,"0")}`;
}
export function flipName(displayName) {
  if (!displayName || displayName === "TBA") return "TBA";
  if (displayName.includes(",")) {
    const parts = displayName.split(",", 2).map(p => p.trim());
    return `${parts[1]} ${parts[0]}`.trim();
  }
  return displayName.trim();
}
export function cleanSections(rawSections) {
  const cleaned = [];
  for (const sec of rawSections) {
    const meetings = [];
    let invalidTime = false;
    for (const mf of sec.meetingsFaculty || []) {
      const mt = mf.meetingTime || {};
      const days = DAY_BOOL_KEYS.filter(k => mt[k]).map(d => d.charAt(0).toUpperCase() + d.slice(1));
      if (days.length) {
        const begin = parseTime(mt.beginTime);
        const end = parseTime(mt.endTime);
        if (begin == null || end == null || end <= begin) {
          invalidTime = true;
          continue;
        }
        meetings.push({
          begin,
          end,
          days,
          room: mt.room || "",
          building: mt.buildingDescription || "",
        });
      }
    }
    if (!meetings.length || invalidTime) continue;
    const facultyList = sec.faculty || [];
    const rawName = facultyList[0]?.displayName || "TBA";
    cleaned.push({
      course: sec.subjectCourse || `${sec.subject || ""}${sec.courseNumber || ""}`,
      courseNumber: sec.courseNumber,
      courseTitle: sec.courseTitle,
      section: sec.sequenceNumber,
      crn: sec.courseReferenceNumber,
      tutor: flipName(rawName),
      meetings,
    });
  }
  return cleaned;
}
export function groupByCourse(sections) {
  const g = {};
  for (const s of sections) (g[s.course] ||= []).push(s);
  return g;
}
