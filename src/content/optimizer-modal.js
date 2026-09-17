// optimizer-modal.js — wizard for time/ranking/section-trim/tutor constraints + results
(function(){
  if (window.__scWizard) return;
  const STORAGE_KEY="sc_aggregated", KEPT_KEY="sc_keptCourses";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;",
  }[ch]));

  function ensureEngine(){ return window.SC_ENGINE; }

  let host, shadow, modal;
  function createModal(){
    if (document.getElementById("sc-opt-modal-host")) return;
    host=document.createElement("div");
    host.id="sc-opt-modal-host";
    document.body.appendChild(host);
    shadow=host.attachShadow({mode:"open"});
    const link=document.createElement("link");
    link.rel="stylesheet"; link.href=chrome.runtime.getURL("src/content/optimizer-modal.css");
    shadow.appendChild(link);
    const link2=document.createElement("link");
    link2.rel="stylesheet"; link2.href=chrome.runtime.getURL("src/content/overlay.css");
    shadow.appendChild(link2);
    modal=document.createElement("div");
    modal.className="sc-modal";
    shadow.appendChild(modal);
    shadow.addEventListener("click", event=>{
      const target=event.target;
      if(!(target instanceof Element) || target.closest(".sc-tutor-select-wrap")) return;
      shadow.querySelectorAll(".sc-tutor-select-wrap.open").forEach(wrap=>{
        wrap.classList.remove("open");
        wrap.querySelector(".sc-tutor-menu")?.setAttribute("hidden","");
        wrap.querySelector(".sc-tutor-trigger")?.setAttribute("aria-expanded","false");
      });
    });
    const backdrop=document.createElement("div");
    backdrop.className="sc-modal-backdrop";
    host.prepend(backdrop);
    backdrop.addEventListener("click", close);
  }

  function open(){ createModal(); host.classList.add("open"); }
  function close(){
    if(host) host.classList.remove("open");
    dataVersion++;
    optimizing=false;
  }
  document.addEventListener("keydown", event=>{
    if(event.key==="Escape" && host?.classList.contains("open")) close();
  });

  let step=1;
  let aggregated=null, keptCourses=null;
  let cleaned=[], grouped={}, filteredGroups={};
  let sectionKeepMap={};
  let tStart=null, tEnd=null, preferDays=false;
  let timeInputStart="", timeInputEnd="", timeError="";
  let sectionError="";
  let constraints={};
  let results=[];
  let optimizing=false, examinedCandidates=0, searchTruncated=false;
  let dataVersion=0;
  let visited = new Set([1]); // per-window visited tabs — only allow forward to visited

  async function loadAggregated(){
    const res=await chrome.storage.local.get([STORAGE_KEY, KEPT_KEY]);
    aggregated=res[STORAGE_KEY]||null;
    keptCourses=res[KEPT_KEY] ?? null;
  }

  function getRawFiltered(){
    const byCRN=aggregated?.byCRN||{};
    let arr=Object.values(byCRN);
    if(keptCourses) arr=arr.filter(s=>keptCourses.includes(s.subjectCourse || `${s.subject||""}${s.courseNumber||""}`));
    else if(keptCourses===null) {}
    else if(keptCourses.length===0) arr=[];
    return arr;
  }

  function initWizard(){
    const eng=ensureEngine();
    const raw=getRawFiltered();
    cleaned=eng.cleanSections(raw);
    grouped=eng.groupByCourse(cleaned);
    sectionKeepMap={};
    for(const [course, secs] of Object.entries(grouped)){
      sectionKeepMap[course]=new Set(secs.map(s=>s.crn));
    }
    constraints={};
    for(const c of Object.keys(grouped)) constraints[c]={must:[], prefer:[]};
    tStart=null; tEnd=null; preferDays=false;
    timeInputStart=""; timeInputEnd=""; timeError=""; sectionError="";
    results=[]; optimizing=false; examinedCandidates=0; searchTruncated=false;
    step=1;
    visited = new Set([1]);
    render();
    open();
  }

  function applySectionTrim(){
    const trimmed={};
    for(const [course, secs] of Object.entries(grouped)){
      const keepSet=sectionKeepMap[course];
      trimmed[course]=secs.filter(s=>keepSet.has(s.crn));
    }
    return trimmed;
  }

  function invalidateResults(){
    if(visited.has(6)){
      results=[];
      visited.delete(6);
      searchTruncated=false;
      examinedCandidates=0;
    }
  }

  function persistCurrentStepState(){
    const eng=ensureEngine();
    if(!shadow) return true;
    if(step<6) invalidateResults();
    if(step===1){
      shadow.querySelectorAll('input[data-crn]').forEach(cb=>{
        const c=cb.getAttribute("data-course"), crn=cb.getAttribute("data-crn");
        if(cb.checked) sectionKeepMap[c].add(crn); else sectionKeepMap[c].delete(crn);
      });
      const emptyCourse=Object.keys(grouped).find(c=>sectionKeepMap[c].size===0);
      sectionError=emptyCourse ? `Select at least one section for ${emptyCourse}.` : "";
      return !sectionError;
    } else if(step===2){
      const s=shadow.querySelector("#sc-tstart")?.value?.trim(), e=shadow.querySelector("#sc-tend")?.value?.trim();
      timeInputStart=s||""; timeInputEnd=e||"";
      const parsed=eng.parseHourRange(timeInputStart,timeInputEnd);
      timeError=parsed.error;
      if(timeError) return false;
      tStart=parsed.start; tEnd=parsed.end;
    } else if(step===3){
      const v=shadow.querySelector('input[name="sc-rank"]:checked')?.value;
      if(v) preferDays = v==="days";
    } else if(step===4){
      shadow.querySelectorAll(".sc-tutor-sel").forEach(sel=>{
        const c=sel.getAttribute("data-course"), v=sel.value;
        const type=[...shadow.querySelectorAll(".sc-tutor-mode")].find(el=>el.checked && el.getAttribute("data-course")===c)?.value || "none";
        if(!v || type==="none") constraints[c]={must:[],prefer:[]};
        else if(type==="must") constraints[c]={must:[v],prefer:[]};
        else constraints[c]={must:[],prefer:[v]};
      });
    }
    return true;
  }

  async function runOptimization(){
    const eng=ensureEngine();
    const runVersion=dataVersion;
    let groups=applySectionTrim();
    groups=eng.filterByTime(groups, tStart, tEnd);
    const constrained=eng.applyConstraints(groups, constraints);
    optimizing=true;
    examinedCandidates=0;
    searchTruncated=false;
    render();
    const found=await eng.findTopSchedules(constrained,constraints,preferDays,10,{
      maxCandidates:100000,
      yieldEvery:500,
      onProgress: count => { examinedCandidates=count; },
    });
    if(runVersion!==dataVersion){ optimizing=false; return; }
    results=found.results;
    examinedCandidates=found.examined;
    searchTruncated=found.truncated;
    optimizing=false;
    step=6;
    visited.add(6);
    render();
  }

  // helper for display: use AM/PM via engine
  function fmtClock(m){ const eng=ensureEngine(); return eng.timeStr12 ? eng.timeStr12(m) : eng.timeStr(m); }
  function fmtDuration(mins){
    if(mins===0) return "0:00";
    const h=Math.floor(mins/60), m=mins%60;
    return `${h}:${String(m).padStart(2,"0")}`;
  }
  function hourInputValue(minutes){
    if(minutes==null) return "";
    return String(Math.floor(minutes/60)%12 || 12);
  }
  function fmtSec(s){ if(s==null) return ""; const t=String(s).replace(/^0+/, ""); return t===""?"0":t; }

  // color coding — distinct light backgrounds with dark text for readability (WCAG AA)
  const COURSE_PALETTE = [
    "#DBEAFE", // blue-100
    "#FEE2E2", // red-100
    "#FEF9C3", // yellow-100
    "#DCFCE7", // green-100
    "#FCE7F3", // pink-100
    "#E0E7FF", // indigo-100
    "#FFEDD5", // orange-100
    "#CCFBF1", // teal-100
    "#EDE9FE", // violet-100
    "#FFF7ED", // orange-50
  ];
  function getCourseColorMap(coursesSorted){
    const map={};
    coursesSorted.forEach((c,i)=> map[c]=COURSE_PALETTE[i % COURSE_PALETTE.length]);
    return map;
  }

  function render(){
    if(!modal) createModal();
    const eng=ensureEngine();
    const courses=Object.keys(grouped).sort();
    const totalSections=cleaned.length;
    const stepValues=[1,2,3,4,6];
    const stepNames=["Sections","Time","Ranking","Tutors","Results"];
    const stepBar=stepNames.map((s,i)=>{
      const val=stepValues[i];
      const active = step===val;
      const isVisited = visited.has(val);
      const clickable = isVisited;
      return `<span class="sc-step ${active?'active':''} ${clickable?'clickable':''} ${!clickable?'disabled':''}" data-step="${val}">${i+1}. ${s}</span>`;
    }).join("");

    let body="";
    if(step===1){
      body+=`<div class="sc-field sc-intro"><b>Choose sections</b><div class="sc-muted">Keep the sections that fit your plan. You can refine individual courses here.</div></div>`;
      for(const course of courses){
        const secs=grouped[course];
        body+=`<div class="sc-course-card"><div class="sc-course-card-title"><span>${esc(course)}</span><span class="sc-muted">${esc(secs[0].courseTitle)} &middot; ${secs.length} sections</span></div>`;
        for(const s of secs){
          const checked=sectionKeepMap[course].has(s.crn)?"checked":"";
          const times=s.meetings.map(m=>`${fmtClock(m.begin)} - ${fmtClock(m.end)} (${m.days.map(d=>d.slice(0,3)).join("+")})`).join(" / ");
          body+=`<label class="sc-tutor-row"><input type="checkbox" data-course="${esc(course)}" data-crn="${esc(s.crn)}" ${checked} /> <span class="sc-section-id"><b>Sec ${esc(fmtSec(s.section))}</b> <span class="sc-muted">CRN ${esc(s.crn)}</span></span> <span class="sc-section-tutor">${esc(s.tutor)}</span> <span class="sc-muted sc-section-time">${esc(times)}</span></label>`;
        }
        body+=`</div>`;
      }
      if(sectionError) body+=`<div class="sc-error" role="alert">${esc(sectionError)}</div>`;
    } else if(step===2){
      body+=`<div class="sc-field sc-intro"><b>Set a time window</b><label>Only sections fully inside this window will be considered.</label><div class="sc-time-inputs"><div><label for="sc-tstart">Start hour</label><input id="sc-tstart" inputmode="numeric" value="${esc(timeInputStart || hourInputValue(tStart))}" placeholder="8" /></div><span class="sc-time-dash">to</span><div><label for="sc-tend">End hour</label><input id="sc-tend" inputmode="numeric" value="${esc(timeInputEnd || hourInputValue(tEnd))}" placeholder="2" /></div></div>${timeError?`<div class="sc-error" role="alert">${esc(timeError)}</div>`:`<div class="sc-muted">Use whole hours from 1 to 12. A blank end hour defaults to 6:00 PM.</div>`}</div>`;
    } else if(step===3){
      body+=`<div class="sc-field sc-intro"><b>Choose what matters most</b><div class="sc-choice-list"><label><input type="radio" name="sc-rank" value="breaks" ${!preferDays?'checked':''}> <span><strong>Fewer breaks</strong><small>Keep classes closer together during the day.</small></span></label><label><input type="radio" name="sc-rank" value="days" ${preferDays?'checked':''}> <span><strong>Fewer days</strong><small>Concentrate classes into fewer days.</small></span></label></div></div>`;
    } else if(step===4){
      const trimmedGroups = applySectionTrim();
      body+=`<div class="sc-field sc-intro"><b>Set tutor preferences</b><div class="sc-muted">Start with <strong>Any tutor</strong>. Use <strong>Prefer</strong> to rank one tutor higher, or <strong>Must</strong> to exclude every other tutor.</div></div>`;
      for(const course of Object.keys(trimmedGroups).sort()){
        const secs=trimmedGroups[course];
        const tutors=eng.getTutors(secs);
        const cur=constraints[course]||{must:[],prefer:[]};
        const curVal = cur.must[0] || cur.prefer[0] || "";
        const curType = cur.must.length? "must" : cur.prefer.length? "prefer" : "none";
        const title = grouped[course]?.[0]?.courseTitle || secs[0]?.courseTitle || "";
        const courseAttr=esc(course);
        const tutorLabel=curVal || "Choose a tutor";
        const tutorOptions=[`<button type="button" class="sc-tutor-option ${!curVal?'selected':''}" role="option" data-value="" aria-selected="${!curVal}"><span class="sc-option-name">Choose a tutor</span><span class="sc-option-meta">No tutor preference</span></button>`, ...tutors.map(t=>`<button type="button" class="sc-tutor-option ${t===curVal?'selected':''}" role="option" data-value="${esc(t)}" aria-selected="${t===curVal}"><span class="sc-option-name">${esc(t)}</span><span class="sc-option-meta">Sections ${secs.filter(s=>s.tutor===t).map(s=>esc(fmtSec(s.section))).join(", ")}</span></button>`)].join("");
        body+=`<section class="sc-course-card sc-tutor-card"><div class="sc-course-card-title"><span>${esc(course)}</span><span class="sc-muted">${esc(title)} &middot; ${secs.length} sections</span></div>`;
        body+=`<div class="sc-tutor-controls"><div class="sc-tutor-mode-label">Tutor rule</div><div class="sc-mode-toggle" role="radiogroup" aria-label="Tutor rule for ${courseAttr}">
          <label><input type="radio" class="sc-tutor-mode" name="sc-tutor-mode-${courseAttr}" data-course="${courseAttr}" value="none" ${curType==="none"?'checked':''}><span>Any tutor</span></label>
          <label><input type="radio" class="sc-tutor-mode" name="sc-tutor-mode-${courseAttr}" data-course="${courseAttr}" value="prefer" ${curType==="prefer"?'checked':''}><span>Prefer</span></label>
          <label><input type="radio" class="sc-tutor-mode" name="sc-tutor-mode-${courseAttr}" data-course="${courseAttr}" value="must" ${curType==="must"?'checked':''}><span>Must</span></label>
        </div></div>`;
        body+=`<div class="sc-tutor-picker"><label for="sc-tutor-trigger-${esc(course)}">Tutor</label><div class="sc-tutor-select-wrap"><select id="sc-tutor-${esc(course)}" data-course="${courseAttr}" class="sc-tutor-sel" aria-hidden="true" tabindex="-1" hidden><option value="">Choose a tutor</option>${tutors.map(t=>`<option value="${esc(t)}" ${t===curVal?'selected':''}>${esc(t)}</option>`).join("")}</select><button type="button" id="sc-tutor-trigger-${esc(course)}" class="sc-tutor-trigger" data-course="${courseAttr}" aria-haspopup="listbox" aria-expanded="false" ${curType==="none"?'disabled':''}><span class="sc-tutor-trigger-label">${esc(tutorLabel)}</span></button><div class="sc-tutor-menu" role="listbox" aria-label="Tutor options for ${courseAttr}" hidden>${tutorOptions}</div></div><div class="sc-tutor-hint" data-course="${courseAttr}">${curType==="must"?"Only this tutor will be considered.":curType==="prefer"?"This tutor receives a ranking boost.":"Choose Prefer or Must to select a tutor."}</div></div></section>`;
      }
    } else if(step===6){
      body+=`<div class="sc-results-summary">${optimizing?`Searching schedules${examinedCandidates?` (${examinedCandidates.toLocaleString()} candidates checked)`:""}...`:`Found ${results.length} top schedules${searchTruncated?` after checking ${examinedCandidates.toLocaleString()} candidates (search capped for browser responsiveness)`:""}. Time filter ${tStart==null?"none":fmtClock(tStart)+" - "+fmtClock(tEnd||18*60)}, ranking ${preferDays?"fewer days":"fewer breaks"}.`}</div>`;
      if(!results.length) body+=`<div class="sc-empty">No valid schedules — try relaxing constraints/time.</div>`;
      else {
        const courseColorMap = getCourseColorMap(courses);
        // legend
        const legend = courses.map(c=>`<span class="sc-legend-item"><span class="sc-legend-swatch" style="background:${courseColorMap[c]}"></span>${esc(c)}</span>`).join("");
        body+=`<div class="sc-results-legend"><span class="sc-muted">Course colors</span><span class="sc-legend-list">${legend}</span></div>`;
        results.forEach((r, idx)=>{
          const grid=eng.buildScheduleGrid(r.combo);
          const activeDays=eng.DAYS_ORDER.filter(d=>grid[d].length);
          const header=activeDays.map(d=>`<th>${eng.DAY_SHORT[d]}</th>`).join("");
          let allTimes=[]; for(const d of activeDays) for(const s of grid[d]) allTimes.push(s.begin, s.end);
          const minT=Math.min(...allTimes), maxT=Math.max(...allTimes);
          const boundaries=new Set([minT,maxT]);
          for(const d of activeDays) for(const s of grid[d]){ boundaries.add(s.begin); boundaries.add(s.end); }
          for(let t=minT; t<maxT; t+=30) boundaries.add(t);
          const shortBreakStarts=new Set();
          for(const d of activeDays){
            const slots=grid[d];
            for(let i=0; i<slots.length-1; i++){
              const gap=slots[i+1].begin-slots[i].end;
              if(gap>0 && gap<=10) shortBreakStarts.add(slots[i].end);
            }
          }
          // A grid row is shared by every day, so retain a boundary if another
          // day has a class starting there. Otherwise a short break disappears.
          const classStarts=new Set(activeDays.flatMap(d=>grid[d].map(slot=>slot.begin)));
          const rowTimes=[...boundaries].sort((a,b)=>a-b).filter(t=>t<maxT && !(shortBreakStarts.has(t) && !classStarts.has(t)));
          const rowSpans = Object.fromEntries(activeDays.map(d=>[d,0]));
          let rows="";
          for(let rowIndex=0; rowIndex<rowTimes.length; rowIndex++){
            const t=rowTimes[rowIndex];
            let row=`<tr><td>${fmtClock(t)}</td>`;
            for(const d of activeDays){
              if(rowSpans[d] > 0){ rowSpans[d]--; continue; }
              const slots=grid[d];
              const at=slots.find(s=>s.begin<=t && t < s.end);
              if(at){
                const span = Math.max(1, rowTimes.filter(start => start>=at.begin && start<at.end).length);
                rowSpans[d] = span - 1;
                const bg = courseColorMap[at.course] || "#f6f8fa";
                const cell = `${esc(at.course)}-${esc(fmtSec(at.section))}<br/><span class="sc-grid-meta">${esc(at.tutor)}</span><br/><span class="sc-grid-meta">${esc(at.room)}</span>`;
                row+=`<td rowspan="${span}" class="sc-grid-course" style="--sc-course-bg:${bg}">${cell}</td>`;
              } else {
                const isBreak=slots.some((s,i)=> i<slots.length-1 && slots[i+1].begin-s.end>10 && s.end<=t && t<slots[i+1].begin);
                const cell = isBreak? `<span class="sc-grid-break">-</span>` : "";
                row+=`<td>${cell}</td>`;
              }
            }
            row+="</tr>"; rows+=row;
          }
          const detailLines = r.combo.map(s=>{
            const bg = courseColorMap[s.course] || "#f6f8fa";
            const meetings = s.meetings.map(m=>`${m.days.join(" + ")} ${fmtClock(m.begin)} - ${fmtClock(m.end)}${m.room ? ` • ${m.building ? m.building+' ' : ''}${m.room}` : ""}`).join("  |  ");
            return `<div class="sc-detail-card" style="--sc-course-bg:${bg}">
              <div class="sc-detail-head">
                <span class="sc-detail-course">${esc(s.course)}-${esc(fmtSec(s.section))}</span>
                <span class="sc-detail-tutor">${esc(s.tutor)}</span>
                <span class="sc-muted">CRN ${esc(s.crn)}</span>
                <span class="sc-detail-title">${esc(s.courseTitle || "")}</span>
              </div>
              <div class="sc-detail-meetings">${esc(meetings)}</div>
            </div>`;
          }).join("");
           body+=`<div class="sc-schedule"><div class="sc-schedule-head"><span>Schedule #${idx+1} &middot; ${r.score.daysUsed} days &middot; ${fmtDuration(r.score.rawBreak)} breaks</span></div><div class="sc-grid-wrap"><table class="sc-grid"><thead><tr><th>Time</th>${header}</tr></thead><tbody>${rows}</tbody></table></div><div class="sc-detail-stack">${detailLines}</div></div>`;
        });
      }
    }

    modal.innerHTML=`
      <div class="sc-modal-header"><div><div class="sc-modal-title">Build your schedule</div><div class="sc-modal-subtitle">Choose sections, set boundaries, and compare your best options.</div></div><button class="sc-btn sc-btn-ghost" id="sc-close" aria-label="Close optimizer">✕</button></div>
      <div class="sc-muted">${totalSections} sections • ${courses.length} courses kept</div>
      <div class="sc-steps">${stepBar}</div>
      <div class="sc-modal-body" style="flex:1; overflow:auto; padding-right:4px;">${body}</div>
       <div class="sc-actions">
        ${step>1 ? `<button class="sc-btn" id="sc-back">Back</button>` : ``}
        ${step<4 ? `<button class="sc-btn sc-btn-primary" id="sc-next">Next</button>` : ``}
        ${step===4 ? `<button class="sc-btn sc-btn-primary" id="sc-run" ${optimizing?"disabled":""}>${optimizing?"Searching…":"Run Optimization"}</button>` : ``}
        ${step===6 ? `<button class="sc-btn" id="sc-restart">Start over</button> <button class="sc-btn sc-btn-primary" id="sc-save-pdf">Save as PDF</button>` : ``}
      </div>
    `;
    shadow.querySelectorAll(".sc-tutor-mode").forEach(mode=>{
      mode.addEventListener("change", ()=>{
        const course=mode.getAttribute("data-course"), value=mode.value;
        const select=[...shadow.querySelectorAll(".sc-tutor-sel")].find(el=>el.getAttribute("data-course")===course);
        const trigger=[...shadow.querySelectorAll(".sc-tutor-trigger")].find(el=>el.getAttribute("data-course")===course);
        const hint=[...shadow.querySelectorAll(".sc-tutor-hint")].find(el=>el.getAttribute("data-course")===course);
        if(select){
          select.disabled=value==="none";
          if(value==="none") select.value="";
        }
        if(trigger){
          trigger.disabled=value==="none";
          if(value==="none"){
            trigger.querySelector(".sc-tutor-trigger-label").textContent="Choose a tutor";
            trigger.closest(".sc-tutor-select-wrap")?.classList.remove("open");
          }
        }
        if(hint) hint.textContent=value==="must"?"Only this tutor will be considered.":value==="prefer"?"This tutor receives a ranking boost.":"Choose Prefer or Must to select a tutor.";
      });
    });
    shadow.querySelectorAll(".sc-tutor-trigger").forEach(trigger=>{
      trigger.addEventListener("click", ()=>{
        if(trigger.disabled) return;
        const wrap=trigger.closest(".sc-tutor-select-wrap");
        const menu=wrap?.querySelector(".sc-tutor-menu");
        if(!wrap || !menu) return;
        shadow.querySelectorAll(".sc-tutor-select-wrap.open").forEach(other=>{
          if(other!==wrap){ other.classList.remove("open"); other.querySelector(".sc-tutor-menu")?.setAttribute("hidden",""); other.querySelector(".sc-tutor-trigger")?.setAttribute("aria-expanded","false"); }
        });
        const open=!wrap.classList.contains("open");
        wrap.classList.toggle("open",open);
        trigger.setAttribute("aria-expanded",String(open));
        if(open) menu.removeAttribute("hidden"); else menu.setAttribute("hidden","");
      });
    });
    shadow.querySelectorAll(".sc-tutor-option").forEach(option=>{
      option.addEventListener("click", ()=>{
        const menu=option.closest(".sc-tutor-menu"), wrap=option.closest(".sc-tutor-select-wrap");
        const trigger=wrap?.querySelector(".sc-tutor-trigger"), course=trigger?.getAttribute("data-course");
        const select=[...shadow.querySelectorAll(".sc-tutor-sel")].find(el=>el.getAttribute("data-course")===course);
        if(!menu || !wrap || !trigger || !select) return;
        const value=option.getAttribute("data-value") || "";
        select.value=value;
        trigger.querySelector(".sc-tutor-trigger-label").textContent=option.querySelector(".sc-option-name")?.textContent || "Choose a tutor";
        menu.querySelectorAll(".sc-tutor-option").forEach(item=>{ const selected=item===option; item.classList.toggle("selected",selected); item.setAttribute("aria-selected",String(selected)); });
        wrap.classList.remove("open");
        menu.setAttribute("hidden","");
        trigger.setAttribute("aria-expanded","false");
      });
    });
    modal.querySelector("#sc-close")?.addEventListener("click", close);
    modal.querySelector("#sc-back")?.addEventListener("click", ()=>{
      persistCurrentStepState();
      if(step===6) step=4;
      else step--;
      render();
    });
    modal.querySelector("#sc-next")?.addEventListener("click", ()=>{
      if(!persistCurrentStepState()) { render(); return; }
      // move to next logical step (1->2->3->4)
      if(step===4) step=6; // shouldn't happen via Next, but guard
      else step++;
      visited.add(step);
      render();
    });
    modal.querySelector("#sc-run")?.addEventListener("click", async (event)=>{
      if(optimizing || !persistCurrentStepState()) { render(); return; }
      event.currentTarget.disabled=true;
      await runOptimization();
    });
    modal.querySelector("#sc-restart")?.addEventListener("click", ()=>{ initWizard(); });
    modal.querySelector("#sc-save-pdf")?.addEventListener("click", async ()=>{
      const bodyHtml = shadow.querySelector(".sc-modal-body")?.innerHTML || "";
      const title = `SCOptimizer Results - ${new Date().toLocaleDateString()}`;
      // Open synchronously while the click still has transient user activation.
      const win = window.open("", "_blank");
      if(!win){ alert("Please allow popups to save PDF"); return; }
      let cssText = "";
      const cssUrls = [
        chrome.runtime.getURL("src/content/optimizer-modal.css"),
        chrome.runtime.getURL("src/content/overlay.css")
      ];
      for(const url of cssUrls){
        try{ const r = await fetch(url); cssText += await r.text() + "\n"; }catch(e){}
      }
      cssText += `
        body { font-family: "Open Sans", system-ui, sans-serif; padding: 16px; color:#1f2328; }
        .sc-schedule { break-inside: avoid; page-break-inside: avoid; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      `;
       win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${cssText}</style></head><body><h2 style="margin:0 0 8px">SCOptimizer Results</h2><div style="color:#656d76; font-size:12px; margin-bottom:12px">${courses.length} courses • ${results.length} schedules • ${tStart==null?"no time filter":fmtClock(tStart)+" - "+fmtClock(tEnd||18*60)} • ${preferDays?"fewer days":"fewer breaks"}</div>${bodyHtml}</body></html>`);
      win.document.close();
      win.focus();
      setTimeout(()=> win.print(), 600);
    });
    // clickable tabs — per-window visited tracking
    shadow.querySelectorAll(".sc-step[data-step]").forEach(el=>{
      el.addEventListener("click", ()=>{
        const target = parseInt(el.getAttribute("data-step"), 10);
         if(target===step) return;
         if(!visited.has(target)) return; // forward only if visited before, per instance
         if(!persistCurrentStepState()) { render(); return; }
         if(!visited.has(target)) { render(); return; }
         step = target;
        render();
      });
    });
  }

  window.__scWizard = { open, close, initWizard, loadAggregated };
  window.addEventListener("sc-storage-change", ()=>{
    if(!host?.classList.contains("open")) return;
    dataVersion++;
    optimizing=false;
    close();
    results=[];
    visited=new Set([1]);
    alert("Captured course data changed. Reopen Optimize to start with the latest data.");
  });
})();
