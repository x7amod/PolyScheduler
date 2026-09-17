// optimizer-engine.js — IIFE globals for content scripts (no ES imports)
// Exposes window.SC_ENGINE
(function(){
  const DAYS_ORDER = ["Sunday","Monday","Tuesday","Wednesday","Thursday"];
  const DAY_SHORT = {Sunday:"Sun",Monday:"Mon",Tuesday:"Tue",Wednesday:"Wed",Thursday:"Thu"};
  const DAY_BOOL_KEYS = ["sunday","monday","tuesday","wednesday","thursday"];

  function parseTime(t){
    if(t == null) return null;
    const value=String(t).trim();
    if(!/^\d{4}$/.test(value)) return null;
    const h=Number(value.slice(0,2)), m=Number(value.slice(2));
    return h<24 && m<60 ? h*60+m : null;
  }
  function timeStr(m){ return timeStr12(m); }
  function timeStr12(m){
    if(m==null) return "";
    const h24=Math.floor(m/60), mins=m%60;
    const period=h24>=12 ? "PM" : "AM";
    const h12=h24%12 || 12;
    return `${h12}:${String(mins).padStart(2,"0")} ${period}`;
  }
  function formatDuration(mins){
    if(mins==null) return "0:00";
    const h=Math.floor(mins/60), m=mins%60;
    return `${h}:${String(m).padStart(2,"0")}`;
  }
  function parseTimeRange(text){
    text=(text||"").trim(); if(!text) return [null,null];
    const m=text.match(/^\s*(\d{1,2})\s*(?:[-:]\s*(\d{1,2})?)?\s*$/); if(!m) return [null,null];
    const sh=Number(m[1]), eh=m[2]==null?null:Number(m[2]);
    if(sh<1 || sh>12 || (eh!=null && (eh<1 || eh>12))) return [null,null];
    const s=sh*60, e=eh==null?18*60:eh*60;
    return [s,e<=s?e+12*60:e];
  }
  function parseHourRange(startText,endText){
    const start=String(startText||"").trim(), end=String(endText||"").trim();
    if(!start && !end) return {start:null,end:null,error:""};
    if(!start) return {start:null,end:null,error:"Enter a start hour before the end hour."};
    if(!/^\d{1,2}$/.test(start) || Number(start)<1 || Number(start)>12) return {start:null,end:null,error:"Hours must be whole numbers from 1 to 12."};
    if(end && (!/^\d{1,2}$/.test(end) || Number(end)<1 || Number(end)>12)) return {start:null,end:null,error:"Hours must be whole numbers from 1 to 12."};
    const s=Number(start)*60;
    let e=end?Number(end)*60:18*60;
    if(e<=s) e+=12*60;
    return {start:s,end:e,error:""};
  }
  function flipName(d){
    if(!d||d==="TBA") return "TBA";
    if(d.includes(",")){ const p=d.split(",",2).map(x=>x.trim()); return `${p[1]} ${p[0]}`.trim(); }
    return d.trim();
  }
  function cleanSections(raw){
    const out=[];
    for(const sec of raw){
      const meetings=[];
      let invalidTime=false;
      for(const mf of (sec.meetingsFaculty||[])){
        const mt=mf.meetingTime||{};
        const days=DAY_BOOL_KEYS.filter(k=>mt[k]).map(d=>d[0].toUpperCase()+d.slice(1));
        if(days.length){
          const begin=parseTime(mt.beginTime), end=parseTime(mt.endTime);
          if(begin==null || end==null || end<=begin){ invalidTime=true; continue; }
          meetings.push({begin, end, days, room:mt.room||"", building:mt.buildingDescription||""});
        }
      }
      if(!meetings.length || invalidTime) continue;
      const rawName=sec.faculty?.[0]?.displayName || "TBA";
      out.push({course:sec.subjectCourse || `${sec.subject||""}${sec.courseNumber||""}`, courseNumber:sec.courseNumber, courseTitle:sec.courseTitle, section:sec.sequenceNumber, crn:sec.courseReferenceNumber, tutor:flipName(rawName), meetings});
    }
    return out;
  }
  function groupByCourse(sections){ const g={}; for(const s of sections) (g[s.course]=g[s.course]||[]).push(s); return g; }
  function getTutors(secs){ const seen=[]; for(const s of secs) if(!seen.includes(s.tutor)) seen.push(s.tutor); return seen; }
  function filterByTime(groups,tS,tE){
    if(tS==null) return groups; if(tE==null) tE=18*60;
    const f={}; for(const [c,secs] of Object.entries(groups)) f[c]=secs.filter(s=>s.meetings.every(m=>m.begin>=tS && m.end<=tE)); return f;
  }
  function applyConstraints(groups,constraints){
    const f={}; for(const [c,secs] of Object.entries(groups)){
      const cons=constraints[c]||{must:[],prefer:[]};
      if(cons.must?.length) f[c]=secs.filter(s=>cons.must.includes(s.tutor)); else f[c]=[...secs];
    } return f;
  }
  function timesOverlap(s1,e1,s2,e2){ return s1<e2 && s2<e1; }
  function hasConflict(combo){
    const all=[]; for(const sec of combo) for(const m of sec.meetings) all.push([m.begin,m.end,m.days,sec.course]);
    for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++){
      const [b1,e1,d1,c1]=all[i], [b2,e2,d2,c2]=all[j]; if(c1===c2) continue;
      const shared=d1.some(d=>d2.includes(d)); if(shared && timesOverlap(b1,e1,b2,e2)) return true;
    } return false;
  }
  function scoreCombination(combo,constraints,preferDays=false){
    const allDays=new Set(); for(const sec of combo) for(const m of sec.meetings) for(const d of m.days) allDays.add(d);
    const daysUsed=allDays.size;
    const daySlots=Object.fromEntries(DAYS_ORDER.map(d=>[d,[]]));
    for(const sec of combo) for(const m of sec.meetings) for(const d of m.days) daySlots[d].push([m.begin,m.end]);
    let weighted=0, raw=0;
    for(const day of DAYS_ORDER){
      const slots=daySlots[day].sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
      for(let k=1;k<slots.length;k++){
        const gap=slots[k][0]-slots[k-1][1]; if(gap<=10) continue; raw+=gap; if(gap<=135) weighted+=gap*5; else weighted+=gap*50;
      }
    }
    let pref=0; for(const sec of combo){ const cons=constraints[sec.course]||{must:[],prefer:[]}; if(cons.prefer?.includes(sec.tutor)) pref+=10; }
    const score=preferDays? pref*100 - daysUsed*100 - weighted : pref*100 - daysUsed*10 - weighted;
    return {score, daysUsed, rawBreak:raw, prefBonus:pref};
  }
  function buildScheduleGrid(combo){
    const grid=Object.fromEntries(DAYS_ORDER.map(d=>[d,[]]));
    for(const sec of combo) for(const m of sec.meetings) for(const d of m.days) grid[d].push({begin:m.begin,end:m.end,course:sec.course,section:sec.section,tutor:sec.tutor,room:`${m.building} ${m.room}`.trim()});
    for(const d in grid) grid[d].sort((a,b)=>a.begin-b.begin); return grid;
  }
  function generateCombinations(groups){
    const courses=Object.keys(groups).sort(); const lists=courses.map(c=>groups[c]);
    let combos=[[]]; for(const list of lists){ const nxt=[]; for(const pre of combos) for(const it of list) nxt.push([...pre,it]); combos=nxt; } return combos;
  }

  async function findTopSchedules(groups,constraints,preferDays=false,limit=10,options={}){
    const courses=Object.keys(groups).sort();
    const lists=courses.map(c=>groups[c]);
    const maxCandidates=options.maxCandidates || 100000;
    const yieldEvery=options.yieldEvery || 1000;
    const valid=[];
    let examined=0, truncated=false;
    if(lists.some(list=>!list.length)) return {results:[], examined:0, truncated:false};

    function addResult(combo){
      const score=scoreCombination(combo,constraints,preferDays);
      valid.push({combo:[...combo],score});
      valid.sort((a,b)=>b.score.score-a.score.score);
      if(valid.length>limit) valid.length=limit;
    }
    async function visit(index,prefix){
      if(truncated) return;
      for(const item of lists[index]){
        if(truncated) return;
        examined++;
        if(examined>maxCandidates){ truncated=true; return; }
        const next=[...prefix,item];
        if(prefix.length && hasConflict(next)) continue;
        if(index===lists.length-1) addResult(next);
        else await visit(index+1,next);
        if(examined%yieldEvery===0){
          options.onProgress?.(examined);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
    }
    if(courses.length) await visit(0,[]);
    return {results:valid, examined, truncated};
  }

  window.SC_ENGINE = {DAYS_ORDER, DAY_SHORT, DAY_BOOL_KEYS, parseTime, timeStr, timeStr12, formatDuration, parseTimeRange, parseHourRange, flipName, cleanSections, groupByCourse, getTutors, filterByTime, applyConstraints, hasConflict, scoreCombination, buildScheduleGrid, generateCombinations, findTopSchedules};
})();
