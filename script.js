(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORAGE = { tasks: "tasklyDashboardTasksV1", templates: "tasklyDashboardTemplatesV1" };
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
  const dateFrom = (value) => { if (!value) return null; const d = new Date(value + "T00:00:00"); return Number.isNaN(d.getTime()) ? null : d; };
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const dateLabel = (value, options={month:"short",day:"numeric"}) => { const d = dateFrom(value); return d ? new Intl.DateTimeFormat("ja-JP", options).format(d) : "日付未設定"; };
  const safeParse = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
  let tasks = safeParse(STORAGE.tasks, null);
  let templates = safeParse(STORAGE.templates, []);
  // Migrate tasks from the previous version's LocalStorage key when possible.
  if (!Array.isArray(tasks)) {
    const legacyTasks = safeParse("taskManagementAppTasks", []);
    tasks = Array.isArray(legacyTasks) ? legacyTasks.map(t => ({
      ...t,
      subject: t.subject || "",
      notes: t.notes || "",
      manualPriority: t.manualPriority || "auto",
      loggedHours: Number(t.loggedHours) || 0,
      completed: Boolean(t.completed)
    })) : [];
  }
  if (!Array.isArray(templates)) templates = [];
  let nextId = Math.max(0, ...tasks.map(t => Number(t.id)||0)) + 1;
  let currentView = "dashboard";
  let calendarMonth = new Date(today().getFullYear(), today().getMonth(), 1);
  let selectedDate = isoDate(today());
  let timerRemaining = 25 * 60;
  let timerInterval = null;
  let timerRunning = false;
  let timerStartedAt = null;
  let timerSessionSeconds = 0;
  let toastTimeout = null;

  const saveTasks = () => localStorage.setItem(STORAGE.tasks, JSON.stringify(tasks));
  const saveTemplates = () => localStorage.setItem(STORAGE.templates, JSON.stringify(templates));
  const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const daysLeft = (deadline) => { const d = dateFrom(deadline); return d ? Math.round((d - today()) / 86400000) : Infinity; };
  const taskIsOverdue = (t) => !t.completed && daysLeft(t.deadline) < 0;
  const priorityFor = (t) => {
    if (t.manualPriority && t.manualPriority !== "auto") return t.manualPriority;
    const days = daysLeft(t.deadline);
    if (days <= 1) return "high";
    if (days <= 3) return "medium";
    return "low";
  };
  const priorityLabel = (p) => ({high:"高",medium:"中",low:"低"})[p] || "低";
  const statusLabel = (t) => t.completed ? "完了" : taskIsOverdue(t) ? "期限超過" : daysLeft(t.deadline) === 0 ? "本日締切" : daysLeft(t.deadline) <= 3 ? "締切間近" : "未完了";
  const statusClass = (t) => t.completed ? "completed" : taskIsOverdue(t) ? "overdue" : "pending";
  const fmtHours = (n) => `${(Number(n)||0).toLocaleString("ja-JP",{maximumFractionDigits:2})}時間`;
  const remainingHours = (t) => Math.max(0, (Number(t.requiredHours)||0) - (Number(t.loggedHours)||0));
  const perDay = (t) => { const days = daysLeft(t.deadline); return remainingHours(t) / Math.max(1, Number.isFinite(days) ? days + 1 : 1); };
  function notify(message) {
    const toast = $("toast"); toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove("show"), 2600);
  }
  function showView(view) {
    currentView = view;
    document.querySelectorAll(".view-panel").forEach(el => el.classList.remove("active"));
    const panel = $(`${view}View`); if (panel) panel.classList.add("active");
    document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    const titles = {
      dashboard:["おかえりなさい 👋","今日の課題を確認して、少しずつ進めましょう。"],
      tasks:["すべての課題","課題を整理して、次の一歩を決めましょう。"],
      calendar:["課題カレンダー","締め切りを見通して、余裕をもって進めましょう。"],
      templates:["課題テンプレート","よく使う課題を登録して、入力の手間を減らしましょう。"]
    };
    $("pageTitle").textContent = titles[view][0]; $("pageSubtitle").textContent = titles[view][1];
    if (view === "calendar") renderCalendar();
    if (view === "templates") renderTemplates();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function priorityRank(t) { return ({high:1,medium:2,low:3})[priorityFor(t)] || 3; }
  function sortTasks(list, mode="deadline") {
    return [...list].sort((a,b) => {
      if (!!a.completed !== !!b.completed) return Number(!!a.completed) - Number(!!b.completed);
      if (mode === "priority" && priorityRank(a) !== priorityRank(b)) return priorityRank(a)-priorityRank(b);
      if (mode === "name") return String(a.name).localeCompare(String(b.name),"ja");
      return String(a.deadline || "9999-99-99").localeCompare(String(b.deadline || "9999-99-99")) || priorityRank(a)-priorityRank(b);
    });
  }
  function taskCard(t) {
    const state = statusClass(t), days = daysLeft(t.deadline), priority = priorityFor(t);
    let deadlineText = taskIsOverdue(t) ? `${Math.abs(days)}日超過` : days === 0 ? "本日締切" : days === 1 ? "明日締切" : days > 1 && days <= 3 ? `あと${days}日` : days === Infinity ? "締切未設定" : `締切 ${dateLabel(t.deadline)}`;
    const urgencyClass = (!t.completed && days <= 3) ? "urgent" : t.completed ? "ok" : "";
    return `<article class="task-card status-${state}">
      <div class="task-main-row">
        <input class="task-check" type="checkbox" data-action="toggle" data-id="${t.id}" aria-label="${escapeHTML(t.name)}を完了にする" ${t.completed ? "checked" : ""}>
        <div class="task-heading"><div class="task-name">${escapeHTML(t.name)}</div>
          <div class="task-subline"><span class="subject-chip">${escapeHTML(t.subject || "科目未分類")}</span>
          <span class="status-chip ${state}">${statusLabel(t)}</span><span class="priority-chip ${priority}">優先度 ${priorityLabel(priority)}</span></div>
        </div>
        <div class="task-actions"><button class="icon-action" data-action="edit" data-id="${t.id}" title="編集" aria-label="編集">✎</button><button class="icon-action delete" data-action="delete" data-id="${t.id}" title="削除" aria-label="削除">×</button></div>
      </div>
      ${t.notes ? `<div class="task-meta">メモ：${escapeHTML(t.notes)}</div>` : ""}
      <div class="task-meta"><span class="${urgencyClass}">◷ ${deadlineText}</span><span>◌ 残り ${fmtHours(remainingHours(t))}</span><span>✓ 実績 ${fmtHours(t.loggedHours || 0)}</span></div>
      <div class="task-card-bottom"><span class="task-time">1日あたりの目安 <strong>${fmtHours(perDay(t))}</strong></span>${t.completed ? '<span class="status-chip completed">完了済み</span>' : ""}</div>
    </article>`;
  }
  function setEmpty(id, visible) { $(id).classList.toggle("show", visible); }
  function renderTaskLists() {
    const dashboard = sortTasks(tasks).filter(t => !t.completed).slice(0,4);
    $("dashboardTaskList").innerHTML = dashboard.map(taskCard).join("");
    setEmpty("dashboardEmpty", dashboard.length === 0);
    const query = $("searchInput").value.trim().toLocaleLowerCase();
    const status = $("statusFilter").value, subject = $("subjectFilter").value, sort = $("sortFilter").value;
    let filtered = tasks.filter(t => {
      const matchesQuery = !query || `${t.name} ${t.subject||""} ${t.notes||""}`.toLocaleLowerCase().includes(query);
      const matchesSubject = subject === "all" || (t.subject || "科目未分類") === subject;
      const matchesStatus = status === "all" || (status === "pending" && !t.completed) || (status === "completed" && t.completed) || (status === "overdue" && taskIsOverdue(t));
      return matchesQuery && matchesSubject && matchesStatus;
    });
    filtered = sortTasks(filtered, sort);
    $("allTaskList").innerHTML = filtered.map(taskCard).join("");
    setEmpty("allTasksEmpty", filtered.length === 0);
    updateSelectOptions();
  }
  function renderStats() {
    const total = tasks.length, completed = tasks.filter(t=>t.completed).length, pending = total-completed;
    const rate = total ? Math.round(completed/total*100) : 0;
    $("totalCount").textContent = total; $("pendingCount").textContent = pending; $("completedCount").textContent = completed;
    $("completionRate").textContent = rate; $("completionBar").style.width = `${rate}%`;
    $("urgentFoot").textContent = `${tasks.filter(taskIsOverdue).length}件が期限超過`;
    $("donutRate").textContent = `${rate}%`; $("legendDone").textContent = completed; $("legendTodo").textContent = pending;
    $("progressDonut").style.background = `conic-gradient(var(--purple) ${rate}%, #eeeefa ${rate}% 100%)`;
    const counts = {};
    tasks.forEach(t => { const s = t.subject || "科目未分類"; counts[s] = (counts[s]||0)+1; });
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5), max = Math.max(1,...top.map(x=>x[1]));
    $("subjectChart").innerHTML = top.length ? top.map(([name,count])=>`<div class="bar-row"><span class="bar-label" title="${escapeHTML(name)}">${escapeHTML(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${count/max*100}%"></div></div><span class="bar-value">${count}</span></div>`).join("") : '<div class="day-empty">課題を登録すると、科目別の集計が表示されます。</div>';
  }
  function updateSelectOptions() {
    const subjects = [...new Set(tasks.map(t=>t.subject || "科目未分類"))].sort((a,b)=>a.localeCompare(b,"ja"));
    const current = $("subjectFilter").value;
    $("subjectFilter").innerHTML = '<option value="all">すべての科目</option>' + subjects.map(s=>`<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("");
    if (subjects.includes(current)) $("subjectFilter").value = current;
    const timerCurrent = $("timerTaskSelect").value;
    $("timerTaskSelect").innerHTML = '<option value="">課題を選択（任意）</option>' + sortTasks(tasks.filter(t=>!t.completed)).map(t=>`<option value="${t.id}">${escapeHTML(t.name)}</option>`).join("");
    if (tasks.some(t=>String(t.id)===timerCurrent && !t.completed)) $("timerTaskSelect").value = timerCurrent;
  }
  function renderMiniCalendar() {
    const now = today(), year = now.getFullYear(), month = now.getMonth();
    const first = new Date(year,month,1), start = new Date(year,month,1-first.getDay());
    const cells = weekdays.map(d=>`<div class="mini-weekday">${d}</div>`);
    for(let i=0;i<42;i++){
      const d = new Date(start); d.setDate(start.getDate()+i); const key=isoDate(d);
      const sameMonth=d.getMonth()===month, isToday=key===isoDate(now), dayTasks=tasks.filter(t=>t.deadline===key);
      const pendingCount=dayTasks.filter(t=>!t.completed&&!taskIsOverdue(t)).length;
      const overdueCount=dayTasks.filter(t=>!t.completed&&taskIsOverdue(t)).length;
      const completedCount=dayTasks.filter(t=>t.completed).length;
      cells.push(`<div class="mini-day ${sameMonth?"":"other"} ${isToday?"today":""} ${dayTasks.length?"has-task":""} ${dayTasks.length&&dayTasks.every(t=>t.completed)?"completed-day":""}" aria-label="${key}、課題${dayTasks.length}件、未完了${pendingCount}件、期限超過${overdueCount}件、完了${completedCount}件"><span>${d.getDate()}</span>${dayTasks.length?`<small class="mini-count">${dayTasks.length}件</small>`:""}</div>`);
    }
    $("miniCalendar").innerHTML=cells.join("");
  }
  function renderCalendar() {
    const y=calendarMonth.getFullYear(), m=calendarMonth.getMonth();
    $("calendarMonthLabel").textContent=`${y}年 ${m+1}月`;
    const first=new Date(y,m,1), start=new Date(y,m,1-first.getDay());
    const cells=weekdays.map(d=>`<div class="calendar-weekday">${d}</div>`);
    for(let i=0;i<42;i++){
      const d=new Date(start); d.setDate(start.getDate()+i); const key=isoDate(d);
      const dayTasks=tasks.filter(t=>t.deadline===key);
      const classes=["calendar-cell"]; if(d.getMonth()!==m) classes.push("other-month"); if(key===isoDate(today())) classes.push("today"); if(key===selectedDate) classes.push("selected");
      const pendingCount=dayTasks.filter(t=>!t.completed&&!taskIsOverdue(t)).length;
      const overdueCount=dayTasks.filter(t=>!t.completed&&taskIsOverdue(t)).length;
      const completedCount=dayTasks.filter(t=>t.completed).length;
      const count=dayTasks.length?`<span class="calendar-count">${dayTasks.length}件の課題</span>`:`<span class="calendar-no-task">課題なし</span>`;
      const summary=dayTasks.length?`<span class="calendar-status-line">${overdueCount?`<span class="calendar-status overdue">期限超過 ${overdueCount}</span>`:""}${pendingCount?`<span class="calendar-status pending">未完了 ${pendingCount}</span>`:""}${completedCount?`<span class="calendar-status completed">✓ 完了 ${completedCount}</span>`:""}</span>`:"";
      cells.push(`<button class="${classes.join(" ")}" data-calendar-date="${key}" aria-label="${key}、課題${dayTasks.length}件、未完了${pendingCount}件、期限超過${overdueCount}件、完了${completedCount}件"><span class="calendar-date">${d.getDate()}</span>${count}${summary}</button>`);
    }
    $("fullCalendar").innerHTML=cells.join(""); $("selectedDateLabel").textContent=dateLabel(selectedDate,{year:"numeric",month:"long",day:"numeric",weekday:"short"});
    const dayTasks=sortTasks(tasks.filter(t=>t.deadline===selectedDate));
    $("selectedDayTasks").innerHTML=dayTasks.length?`<p class="day-task-count">この日の課題：${dayTasks.length}件</p>`+dayTasks.map(t=>`<div class="day-task"><strong>${escapeHTML(t.name)}</strong><span>${escapeHTML(t.subject||"科目未分類")}</span><span class="day-status ${statusClass(t)}">${statusLabel(t)}</span></div>`).join(""):'<p class="day-empty">この日の締め切り課題はありません。<br>予定に余裕がある日です。</p>';
  }
  function renderTemplates() {
    $("templateList").innerHTML=templates.map(t=>`<article class="template-card"><span class="template-symbol">◇</span><div class="template-content"><strong>${escapeHTML(t.taskName || t.name)}</strong><span>${escapeHTML(t.subject||"科目未分類")} · ${fmtHours(t.requiredHours)}</span></div><div class="template-actions"><button data-template-use="${t.id}">課題に使う</button><button data-template-delete="${t.id}" aria-label="テンプレートを削除">削除</button></div></article>`).join("");
    setEmpty("templateEmpty",templates.length===0);
  }
  function renderAll() {
    saveTasks(); renderStats(); renderTaskLists(); renderMiniCalendar();
    if(currentView==="calendar") renderCalendar();
    if(currentView==="templates") renderTemplates();
  }
  function renderTaskTemplateOptions() {
    const select = $("taskTemplateSelect");
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">テンプレートを選択すると自動入力</option>' + templates.map(t => `<option value="${t.id}">${escapeHTML(t.taskName || t.name)} ／ ${escapeHTML(t.subject || "科目未分類")} ／ ${fmtHours(t.requiredHours)}</option>`).join("");
    if (templates.some(t => String(t.id) === current)) select.value = current;
  }
  function applyTaskTemplate(templateId) {
    const t = templates.find(x => String(x.id) === String(templateId));
    if (!t) return;
    $("taskName").value = t.taskName || "";
    $("taskSubject").value = t.subject || "";
    $("requiredHours").value = t.requiredHours || 2;
    $("taskNotes").value = t.notes || "";
    notify(`「${t.name}」の内容を入力しました。締め切りを設定してください。`);
  }
  function openTaskDialog(task=null, template=null) {
    $("taskForm").reset(); $("editingTaskId").value=task?String(task.id):"";
    $("taskDialogTitle").textContent=task?"課題を編集":"課題を追加";
    $("taskFormError").hidden=true; $("taskFormError").textContent="";
    $("taskName").value=task?.name ?? template?.taskName ?? "";
    $("taskSubject").value=task?.subject ?? template?.subject ?? "";
    $("deadline").value=task?.deadline ?? "";
    $("requiredHours").value=task?.requiredHours ?? template?.requiredHours ?? "";
    $("manualPriority").value=task?.manualPriority ?? "auto";
    $("taskNotes").value=task?.notes ?? "";
    $("taskDialog").showModal(); setTimeout(()=>$("taskName").focus(),50);
  }
  function saveTaskFromForm(event) {
    event.preventDefault();
    const name=$("taskName").value.trim(), deadline=$("deadline").value, hours=Number($("requiredHours").value), subject=$("taskSubject").value.trim(), id=$("editingTaskId").value;
    const showFormError = (message, field) => { const box=$("taskFormError"); box.textContent=message; box.hidden=false; if(field) $(field).focus(); };
    $("taskFormError").hidden=true; $("taskFormError").textContent="";
    if(!name||!deadline||!Number.isFinite(hours)||hours<=0){showFormError("課題名・締め切り・作業時間を正しく入力してください。", !name?"taskName":!deadline?"deadline":"requiredHours");return;}
    const d=dateFrom(deadline); if(!d){showFormError("締め切りの日付を確認してください。","deadline");return;}
    const existing=tasks.find(t=>String(t.id)===id);
    const startOfToday = today();
    if (d < startOfToday) { showFormError("この締め切り日は過去の日付です。今日以降の日付を選択してください。","deadline"); return; }
    const item={id:existing?existing.id:nextId++,name,deadline,requiredHours:hours,subject,notes:$("taskNotes").value.trim(),manualPriority:$("manualPriority").value,completed:existing?.completed||false,loggedHours:Number(existing?.loggedHours)||0,createdAt:existing?.createdAt||new Date().toISOString()};
    if(existing) tasks=tasks.map(t=>t.id===existing.id?item:t); else tasks.push(item);
    $("taskDialog").close(); renderAll(); notify(existing?"課題を更新しました":"課題を登録しました");
  }
  function handleTaskAction(event) {
    const el=event.target.closest("[data-action]"); if(!el)return;
    const id=Number(el.dataset.id), task=tasks.find(t=>Number(t.id)===id); if(!task)return;
    const action=el.dataset.action;
    if(action==="toggle"){task.completed=el.checked;renderAll();notify(task.completed?"課題を完了にしました":"未完了に戻しました");}
    if(action==="edit")openTaskDialog(task);
    if(action==="delete" && confirm(`「${task.name}」を削除しますか？`)){tasks=tasks.filter(t=>Number(t.id)!==id);renderAll();notify("課題を削除しました");}
  }
  function addTemplateTask(templateId) {
    const t=templates.find(x=>Number(x.id)===Number(templateId)); if(!t)return;
    showView("dashboard"); openTaskDialog(null,t);
  }
  function addTemplate(event) {
    event.preventDefault();
    const taskName=$("templateTaskName").value.trim(), subject=$("templateSubject").value.trim(), hours=Number($("templateHours").value);
    if(!taskName||!Number.isFinite(hours)||hours<=0){notify("課題名と必要な作業時間を確認してください");return;}
    templates.push({id:Date.now(),name:taskName,taskName,subject,requiredHours:hours});saveTemplates();$("templateForm").reset();$("templateHours").value="2";renderTemplates();renderTaskTemplateOptions();notify("課題名でテンプレートを保存しました");
  }
  function handleTemplateClick(event) {
    const use=event.target.closest("[data-template-use]"), del=event.target.closest("[data-template-delete]");
    if(use)addTemplateTask(use.dataset.templateUse);
    if(del){const id=Number(del.dataset.templateDelete);const t=templates.find(x=>Number(x.id)===id);if(t&&confirm(`テンプレート「${t.taskName || t.name}」を削除しますか？`)){templates=templates.filter(x=>Number(x.id)!==id);saveTemplates();renderTemplates();notify("テンプレートを削除しました");}}
  }
  function setTimerMinutes() { if(timerRunning)return; timerRemaining=Number($("timerMinutes").value)*60; timerSessionSeconds=0; updateTimerDisplay(); }
  function updateTimerDisplay() { const m=Math.floor(timerRemaining/60),s=timerRemaining%60;$("timerDisplay").textContent=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`; }
  function stopTimer() { clearInterval(timerInterval);timerInterval=null;timerRunning=false;$("timerStart").textContent="開始"; }
  function finishTimer() {
    stopTimer(); const elapsedMinutes=Math.round(timerSessionSeconds/60);
    const taskId=$("timerTaskSelect").value, task=tasks.find(t=>String(t.id)===taskId);
    if(task && elapsedMinutes > 0){task.loggedHours=(Number(task.loggedHours)||0)+elapsedMinutes/60;renderAll();notify(`${task.name} に${elapsedMinutes}分の作業時間を記録しました`);}
    else notify("集中時間が終了しました。お疲れさまでした！");
    $("timerStatus").textContent="タイマー終了。少し休憩しましょう。";timerRemaining=0;updateTimerDisplay();
  }
  function toggleTimer() {
    if(timerRunning){stopTimer();$("timerStatus").textContent="一時停止中です。開始すると続きから再開します。";return;}
    if(timerRemaining<=0)setTimerMinutes();
    timerRunning=true;timerStartedAt=Date.now();$("timerStart").textContent="一時停止";$("timerStatus").textContent="集中中です。終了すると選択した課題に作業時間を記録します。";
    timerInterval=setInterval(()=>{timerRemaining--;timerSessionSeconds++;updateTimerDisplay();if(timerRemaining<=0)finishTimer();},1000);
  }

  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
  $("newTaskTopButton").addEventListener("click",()=>openTaskDialog());
  $("newTaskListButton").addEventListener("click",()=>openTaskDialog());
  $("closeTaskDialog").addEventListener("click",()=>$("taskDialog").close());
  $("cancelTaskDialog").addEventListener("click",()=>$("taskDialog").close());
  $("taskForm").addEventListener("submit",saveTaskFromForm);
  ["taskName","deadline","requiredHours"].forEach(id => $(id).addEventListener("input", () => { $("taskFormError").hidden=true; $("taskFormError").textContent=""; }));
  $("taskTemplateSelect").addEventListener("change", e => { if (e.target.value) applyTaskTemplate(e.target.value); });
  $("dashboardTaskList").addEventListener("click",handleTaskAction);
  $("dashboardTaskList").addEventListener("change",handleTaskAction);
  $("allTaskList").addEventListener("click",handleTaskAction);
  $("allTaskList").addEventListener("change",handleTaskAction);
  ["searchInput","statusFilter","subjectFilter","sortFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderTaskLists));
  $("clearCompletedButton").addEventListener("click",()=>{const completed=tasks.filter(t=>t.completed);if(!completed.length){notify("削除できる完了済み課題はありません。");return;}if(confirm(`完了済みの課題 ${completed.length}件を削除します。
この操作は元に戻せません。続けますか？`)){tasks=tasks.filter(t=>!t.completed);renderAll();notify(`完了済み課題を${completed.length}件削除しました。`);}});
  $("templateForm").addEventListener("submit",addTemplate);
  $("templateList").addEventListener("click",handleTemplateClick);
  $("clearTemplatesButton").addEventListener("click",()=>{ if(!templates.length){notify("削除できるテンプレートはありません。");return;} if(confirm(`登録済みテンプレート ${templates.length}件をすべて削除しますか？\nこの操作は元に戻せません。`)){templates=[];saveTemplates();renderTemplates();renderTaskTemplateOptions();notify("テンプレートをすべて削除しました。");} });
  $("prevMonth").addEventListener("click",()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderCalendar();});
  $("nextMonth").addEventListener("click",()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderCalendar();});
  $("fullCalendar").addEventListener("click",e=>{const cell=e.target.closest("[data-calendar-date]");if(!cell)return;selectedDate=cell.dataset.calendarDate;const d=dateFrom(selectedDate);calendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar();});
  $("timerStart").addEventListener("click",toggleTimer);
  $("timerReset").addEventListener("click",()=>{stopTimer();setTimerMinutes();$("timerStatus").textContent="タイマーをリセットしました。";});
  $("timerMinutes").addEventListener("change",setTimerMinutes);
  $("todayLabel").textContent=new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date()).toUpperCase();
  // Starter templates are added only on first use, so existing user templates are preserved.
  if(templates.length===0){templates=[{id:Date.now()+1,name:"レポート課題",taskName:"レポートを作成して提出する",subject:"レポート",requiredHours:3},{id:Date.now()+2,name:"プログラミング課題",taskName:"プログラムを作成・動作確認する",subject:"プログラミング",requiredHours:2},{id:Date.now()+3,name:"試験勉強",taskName:"試験範囲を復習する",subject:"試験勉強",requiredHours:2}];saveTemplates();}
  renderAll();renderTemplates();renderTaskTemplateOptions();updateTimerDisplay();
})();