(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORAGE = { tasks: "tasklyDashboardTasksV2", templates: "tasklyDashboardTemplatesV2", heroXp: "tasklyRpgHeroXpV2", history: "tasklyLifetimeHistoryV2" };
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
  const dateFrom = (value) => { if (!value) return null; const d = new Date(value + "T00:00:00"); return Number.isNaN(d.getTime()) ? null : d; };
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const dateLabel = (value, options={month:"short",day:"numeric"}) => { const d = dateFrom(value); return d ? new Intl.DateTimeFormat("ja-JP", options).format(d) : "日付未設定"; };
  const safeParse = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
  let tasks = safeParse(STORAGE.tasks, null);
  let templates = safeParse(STORAGE.templates, []);
  let heroXp = Math.max(0, Number(safeParse(STORAGE.heroXp, 0)) || 0);
  if (!Array.isArray(tasks)) tasks = [];
  if (!Array.isArray(templates)) templates = [];
  const initialHistory = safeParse(STORAGE.history, null);
  let history = initialHistory && typeof initialHistory === "object" ? {
    firstUsedAt: initialHistory.firstUsedAt || new Date().toISOString(),
    totalStudyHours: Math.max(0, Number(initialHistory.totalStudyHours) || 0),
    totalCompleted: Math.max(0, Number(initialHistory.totalCompleted) || 0),
    studySessions: Math.max(0, Number(initialHistory.studySessions) || 0),
    workLogCount: Math.max(0, Number(initialHistory.workLogCount) || 0),
    studyDays: Array.isArray(initialHistory.studyDays) ? [...new Set(initialHistory.studyDays.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort() : [],
    achievementDates: initialHistory.achievementDates && typeof initialHistory.achievementDates === "object" ? initialHistory.achievementDates : {}
  } : { firstUsedAt: new Date().toISOString(), totalStudyHours: 0, totalCompleted: 0, studySessions: 0, workLogCount: 0, studyDays: [], achievementDates: {} };
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
  const saveHeroXp = () => localStorage.setItem(STORAGE.heroXp, JSON.stringify(heroXp));
  const saveHistory = () => localStorage.setItem(STORAGE.history, JSON.stringify(history));
  // Estimated cumulative work time is the sum of requiredHours on currently registered tasks. Manual logged time remains a separate per-task record.
  const cumulativeRequiredHours = () => tasks.reduce((sum, task) => sum + Math.max(0, Number(task.requiredHours) || 0), 0);
  function reconcileStudyHistory() {
    history.totalStudyHours = Math.max(0, Number(history.totalStudyHours) || 0);
    history.totalCompleted = Math.max(0, Number(history.totalCompleted) || 0);
    history.studySessions = Math.max(0, Number(history.studySessions) || 0);
    if (!Array.isArray(history.studyDays)) history.studyDays = [];
    if (!history.achievementDates || typeof history.achievementDates !== "object") history.achievementDates = {};
  }
  const fullDateLabel = (value) => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat("ja-JP", {year:"numeric",month:"long",day:"numeric"}).format(d) : "記録なし"; };
  const durationLabel = (hours) => { const minutes = Math.round((Number(hours)||0)*60); return `${Math.floor(minutes/60)}時間${String(minutes%60).padStart(2,"0")}分`; };
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
  function notify(message, duration=2600) {
    const toast = $("toast"); toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove("show"), duration);
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
      templates:["課題テンプレート","よく使う課題を登録して、入力の手間を減らしましょう。"],
      achievements:["実績・学習記録","これまでの達成実績と、積み重ねてきた学習の記録を振り返りましょう。"]
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
      <div class="task-card-bottom"><span class="task-time">1日あたりの目安 <strong>${fmtHours(perDay(t))}</strong></span>${t.completed ? '<span class="status-chip completed">完了済み</span>' : ""}<button class="work-log-button" data-action="log-time" data-id="${t.id}" type="button">＋ 作業時間を記録</button></div>
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
  function renderHero() {
    const XP_PER_LEVEL = 80;
    const level = Math.floor(heroXp / XP_PER_LEVEL) + 1;
    const inLevel = heroXp % XP_PER_LEVEL;
    const completed = tasks.filter(t => t.completed).length;
    const overdue = tasks.filter(taskIsOverdue).length;
    const ranks = [
      {name:"駆け出しの冒険者", flavor:"最初の一歩が、伝説の始まり。", emblem:"⚔"},
      {name:"見習いクエスター", flavor:"小さな達成が、自信へと変わっていく。", emblem:"🛡"},
      {name:"森のレンジャー", flavor:"観察と工夫で、道を切り開こう。", emblem:"🏹"},
      {name:"鋼鉄の守護騎士", flavor:"揺るがぬ意志が仲間を守る。", emblem:"🛡"},
      {name:"魔導学院の賢者", flavor:"知識を磨き、新たな術を得た。", emblem:"✦"},
      {name:"王国のエリート", flavor:"数々の試練を越え、信頼を得た。", emblem:"♛"},
      {name:"竜狩りの英雄", flavor:"強敵にもひるまず立ち向かう。", emblem:"🐉"},
      {name:"聖剣の継承者", flavor:"伝説の武具にふさわしい実力。", emblem:"⚔"},
      {name:"星詠みの覇者", flavor:"星々の導きさえ力に変える。", emblem:"🌟"},
      {name:"永遠の伝説", flavor:"努力の軌跡そのものが伝説となった。", emblem:"👑"}
    ];
    const rankIndex = Math.min(ranks.length - 1, Math.floor((level - 1) / 2));
    const rank = ranks[rankIndex];
    const panel = document.querySelector(".hero-panel");
    const character = document.querySelector(".hero-character");
    if(character){ character.classList.remove(...Array.from({length:10},(_,i)=>`gear-${i}`)); character.classList.add(`gear-${rankIndex}`); character.setAttribute("aria-label", `${rank.name}の装備`); }
    if (panel) {
      panel.classList.remove(...Array.from({length:10}, (_,i)=>`rank-${i}`));
      panel.classList.add(`rank-${rankIndex}`);
    }
    $("heroRank").textContent = rank.name;
    $("heroLevel").textContent = level;
    $("heroFlavor").textContent = rank.flavor;
    $("heroXp").textContent = inLevel;
    $("heroNextXp").textContent = XP_PER_LEVEL;
    $("heroXpBar").style.width = `${Math.round(inLevel / XP_PER_LEVEL * 100)}%`;
    $("heroCompleted").textContent = `達成クエスト ${completed}件`;
    $("heroNextHint").textContent = `次のレベルまであと${XP_PER_LEVEL - inLevel} XP`;
    const emblem = document.querySelector(".hero-emblem span");
    if (emblem) emblem.textContent = rank.emblem;
    if (!tasks.length) {
      $("heroQuestTitle").textContent = "最初のクエストを受注しよう";
      $("heroQuestText").textContent = "課題を登録し、完了すると経験値を獲得できます。";
    } else if (completed === tasks.length) {
      $("heroQuestTitle").textContent = "すべてのクエストを達成！";
      $("heroQuestText").textContent = "見事な成果です。次の挑戦を登録しましょう。";
    } else if (overdue > 0) {
      $("heroQuestTitle").textContent = `期限超過クエストが${overdue}件あります`;
      $("heroQuestText").textContent = "ひとつ選んで、できるところから立て直そう。";
    } else {
      $("heroQuestTitle").textContent = "次のクエストが待っている";
      $("heroQuestText").textContent = "小さなタスクも、完了すれば確かな前進。";
    }
    renderAchievements(completed);
  }
  function getAchievementDefinitions() {
    const lifetimeCompleted = history.totalCompleted;
    const hours = cumulativeRequiredHours();
    const activeDays = history.studyDays.length;
    return [
      {id:"first", icon:"🌱", name:"冒険のはじまり", desc:"最初の課題を完了", unlocked:lifetimeCompleted>=1},
      {id:"five", icon:"📜", name:"クエスト見習い", desc:"課題を累計5件完了", unlocked:lifetimeCompleted>=5},
      {id:"ten", icon:"🏅", name:"頼れる冒険者", desc:"課題を累計10件完了", unlocked:lifetimeCompleted>=10},
      {id:"twentyfive", icon:"🏆", name:"伝説の積み重ね", desc:"課題を累計25件完了", unlocked:lifetimeCompleted>=25},
      {id:"study5", icon:"⌛", name:"集中の達人", desc:"登録課題の必要作業時間が累計5時間", unlocked:hours>=5},
      {id:"study25", icon:"📚", name:"学びの探究者", desc:"登録課題の必要作業時間が累計25時間", unlocked:hours>=25},
      {id:"study100", icon:"🔮", name:"知識の賢者", desc:"登録課題の必要作業時間が累計100時間", unlocked:hours>=100},
      {id:"days7", icon:"🗓️", name:"習慣の芽", desc:"7日間作業時間を記録", unlocked:activeDays>=7},
      {id:"days30", icon:"🌟", name:"継続の達人", desc:"30日間作業時間を記録", unlocked:activeDays>=30},
      {id:"logfirst", icon:"🪶", name:"記録の第一歩", desc:"作業時間を30分以上記録", unlocked:hours>=0.5}
    ];
  }
  function unlockedAchievementIds() {
    return new Set(getAchievementDefinitions().filter(a => a.unlocked).map(a => a.id));
  }
  function getNewlyUnlockedAchievements(previousIds) {
    return getAchievementDefinitions().filter(a => a.unlocked && !previousIds.has(a.id));
  }
  function renderAchievements(completed) {
    const host = $("achievementList");
    if (!host) return;
    const lifetimeCompleted = history.totalCompleted;
    const hours = cumulativeRequiredHours();
    const activeDays = history.studyDays.length;
    const achievements = getAchievementDefinitions();
    achievements.forEach(a => { if (a.unlocked && !history.achievementDates[a.id]) history.achievementDates[a.id] = new Date().toISOString(); });
    saveHistory();
    host.innerHTML = achievements.map(a=>`<div class="achievement ${a.unlocked?'unlocked':'locked'}" title="${escapeHTML(a.desc)}"><span class="achievement-icon">${a.unlocked?a.icon:'🔒'}</span><span class="achievement-copy"><strong>${escapeHTML(a.name)}</strong><small>${escapeHTML(a.desc)}</small>${a.unlocked?`<small class="achievement-date">獲得：${escapeHTML(fullDateLabel(history.achievementDates[a.id]))}</small>`:""}</span><span class="achievement-state">${a.unlocked?'獲得':'未獲得'}</span></div>`).join("");
    const statsHost = $("lifetimeStats");
    if (statsHost) {
      const first = new Date(history.firstUsedAt);
      const daysUsing = Number.isNaN(first.getTime()) ? 1 : Math.max(1, Math.floor((today() - new Date(first.getFullYear(),first.getMonth(),first.getDate())) / 86400000) + 1);
      const currentStreak = (() => { let n=0, d=today(); const set=new Set(history.studyDays); while(set.has(isoDate(d))){n++;d.setDate(d.getDate()-1);} if(n===0){d=today();d.setDate(d.getDate()-1);while(set.has(isoDate(d))){n++;d.setDate(d.getDate()-1);}} return n; })();
      const items = [
        ["📅","初回利用日",fullDateLabel(history.firstUsedAt)],
        ["⏳","必要作業時間の合計",durationLabel(cumulativeRequiredHours())],
        ["✅","累計完了課題",`${lifetimeCompleted}件`],
        ["🏅","獲得した実績",`${achievements.filter(a=>a.unlocked).length} / ${achievements.length}個`],
        ["🗓️","作業を記録した日数",`${activeDays}日`],
        ["🔥","現在の連続記録",`${currentStreak}日`],
        ["📖","利用開始から",`${daysUsing}日目`],
        ["📝","作業時間の記録",`${history.workLogCount || 0}回`]
      ];
      statsHost.innerHTML = items.map(([icon,label,value])=>`<div class="lifetime-stat"><span class="lifetime-stat-icon">${icon}</span><span class="lifetime-stat-copy"><small>${label}</small><strong>${value}</strong></span></div>`).join("");
    }
  }
  function renderDeadlineNotice() {
    const notice = $("deadlineNotice");
    if (!notice) return;
    const active = tasks.filter(t => !t.completed && t.deadline && Number.isFinite(daysLeft(t.deadline)) && daysLeft(t.deadline) <= 3);
    const overdueCount = active.filter(taskIsOverdue).length;
    const upcomingCount = active.length - overdueCount;
    notice.hidden = active.length === 0;
    if (!active.length) return;
    $("deadlineNoticeCount").textContent = `${active.length}`;
    $("deadlineNoticeTitle").textContent = overdueCount ? `締め切りの確認が必要な課題があります` : `締め切りが近い課題があります`;
    const details = [];
    if (overdueCount) details.push(`期限超過 ${overdueCount}件`);
    if (upcomingCount) details.push(`3日以内 ${upcomingCount}件`);
    $("deadlineNoticeDetail").textContent = `${details.join(" ・ ")}　一覧を確認`;
    notice.classList.toggle("has-overdue", overdueCount > 0);
  }
  function renderStats() {
    const total = tasks.length, completed = tasks.filter(t=>t.completed).length, pending = total-completed;
    const requiredHoursTotal = cumulativeRequiredHours();
    const workTotal = $("cumulativeWorkHours");
    if (workTotal) workTotal.textContent = durationLabel(requiredHoursTotal);
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
    reconcileStudyHistory();
    saveTasks(); saveHeroXp(); saveHistory(); renderHero(); renderStats(); renderTaskLists(); renderMiniCalendar(); renderDeadlineNotice();
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
    const item={id:existing?existing.id:nextId++,name,deadline,requiredHours:hours,subject,notes:$("taskNotes").value.trim(),manualPriority:$("manualPriority").value,completed:existing?.completed||false,xpClaimed:Boolean(existing?.xpClaimed),loggedHours:Number(existing?.loggedHours)||0,createdAt:existing?.createdAt||new Date().toISOString()};
    if(existing) tasks=tasks.map(t=>t.id===existing.id?item:t); else tasks.push(item);
    $("taskDialog").close(); renderAll(); notify(existing?"課題を更新しました":"課題を登録しました");
  }
  function handleTaskAction(event) {
    const el=event.target.closest("[data-action]"); if(!el)return;
    const id=Number(el.dataset.id), task=tasks.find(t=>Number(t.id)===id); if(!task)return;
    const action=el.dataset.action;
    if(action==="toggle"){
      const previousAchievements = unlockedAchievementIds();
      const wasCompleted = task.completed;
      task.completed=el.checked;
      if (task.completed && !wasCompleted) { history.totalCompleted += 1; saveHistory(); }
      let earned = 0;
      if (task.completed && !task.xpClaimed) {
        earned = 60 + Math.min(40, Math.round((Number(task.requiredHours) || 0) * 8));
        task.xpClaimed = true;
        heroXp += earned;
        saveHeroXp();
      }
      renderAll();
      const newlyUnlocked = getNewlyUnlockedAchievements(previousAchievements);
      if (newlyUnlocked.length) {
        const names = newlyUnlocked.map(a=>`${a.icon} ${a.name}`).join("・");
        notify(`🏆 実績獲得！ ${names}${task.completed && earned > 0 ? `　／　+${earned} XP` : ""}`, 5200);
      } else notify(task.completed ? `クエスト達成！ +${earned || 0} XP` : "クエストを未完了に戻しました（獲得済みXPは維持されます）");
    }
    if(action==="log-time"){
      const raw = prompt(`「${task.name}」の作業時間を何分記録しますか？\n数字で入力してください（例：30）`);
      if(raw===null)return;
      const minutes=Number(raw);
      if(!Number.isFinite(minutes)||minutes<=0||minutes>1440||!Number.isInteger(minutes)){notify("1〜1440の整数（分）を入力してください。");return;}
      const previousAchievements=unlockedAchievementIds();
      const hours=minutes/60;
      task.loggedHours=(Number(task.loggedHours)||0)+hours;
      history.totalStudyHours+=hours;
      history.workLogCount=(Number(history.workLogCount)||0)+1;
      const dayKey=isoDate(today()); if(!history.studyDays.includes(dayKey))history.studyDays.push(dayKey);
      saveTasks();saveHistory();renderAll();
      const newlyUnlocked=getNewlyUnlockedAchievements(previousAchievements);
      if(newlyUnlocked.length)notify(`🏆 実績獲得！ ${newlyUnlocked.map(a=>`${a.icon} ${a.name}`).join("・")}`,5200);
      else notify(`${task.name} に作業時間 ${minutes}分を記録しました`);
    }
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
  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup() {
    const payload = { app: "Taskly", formatVersion: 3, exportedAt: new Date().toISOString(), tasks, templates, heroXp, history };
    const stamp = isoDate(today());
    downloadBlob(JSON.stringify(payload, null, 2), `taskly-backup-${stamp}.json`, "application/json;charset=utf-8");
    notify("バックアップを保存しました。大切に保管してください。");
  }
  function importBackupFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => notify("ファイルを読み込めませんでした。別のファイルを選んでください。");
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ""));
        if (!data || data.app !== "Taskly" || !Array.isArray(data.tasks) || !Array.isArray(data.templates)) {
          throw new Error("Tasklyのバックアップ形式ではありません。");
        }
        const validTasks = data.tasks.every(t => t && (typeof t.id === "number" || typeof t.id === "string") && typeof t.name === "string" && typeof t.deadline === "string" && Number.isFinite(Number(t.requiredHours)));
        const validTemplates = data.templates.every(t => t && (typeof t.id === "number" || typeof t.id === "string") && typeof (t.taskName || t.name) === "string" && Number.isFinite(Number(t.requiredHours)));
        if (!validTasks || !validTemplates) throw new Error("バックアップ内の課題データに不備があります。");
        if (!confirm(`バックアップ内の課題 ${data.tasks.length}件、テンプレート ${data.templates.length}件を読み込みます。
現在のデータは置き換わります。先に現在のバックアップを保存しましたか？`)) return;
        tasks = data.tasks.map(t => ({
          ...t, id: t.id, name: String(t.name), deadline: String(t.deadline),
          requiredHours: Number(t.requiredHours), subject: String(t.subject || ""), notes: String(t.notes || ""),
          manualPriority: t.manualPriority || "auto", completed: Boolean(t.completed),
          loggedHours: Math.max(0, Number(t.loggedHours) || 0), createdAt: t.createdAt || new Date().toISOString()
        }));
        templates = data.templates.map(t => ({...t, id: t.id, name: String(t.taskName || t.name), taskName: String(t.taskName || t.name), subject: String(t.subject || ""), requiredHours: Number(t.requiredHours)}));
        if (data.history && typeof data.history === "object") {
          history = { ...history, ...data.history, achievementDates: data.history.achievementDates || {}, studyDays: Array.isArray(data.history.studyDays) ? data.history.studyDays : [] };
        } else {
          history.totalStudyHours = Math.max(0, Number(history.totalStudyHours) || 0);
          history.totalCompleted = Math.max(history.totalCompleted, tasks.filter(t=>t.completed).length);
        }
        saveHistory();
        heroXp = Number.isFinite(Number(data.heroXp)) && data.heroXp !== undefined
          ? Math.max(0, Number(data.heroXp))
          : data.tasks.filter(t => t && t.completed).length * 70;
        if (data.heroXp === undefined) tasks.forEach(t => { if (t.completed) t.xpClaimed = true; });
        saveHeroXp();
        nextId = Math.max(0, ...tasks.map(t => Number(t.id) || 0)) + 1;
        saveTasks(); saveTemplates(); renderAll(); renderTemplates(); renderTaskTemplateOptions();
        notify("バックアップを読み込みました。");
      } catch (error) {
        notify(error instanceof SyntaxError ? "JSONファイルを読み取れません。Tasklyのバックアップを選んでください。" : (error.message || "バックアップを読み込めませんでした。"));
      } finally { $("importBackupFile").value = ""; }
    };
    reader.readAsText(file);
  }
  function setTimerMinutes() { if(timerRunning)return; timerRemaining=Number($("timerMinutes").value)*60; timerSessionSeconds=0; updateTimerDisplay(); }
  function updateTimerDisplay() { const m=Math.floor(timerRemaining/60),s=timerRemaining%60;$("timerDisplay").textContent=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`; }
  function stopTimer() { clearInterval(timerInterval);timerInterval=null;timerRunning=false;$("timerStart").textContent="開始"; }
  function finishTimer() {
    stopTimer();
    timerRemaining=0; updateTimerDisplay();
    $("timerStatus").textContent="タイマー終了。作業時間を累計に加える場合は、課題カードの「作業時間を記録」を使ってください。";
    notify("集中タイマーが終了しました。作業時間は自動加算していません。");
  }
  function toggleTimer() {
    if(timerRunning){stopTimer();$("timerStatus").textContent="一時停止中です。開始すると続きから再開します。";return;}
    if(timerRemaining<=0)setTimerMinutes();
    timerRunning=true;timerStartedAt=Date.now();$("timerStart").textContent="一時停止";$("timerStatus").textContent="集中中です。タイマーは時間計測のみで、作業時間は自動記録されません。";
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
  $("exportBackupButton").addEventListener("click", exportBackup);
  $("importBackupButton").addEventListener("click", () => $("importBackupFile").click());
  $("importBackupFile").addEventListener("change", e => importBackupFile(e.target.files && e.target.files[0]));
  $("resetAllDataButton").addEventListener("click", () => {
    const accepted = confirm("本当にすべてのデータをリセットしますか？\n\n・登録した課題と完了状況\n・課題ごとの作業時間\n・経験値とレベル／冒険ランク\n・自分で登録したテンプレート\n\nこの操作は元に戻せません。先にバックアップを保存することをおすすめします。");
    if (!accepted) return;
    const confirmation = prompt("リセットを実行するには「RESET」と入力してください。");
    if (confirmation !== "RESET") { notify("リセットをキャンセルしました。"); return; }
    stopTimer();
    tasks = [];
    heroXp = 0;
    history = { firstUsedAt: new Date().toISOString(), totalStudyHours: 0, totalCompleted: 0, studySessions: 0, workLogCount: 0, studyDays: [], achievementDates: {} };
    templates = [
      {id:Date.now()+1,name:"レポート課題",taskName:"レポートを作成して提出する",subject:"レポート",requiredHours:3},
      {id:Date.now()+2,name:"プログラミング課題",taskName:"プログラムを作成・動作確認する",subject:"プログラミング",requiredHours:2},
      {id:Date.now()+3,name:"試験勉強",taskName:"試験範囲を復習する",subject:"試験勉強",requiredHours:2}
    ];
    nextId = 1;
    localStorage.removeItem("taskManagementAppTasks");
    saveTasks(); saveTemplates(); saveHeroXp(); saveHistory();
    setTimerMinutes();
    $("timerStatus").textContent = "データをリセットしました。新しい冒険を始めましょう。";
    renderAll(); renderTemplates(); renderTaskTemplateOptions();
    showView("dashboard");
    notify("データをリセットしました。新しい冒険の始まりです！");
  });
  $("timerStart").addEventListener("click",toggleTimer);
  $("timerReset").addEventListener("click",()=>{stopTimer();setTimerMinutes();$("timerStatus").textContent="タイマーをリセットしました。";});
  $("timerMinutes").addEventListener("change",setTimerMinutes);
  $("todayLabel").textContent=new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date()).toUpperCase();
  // Starter templates are added only on first use, so existing user templates are preserved.
  if(templates.length===0){templates=[{id:Date.now()+1,name:"レポート課題",taskName:"レポートを作成して提出する",subject:"レポート",requiredHours:3},{id:Date.now()+2,name:"プログラミング課題",taskName:"プログラムを作成・動作確認する",subject:"プログラミング",requiredHours:2},{id:Date.now()+3,name:"試験勉強",taskName:"試験範囲を復習する",subject:"試験勉強",requiredHours:2}];saveTemplates();}
  renderAll();renderTemplates();renderTaskTemplateOptions();updateTimerDisplay();
})();
