(() => {
  "use strict";

  const KEYS = {
    sessions: "planner-adaptativo-tjdft:sessions:v2",
    notes: "planner-adaptativo-tjdft:notes:v1",
    cargo: "planner-adaptativo-tjdft:cargo:v1"
  };

  const VIEW_TITLES = {
    overview: "Visão Geral",
    register: "Registro de Estudo",
    timer: "Timer",
    charts: "Gráficos",
    schedule: "Cronograma",
    progress: "Progresso",
    simulator: "Simulador",
    notes: "Anotações",
    subjects: "Disciplinas"
  };

  const state = {
    seed: null,
    cargo: localStorage.getItem(KEYS.cargo) || "tecnico",
    sessions: read(KEYS.sessions, []),
    notes: read(KEYS.notes, []),
    timer: {
      mode: "stopwatch",
      running: false,
      seconds: 0,
      target: 0,
      interval: null
    },
    simText: ""
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function read(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function todayIso() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function parseDay(value) {
    if (!value) return null;
    const raw = String(value).slice(0, 10);
    const d = new Date(raw + "T12:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function addDays(value, n) {
    const d = parseDay(value);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function dayDiff(a, b) {
    const da = parseDay(a);
    const db = parseDay(b);
    if (!da || !db) return null;
    return Math.round((db - da) / 86400000);
  }

  function fmtDate(value) {
    if (!value) return "—";
    const raw = String(value).slice(0, 10).split("-");
    return raw.length === 3 ? raw[2] + "/" + raw[1] + "/" + raw[0] : String(value);
  }

  function percent(value, digits) {
    if (!Number.isFinite(value)) return "—";
    return (value * 100).toFixed(digits == null ? 0 : digits) + "%";
  }

  function hours(minutes) {
    const value = Number(minutes || 0) / 60;
    return value < 10 ? value.toFixed(1) + "h" : Math.round(value) + "h";
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(el._hide);
    el._hide = window.setTimeout(() => el.classList.remove("show"), 2400);
  }

  function unitSubject(code) {
    if (/^P\d+/.test(code || "")) return "Língua Portuguesa";
    if (/^RL\d+/.test(code || "")) return "Raciocínio Lógico-Matemático";
    if (/^REV\d+/.test(code || "")) return "Revisão integrada";
    return "Núcleo comum";
  }

  function selectedCargo() {
    return state.seed.cargos[state.cargo];
  }

  function importedSessions() {
    return (state.seed.importedSessions || []).map((s) => ({
      id: s.id,
      origin: "importado",
      category: "Questões",
      code: s.code,
      subject: unitSubject(s.code),
      date: s.date,
      minutes: Number(s.minutes || 0),
      questions: Number(s.questions || 0),
      correct: Number(s.correct || 0),
      errors: Number(s.errors || 0),
      notes: ""
    }));
  }

  function allSessions() {
    return importedSessions().concat(state.sessions);
  }

  function unitSessions(code) {
    return allSessions().filter((s) => s.code === code);
  }

  function unitStats(code) {
    return unitSessions(code).reduce((acc, s) => {
      acc.sessions += 1;
      acc.minutes += Number(s.minutes || 0);
      acc.questions += Number(s.questions || 0);
      acc.correct += Number(s.correct || 0);
      acc.errors += Number(s.errors != null ? s.errors : Math.max(0, Number(s.questions || 0) - Number(s.correct || 0)));
      return acc;
    }, { sessions: 0, minutes: 0, questions: 0, correct: 0, errors: 0 });
  }

  function globalStats(sessions) {
    return (sessions || allSessions()).reduce((acc, s) => {
      acc.sessions += 1;
      acc.minutes += Number(s.minutes || 0);
      acc.questions += Number(s.questions || 0);
      acc.correct += Number(s.correct || 0);
      acc.errors += Number(s.errors != null ? s.errors : Math.max(0, Number(s.questions || 0) - Number(s.correct || 0)));
      return acc;
    }, { sessions: 0, minutes: 0, questions: 0, correct: 0, errors: 0 });
  }

  function lastStudyDate(item) {
    const local = state.sessions
      .filter((s) => s.code === item.code && !String(s.category || "").startsWith("Revisão"))
      .map((s) => String(s.date || "").slice(0, 10))
      .filter(Boolean)
      .sort()
      .pop();
    return local || (item.last_execution ? String(item.last_execution).slice(0, 10) : null);
  }

  function reviewCompleted(item, label) {
    const prop = label.toLowerCase();
    if (item[prop] === true) return true;
    return state.sessions.some((s) => s.code === item.code && String(s.category || "").toLowerCase() === ("revisão " + label).toLowerCase());
  }

  function reviewEvents(item) {
    const base = lastStudyDate(item);
    if (!base) return [];
    return [
      { label: "D0", date: base, done: reviewCompleted(item, "D0") },
      { label: "D7", date: addDays(base, 7), done: reviewCompleted(item, "D7") },
      { label: "D20", date: addDays(base, 20), done: reviewCompleted(item, "D20") }
    ];
  }

  function priorityValue(item) {
    const scale = state.seed.scoringPolicy.editorialPriorityScale || {};
    return Number(scale[item.priority] == null ? 0.55 : scale[item.priority]);
  }

  function reviewUrgency(item) {
    const pending = reviewEvents(item).filter((x) => !x.done);
    if (!pending.length) return item.state === "Não estudado" ? 0.22 : 0.35;
    const today = todayIso();
    const diffs = pending.map((x) => dayDiff(today, x.date)).filter((x) => x != null);
    if (!diffs.length) return 0.35;
    const earliest = Math.min.apply(null, diffs);
    if (earliest <= 0) return 1;
    if (earliest <= 2) return 0.82;
    if (earliest <= 7) return 0.6;
    return 0.32;
  }

  function scoreItem(item) {
    const stats = unitStats(item.code);
    const accuracy = stats.questions ? stats.correct / stats.questions : null;
    const weakness = accuracy == null ? Number(state.seed.scoringPolicy.unknownWeakness || 0.55) : 1 - accuracy;
    const priority = priorityValue(item);
    const review = reviewUrgency(item);
    const weights = state.seed.scoringPolicy.weights || { editorialPriority: 0.45, weakness: 0.35, reviewUrgency: 0.20 };
    const score = Math.round(100 * (
      priority * Number(weights.editorialPriority || 0.45) +
      weakness * Number(weights.weakness || 0.35) +
      review * Number(weights.reviewUrgency || 0.20)
    ));
    return { item, stats, accuracy, weakness, priority, review, score };
  }

  function rankedTrail() {
    return (state.seed.trail.items || []).map(scoreItem).sort((a, b) => b.score - a.score || a.item.order - b.item.order);
  }

  function reason(entry) {
    const parts = [];
    const overdue = reviewEvents(entry.item).some((x) => !x.done && dayDiff(todayIso(), x.date) <= 0);
    if (overdue) parts.push("revisão vencida");
    if (entry.accuracy != null && entry.accuracy < 0.7) parts.push("aproveitamento em " + percent(entry.accuracy));
    if (entry.item.priority === "Muito alta") parts.push("prioridade estratégica muito alta");
    if (entry.stats.questions === 0) parts.push("sem desempenho medido");
    if (entry.item.state === "Em aprendizagem") parts.push("conteúdo em aprendizagem");
    return parts.length ? parts.join(" · ") : "melhor combinação entre prioridade, fragilidade e revisão";
  }

  function metric(label, value, foot, icon) {
    return '<div class="metric"><div class="metric-top"><span class="metric-label">' + esc(label) + '</span><span class="metric-icon">' + esc(icon || "•") + '</span></div><div class="metric-value">' + esc(value) + '</div><div class="metric-foot">' + esc(foot || "") + '</div></div>';
  }

  function openView(name) {
    $$(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + name));
    $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === name));
    $("#viewTitle").textContent = VIEW_TITLES[name] || "Planner";
    if (name === "charts") renderCharts();
    if (name === "progress") renderProgress();
    if (name === "subjects") renderSubjects();
    if (name === "notes") renderNotes();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSource() {
    const sourceDate = state.seed.source.snapshotAsOf || state.seed.source.snapshotSyncedAt;
    $("#sourceStatus").textContent = "Base TJDFT · " + fmtDate(sourceDate);
  }

  function currentWeekSessions() {
    const now = parseDay(todayIso());
    const weekday = (now.getDay() + 6) % 7;
    const start = new Date(now);
    start.setDate(start.getDate() - weekday);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return allSessions().filter((s) => {
      const d = parseDay(s.date);
      return d && d >= start && d <= end;
    });
  }

  function renderOverview() {
    const g = globalStats();
    const accuracy = g.questions ? g.correct / g.questions : null;
    const studied = state.seed.trail.items.filter((i) => lastStudyDate(i) || unitStats(i.code).sessions).length;
    const pendingReviews = getPendingReviews().filter((x) => x.due <= 0).length;

    $("#overviewMetrics").innerHTML =
      metric("Tempo estudado", hours(g.minutes), g.sessions + " sessões registradas", "◷") +
      metric("Questões", g.questions, g.correct + " acertos · " + g.errors + " erros", "✓") +
      metric("Aproveitamento", accuracy == null ? "—" : percent(accuracy, 1), "base importada + registros locais", "%") +
      metric("Progresso da trilha", studied + "/" + state.seed.trail.total, pendingReviews + " revisões vencidas", "◎");

    const best = rankedTrail()[0];
    if (best) {
      $("#focusTitle").textContent = best.item.code + " · " + best.item.title.replace(/^\w+\s+—\s+/, "");
      $("#focusScore").textContent = best.score;
      $("#focusReason").textContent = reason(best);
      $("#focusBreakdown").innerHTML =
        scoreBox("Prioridade", Math.round(best.priority * 100)) +
        scoreBox("Fragilidade", Math.round(best.weakness * 100)) +
        scoreBox("Revisão", Math.round(best.review * 100));
      $("#focusStudyBtn").dataset.code = best.item.code;
    }

    renderWeeklyGoal();
    renderAdaptiveQueue();
    renderReviewList();
    renderHeatmap();
    renderOverviewBars();
  }

  function scoreBox(label, value) {
    return '<div class="score-item"><strong>' + value + '</strong><span>' + esc(label) + '</span></div>';
  }

  function renderWeeklyGoal() {
    const week = currentWeekSessions();
    const count = week.filter((s) => s.origin !== "importado" || s.date).length;
    const goal = 5;
    const value = Math.min(1, count / goal);
    $("#weeklyGoalRing").style.background = "conic-gradient(var(--accent) 0 " + Math.round(value * 100) + "%,#eef0f5 " + Math.round(value * 100) + "% 100%)";
    $("#weeklyGoalRing").querySelector("span").textContent = Math.round(value * 100) + "%";
    $("#weeklyGoalText").textContent = count + " de " + goal + " sessões";
    const stats = globalStats(week);
    $("#weeklyMiniStats").innerHTML =
      '<div class="mini-stat"><strong>' + hours(stats.minutes) + '</strong><span>tempo</span></div>' +
      '<div class="mini-stat"><strong>' + stats.questions + '</strong><span>questões</span></div>';
  }

  function renderAdaptiveQueue() {
    const list = rankedTrail().slice(0, 6);
    $("#adaptiveQueue").innerHTML = list.map((entry) => {
      let tone = "amber";
      let label = "sem medida";
      if (entry.accuracy != null) {
        label = percent(entry.accuracy);
        tone = entry.accuracy < 0.7 ? "red" : "green";
      }
      if (reviewEvents(entry.item).some((x) => !x.done && dayDiff(todayIso(), x.date) <= 0)) {
        label = "revisar";
        tone = "red";
      }
      return '<div class="queue-item">' +
        '<div class="queue-score">' + entry.score + '</div>' +
        '<div><strong>' + esc(entry.item.code + " · " + entry.item.title.replace(/^\w+\s+—\s+/, "")) + '</strong><small>' + esc(reason(entry)) + '</small></div>' +
        '<span class="status-pill ' + tone + '">' + esc(label) + '</span>' +
        '</div>';
    }).join("");
  }

  function getPendingReviews() {
    const rows = [];
    state.seed.trail.items.forEach((item) => {
      reviewEvents(item).forEach((evt) => {
        if (evt.done) return;
        const due = dayDiff(todayIso(), evt.date);
        if (due == null) return;
        rows.push({ item, label: evt.label, date: evt.date, due });
      });
    });
    return rows.sort((a, b) => a.due - b.due || a.item.order - b.item.order);
  }

  function renderReviewList() {
    const rows = getPendingReviews().slice(0, 7);
    const overdue = rows.filter((x) => x.due <= 0).length;
    $("#reviewCountPill").textContent = overdue + " vencidas";
    $("#reviewList").innerHTML = rows.length ? rows.map((row) => {
      const status = row.due < 0 ? Math.abs(row.due) + "d atrasada" : row.due === 0 ? "hoje" : "em " + row.due + "d";
      const tone = row.due <= 0 ? "red" : row.due <= 2 ? "amber" : "blue";
      return '<div class="review-item"><div><strong>' + esc(row.item.code + " · " + row.label) + '</strong><small>' + esc(row.item.title.replace(/^\w+\s+—\s+/, "")) + ' · ' + fmtDate(row.date) + '</small></div><span class="status-pill ' + tone + '">' + status + '</span></div>';
    }).join("") : '<div class="empty">Nenhuma revisão calculável ainda.</div>';
  }

  function renderHeatmap() {
    let critical = 0, strong = 0, medium = 0, unknown = 0;
    state.seed.trail.items.forEach((item) => {
      const entry = scoreItem(item);
      if (!entry.stats.questions) return unknown++;
      if (entry.priority >= 0.8 && entry.accuracy < 0.75) critical++;
      else if (entry.priority >= 0.8 && entry.accuracy >= 0.75) strong++;
      else medium++;
    });
    $("#heatmap").innerHTML =
      heat("heat-critical", "Atacar", "prioridade alta + desempenho baixo", critical) +
      heat("heat-strong", "Manter", "prioridade alta + desempenho bom", strong) +
      heat("heat-medium", "Secundário", "prioridade média/baixa medida", medium) +
      heat("heat-unknown", "Sem medida", "ainda sem evidência suficiente", unknown);
  }

  function heat(cls, title, text, count) {
    return '<div class="heat-cell ' + cls + '"><strong>' + esc(title) + '</strong><span>' + esc(text) + '</span><b>' + count + '</b></div>';
  }

  function subjectStats() {
    const map = new Map();
    allSessions().forEach((s) => {
      const subject = s.subject || unitSubject(s.code);
      if (!map.has(subject)) map.set(subject, { subject, questions: 0, correct: 0, errors: 0, minutes: 0, sessions: 0 });
      const x = map.get(subject);
      x.questions += Number(s.questions || 0);
      x.correct += Number(s.correct || 0);
      x.errors += Number(s.errors || 0);
      x.minutes += Number(s.minutes || 0);
      x.sessions += 1;
    });
    return Array.from(map.values());
  }

  function renderOverviewBars() {
    const rows = subjectStats().filter((x) => x.questions > 0).sort((a, b) => b.questions - a.questions).slice(0, 6);
    $("#overviewSubjectBars").innerHTML = rows.length ? rows.map((x) => bar(x.subject, x.correct / x.questions, percent(x.correct / x.questions))) .join("") : '<div class="empty">Sem desempenho por disciplina ainda.</div>';
  }

  function bar(label, value, display) {
    const safe = Math.max(0, Math.min(1, Number(value || 0)));
    return '<div class="bar-row"><span class="bar-label" title="' + esc(label) + '">' + esc(label) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + Math.round(safe * 100) + '%"></div></div><span class="bar-value">' + esc(display) + '</span></div>';
  }

  function populateSelectors() {
    const units = state.seed.trail.items || [];
    const unitOptions = units.map((i) => '<option value="' + esc(i.code) + '">' + esc(i.code + " — " + i.title.replace(/^\w+\s+—\s+/, "")) + '</option>').join("");
    ["#studyUnit", "#timerUnit"].forEach((id) => $(id).innerHTML = unitOptions);

    const subjects = Array.from(new Set(
      selectedCargo().disciplines.map((d) => d.name).concat(["Língua Portuguesa", "Raciocínio Lógico-Matemático", "Revisão integrada"])
    )).sort();
    const subjectOptions = subjects.map((x) => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join("");
    ["#studySubject", "#timerSubject", "#noteSubject"].forEach((id) => $(id).innerHTML = subjectOptions);

    syncUnitSubject("#studyUnit", "#studySubject");
    syncUnitSubject("#timerUnit", "#timerSubject");
  }

  function syncUnitSubject(unitSelector, subjectSelector) {
    const unit = $(unitSelector);
    const subject = $(subjectSelector);
    if (!unit || !subject) return;
    const inferred = unitSubject(unit.value);
    if (Array.from(subject.options).some((o) => o.value === inferred)) subject.value = inferred;
  }

  function renderHistory() {
    const rows = state.sessions.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $("#studyHistory").innerHTML = rows.length ? rows.map((s) => {
      const acc = s.questions ? percent(s.correct / s.questions) : "sem questões";
      return '<div class="history-item"><strong>' + esc((s.category || "Estudo") + " · " + s.code + " · " + fmtDate(s.date)) + '</strong><small>' + esc((s.subject || unitSubject(s.code)) + " · " + (s.minutes || 0) + " min · " + (s.questions || 0) + " questões · " + acc) + '</small><div class="item-actions"><small>' + esc(s.notes || s.material || "Sem observação.") + '</small><button class="text-button delete-session" data-id="' + esc(s.id) + '">Excluir</button></div></div>';
    }).join("") : '<div class="empty">Nenhuma sessão local registrada.</div>';

    $$(".delete-session").forEach((btn) => btn.addEventListener("click", () => {
      state.sessions = state.sessions.filter((x) => x.id !== btn.dataset.id);
      write(KEYS.sessions, state.sessions);
      renderEverything();
      toast("Sessão excluída.");
    }));
  }

  function saveStudyForm(event) {
    event.preventDefault();
    const questions = Number($("#studyQuestions").value || 0);
    const correct = Number($("#studyCorrect").value || 0);
    if (correct > questions) return toast("Acertos não podem superar questões.");
    const item = {
      id: "local-" + Date.now(),
      origin: "local",
      category: $("#studyCategory").value,
      code: $("#studyUnit").value,
      subject: $("#studySubject").value,
      date: $("#studyDate").value,
      minutes: Number($("#studyMinutes").value || 0),
      questions,
      correct,
      errors: Math.max(0, questions - correct),
      material: $("#studyMaterial").value.trim(),
      notes: $("#studyNotes").value.trim()
    };
    state.sessions.push(item);
    write(KEYS.sessions, state.sessions);
    $("#studyNotes").value = "";
    renderEverything();
    toast("Sessão salva. O motor foi recalculado.");
    openView("overview");
  }

  function filteredSessions(days) {
    if (days === "all") return allSessions();
    const n = Number(days);
    const today = parseDay(todayIso());
    return allSessions().filter((s) => {
      const d = parseDay(s.date);
      if (!d) return false;
      const diff = Math.floor((today - d) / 86400000);
      return diff >= 0 && diff < n;
    });
  }

  function renderCharts() {
    const period = $("#chartPeriod").value;
    const sessions = filteredSessions(period);
    const g = globalStats(sessions);
    const accuracy = g.questions ? g.correct / g.questions : null;
    $("#chartMetrics").innerHTML =
      metric("Sessões", g.sessions, period === "all" ? "todo período" : "últimos " + period + " dias", "▣") +
      metric("Tempo", hours(g.minutes), "tempo registrado", "◷") +
      metric("Questões", g.questions, g.errors + " erros", "✓") +
      metric("Aproveitamento", accuracy == null ? "—" : percent(accuracy, 1), "no período", "%");

    renderDailyQuestions(sessions);
    renderAccuracyBars(sessions);
    renderWeeklyTime(sessions);
    renderErrorBars();
  }

  function renderDailyQuestions(sessions) {
    const map = new Map();
    sessions.forEach((s) => {
      if (!s.date) return;
      const key = String(s.date).slice(0, 10);
      map.set(key, (map.get(key) || 0) + Number(s.questions || 0));
    });
    const rows = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
    renderColumns("#questionsChart", rows, (x) => x, " q.");
  }

  function renderWeeklyTime(sessions) {
    const map = new Map();
    sessions.forEach((s) => {
      const d = parseDay(s.date);
      if (!d) return;
      const weekday = (d.getDay() + 6) % 7;
      const start = new Date(d);
      start.setDate(start.getDate() - weekday);
      const key = start.toISOString().slice(0, 10);
      map.set(key, (map.get(key) || 0) + Number(s.minutes || 0));
    });
    const rows = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map((x) => [x[0], x[1] / 60]);
    renderColumns("#timeChart", rows, (x) => x.toFixed(1), "h");
  }

  function renderColumns(selector, rows, formatter, suffix) {
    const el = $(selector);
    if (!rows.length) {
      el.innerHTML = '<div class="empty" style="width:100%">Sem dados suficientes no período.</div>';
      return;
    }
    const max = Math.max.apply(null, rows.map((x) => Number(x[1]) || 0).concat([1]));
    el.innerHTML = rows.map((x) => {
      const h = Math.max(2, Math.round((Number(x[1]) || 0) / max * 165));
      const label = String(x[0]).slice(5).split("-").reverse().join("/");
      return '<div class="chart-col"><em>' + esc(formatter(Number(x[1]) || 0) + (suffix || "")) + '</em><div class="chart-bar" style="height:' + h + 'px"></div><small>' + esc(label) + '</small></div>';
    }).join("");
  }

  function renderAccuracyBars(sessions) {
    const map = new Map();
    sessions.forEach((s) => {
      const subject = s.subject || unitSubject(s.code);
      if (!map.has(subject)) map.set(subject, { q: 0, c: 0 });
      map.get(subject).q += Number(s.questions || 0);
      map.get(subject).c += Number(s.correct || 0);
    });
    const rows = Array.from(map.entries()).filter((x) => x[1].q > 0).sort((a, b) => b[1].q - a[1].q);
    $("#accuracyChart").innerHTML = rows.length ? rows.map((x) => bar(x[0], x[1].c / x[1].q, percent(x[1].c / x[1].q))).join("") : '<div class="empty">Sem questões no período.</div>';
  }

  function renderErrorBars() {
    const errors = state.seed.baseline.errors.top || [];
    const counts = new Map();
    errors.forEach((e) => counts.set(e.topic, (counts.get(e.topic) || 0) + 1));
    const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = Math.max.apply(null, rows.map((x) => x[1]).concat([1]));
    $("#errorChart").innerHTML = rows.length ? rows.map((x) => bar(x[0], x[1] / max, x[1] + " erro" + (x[1] === 1 ? "" : "s"))).join("") : '<div class="empty">Sem caderno de erros importado.</div>';
  }

  function generateSchedule() {
    const start = $("#scheduleStart").value || todayIso();
    const days = Math.max(1, Math.min(7, Number($("#scheduleDays").value || 5)));
    const blocks = Math.max(1, Math.min(6, Number($("#scheduleBlocks").value || 2)));
    const minutes = Math.max(20, Math.min(180, Number($("#scheduleMinutes").value || 60)));
    const ranked = rankedTrail();
    const pending = getPendingReviews().filter((x) => x.due <= 2);
    const plan = [];
    let index = 0;
    let reviewIndex = 0;

    for (let d = 0; d < days; d++) {
      const date = addDays(start, d);
      const dayBlocks = [];
      for (let b = 0; b < blocks; b++) {
        if (reviewIndex < pending.length) {
          const r = pending[reviewIndex++];
          dayBlocks.push({ type: "Revisão " + r.label, code: r.item.code, title: r.item.title, minutes });
        } else {
          const entry = ranked[index % ranked.length];
          index++;
          dayBlocks.push({ type: "Estudo", code: entry.item.code, title: entry.item.title, minutes, score: entry.score });
        }
      }
      plan.push({ date, blocks: dayBlocks });
    }

    $("#scheduleOutput").classList.remove("empty");
    $("#scheduleOutput").innerHTML = plan.map((day) =>
      '<div class="schedule-item"><div class="day-title"><strong>' + fmtDate(day.date) + '</strong><span class="soft-pill">' + day.blocks.length + ' blocos</span></div>' +
      day.blocks.map((b) => '<div class="schedule-block"><div><strong>' + esc(b.code + " · " + b.type) + '</strong><span>' + esc(b.title.replace(/^\w+\s+—\s+/, "")) + '</span></div><span>' + b.minutes + ' min' + (b.score ? ' · score ' + b.score : '') + '</span></div>').join("") +
      '</div>'
    ).join("");
  }

  function renderProgress() {
    const items = state.seed.trail.items;
    const studied = items.filter((i) => lastStudyDate(i) || unitStats(i.code).sessions).length;
    const q = globalStats().questions;
    const d0done = items.filter((i) => reviewCompleted(i, "D0")).length;
    const d7done = items.filter((i) => reviewCompleted(i, "D7")).length;
    const d20done = items.filter((i) => reviewCompleted(i, "D20")).length;

    $("#progressMetrics").innerHTML =
      metric("Trilha", studied + "/" + items.length, percent(studied / items.length) + " com evidência", "◎") +
      metric("D0 concluído", d0done, "revisões imediatas", "0") +
      metric("D7 concluído", d7done, "revisões de 7 dias", "7") +
      metric("Questões", q, "acumulado registrado", "✓");

    const groups = [
      ["Português", items.filter((i) => /^P\d+/.test(i.code))],
      ["RLM", items.filter((i) => /^RL\d+/.test(i.code))],
      ["Revisões integradas", items.filter((i) => /^REV\d+/.test(i.code))]
    ];
    $("#trackProgress").innerHTML = groups.map((g) => {
      const done = g[1].filter((i) => lastStudyDate(i) || unitStats(i.code).sessions).length;
      return progressGroup(g[0], done, g[1].length);
    }).join("");

    $("#revisionProgress").innerHTML =
      progressGroup("D0", d0done, items.filter((i) => lastStudyDate(i)).length || items.length) +
      progressGroup("D7", d7done, items.filter((i) => lastStudyDate(i)).length || items.length) +
      progressGroup("D20", d20done, items.filter((i) => lastStudyDate(i)).length || items.length);

    renderProgressTable();
  }

  function progressGroup(label, done, total) {
    const ratio = total ? Math.min(1, done / total) : 0;
    return '<div class="progress-group"><div class="progress-head"><strong>' + esc(label) + '</strong><span>' + done + '/' + total + ' · ' + Math.round(ratio * 100) + '%</span></div><div class="progress-track"><span style="width:' + Math.round(ratio * 100) + '%"></span></div></div>';
  }

  function renderProgressTable() {
    const filter = $("#progressFilter").value;
    let rows = state.seed.trail.items.map(scoreItem);
    if (filter === "critical") rows = rows.filter((x) => x.score >= 75);
    if (filter === "studied") rows = rows.filter((x) => x.stats.sessions || lastStudyDate(x.item));
    if (filter === "pending") rows = rows.filter((x) => !x.stats.sessions && !lastStudyDate(x.item));

    $("#progressTable").innerHTML = rows.map((x) => {
      const acc = x.accuracy == null ? "—" : percent(x.accuracy);
      const status = lastStudyDate(x.item) ? "Com evidência" : "Não estudado";
      return '<div class="data-row"><strong>' + esc(x.item.code) + '</strong><div><strong>' + esc(x.item.title.replace(/^\w+\s+—\s+/, "")) + '</strong><small style="display:block;color:var(--muted);margin-top:2px">' + esc(x.item.priority) + '</small></div><span class="hide-mobile">' + esc(status) + '</span><span class="hide-mobile">' + esc(acc) + '</span><strong>' + x.score + '</strong></div>';
    }).join("");
  }

  function disciplineWeakness(discipline) {
    const stats = subjectStats().find((x) => String(discipline.name).toLowerCase().includes(String(x.subject).toLowerCase()) || String(x.subject).toLowerCase().includes(String(discipline.name).toLowerCase()));
    if (stats && stats.questions) return 1 - stats.correct / stats.questions;
    if (String(discipline.canonicalSubject || "").includes("Língua Portuguesa")) {
      const p = subjectStats().find((x) => x.subject === "Língua Portuguesa");
      if (p && p.questions) return 1 - p.correct / p.questions;
    }
    return Number(state.seed.scoringPolicy.unknownWeakness || 0.55);
  }

  function allocate(total, rows) {
    const sum = rows.reduce((a, x) => a + x.weight, 0) || 1;
    const out = rows.map((x) => {
      const raw = total * x.weight / sum;
      return Object.assign({}, x, { raw, count: Math.floor(raw), frac: raw - Math.floor(raw) });
    });
    let used = out.reduce((a, x) => a + x.count, 0);
    out.sort((a, b) => b.frac - a.frac);
    let i = 0;
    while (used < total && out.length) {
      out[i % out.length].count += 1;
      used++;
      i++;
    }
    return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function generateSimulator() {
    const total = Math.max(10, Math.min(120, Number($("#simQuestions").value || 40)));
    const mode = $("#simMode").value;
    const cargo = selectedCargo();
    const weighted = cargo.disciplines.map((d) => {
      const coverage = Math.max(1, (d.items || []).length);
      const weakness = disciplineWeakness(d);
      return { name: d.name, weakness, weight: mode === "attack" ? coverage * (1 + weakness * 0.95) : coverage };
    });
    const rows = allocate(total, weighted).filter((x) => x.count > 0);
    $("#simTitle").textContent = total + " questões · " + (mode === "attack" ? "Ataque adaptativo" : "Cobertura");
    $("#simOutput").classList.remove("empty");
    $("#simOutput").innerHTML = rows.map((x) => '<div class="sim-row"><strong>' + esc(x.name) + '</strong><span>' + x.count + ' q.</span></div>').join("");
    state.simText = "TJDFT — " + cargo.label + "\n" +
      "Blueprint: " + total + " questões · " + (mode === "attack" ? "Ataque adaptativo" : "Cobertura") + "\n\n" +
      rows.map((x) => x.name + ": " + x.count + " questões").join("\n") +
      "\n\nDistribuição experimental por cobertura e desempenho; não representa incidência histórica oficial.";
    $("#copySim").disabled = false;
  }

  function renderNotes() {
    const query = ($("#noteSearch").value || "").trim().toLowerCase();
    const rows = state.notes.filter((n) => !query || [n.subject, n.title, n.body].join(" ").toLowerCase().includes(query)).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    $("#notesList").innerHTML = rows.length ? rows.map((n) =>
      '<div class="note-item"><strong>' + esc(n.title || "Sem título") + '</strong><small>' + esc(n.subject) + ' · ' + fmtDate(n.createdAt) + '</small><p class="subtle" style="white-space:pre-wrap;margin-bottom:4px">' + esc(n.body) + '</p><div class="item-actions"><span></span><button class="text-button delete-note" data-id="' + esc(n.id) + '">Excluir</button></div></div>'
    ).join("") : '<div class="empty">Nenhuma anotação encontrada.</div>';

    $$(".delete-note").forEach((btn) => btn.addEventListener("click", () => {
      state.notes = state.notes.filter((n) => n.id !== btn.dataset.id);
      write(KEYS.notes, state.notes);
      renderNotes();
      toast("Anotação excluída.");
    }));
  }

  function saveNote() {
    const title = $("#noteTitle").value.trim();
    const body = $("#noteBody").value.trim();
    if (!title && !body) return toast("Escreva um título ou conteúdo.");
    state.notes.push({
      id: "note-" + Date.now(),
      subject: $("#noteSubject").value,
      title,
      body,
      createdAt: todayIso()
    });
    write(KEYS.notes, state.notes);
    $("#noteTitle").value = "";
    $("#noteBody").value = "";
    renderNotes();
    toast("Anotação salva.");
  }

  function renderSubjects() {
    const cargo = selectedCargo();
    const query = ($("#subjectSearch").value || "").trim().toLowerCase();
    const all = cargo.disciplines || [];
    const count = all.reduce((sum, d) => sum + (d.items || []).length, 0);
    $("#subjectSummary").innerHTML =
      '<span class="soft-pill">' + all.length + ' disciplinas/eixos</span>' +
      '<span class="soft-pill">' + count + ' tópicos/subtópicos</span>' +
      '<span class="soft-pill">' + esc(cargo.label) + '</span>';

    const filtered = all.filter((d) => {
      if (!query) return true;
      return [d.name, d.canonicalSubject].concat((d.items || []).flatMap((x) => [x.topic, x.subtopic])).join(" ").toLowerCase().includes(query);
    });

    $("#subjectGrid").innerHTML = filtered.map((d) =>
      '<article class="subject-card"><div class="subject-head" tabindex="0"><div><h3>' + esc(d.name) + '</h3><p>' + esc(d.group || "") + ' · ' + (d.items || []).length + ' recortes</p></div><span class="soft-pill">abrir</span></div><div class="subject-body">' +
      (d.items || []).map((x) => '<div class="topic"><strong>' + esc(x.topic) + '</strong><span>' + esc(x.subtopic) + '</span></div>').join("") +
      '</div></article>'
    ).join("") || '<div class="empty">Nenhum resultado.</div>';

    $$(".subject-head").forEach((head) => {
      const toggle = () => head.closest(".subject-card").classList.toggle("open");
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") toggle();
      });
    });
  }

  function formatTimer(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return hh + ":" + mm + ":" + ss;
  }

  function configureTimerMode(mode) {
    state.timer.mode = mode;
    state.timer.running = false;
    if (state.timer.interval) clearInterval(state.timer.interval);
    state.timer.interval = null;
    if (mode === "stopwatch") {
      state.timer.seconds = 0;
      state.timer.target = 0;
    } else if (mode === "pomodoro") {
      state.timer.target = 25 * 60;
      state.timer.seconds = state.timer.target;
    } else {
      state.timer.target = Math.max(1, Number($("#countdownMinutes").value || 60)) * 60;
      state.timer.seconds = state.timer.target;
    }
    $$(".timer-mode").forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    renderTimer();
  }

  function renderTimer() {
    $("#timerDisplay").textContent = formatTimer(state.timer.seconds);
    let pct = 0;
    if (state.timer.mode !== "stopwatch" && state.timer.target) {
      pct = Math.round((1 - state.timer.seconds / state.timer.target) * 100);
    }
    $("#timerProgress").style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  function startTimer() {
    if (state.timer.running) return;
    if (state.timer.mode === "countdown" && state.timer.seconds <= 0) configureTimerMode("countdown");
    state.timer.running = true;
    state.timer.interval = setInterval(() => {
      if (state.timer.mode === "stopwatch") {
        state.timer.seconds += 1;
      } else {
        state.timer.seconds -= 1;
        if (state.timer.seconds <= 0) {
          state.timer.seconds = 0;
          pauseTimer();
          toast("Bloco concluído.");
        }
      }
      renderTimer();
    }, 1000);
  }

  function pauseTimer() {
    state.timer.running = false;
    if (state.timer.interval) clearInterval(state.timer.interval);
    state.timer.interval = null;
  }

  function resetTimer() {
    pauseTimer();
    configureTimerMode(state.timer.mode);
  }

  function timerElapsedMinutes() {
    if (state.timer.mode === "stopwatch") return Math.round(state.timer.seconds / 60);
    return Math.round((state.timer.target - state.timer.seconds) / 60);
  }

  function saveTimerSession() {
    const minutes = timerElapsedMinutes();
    if (minutes <= 0) return toast("Ainda não há tempo suficiente para salvar.");
    const code = $("#timerUnit").value;
    state.sessions.push({
      id: "timer-" + Date.now(),
      origin: "local",
      category: "Estudo",
      code,
      subject: $("#timerSubject").value || unitSubject(code),
      date: todayIso(),
      minutes,
      questions: 0,
      correct: 0,
      errors: 0,
      material: "Timer",
      notes: "Sessão registrada pelo timer."
    });
    write(KEYS.sessions, state.sessions);
    resetTimer();
    renderEverything();
    toast("Tempo salvo como sessão de estudo.");
  }

  function renderEverything() {
    renderSource();
    populateSelectors();
    renderOverview();
    renderHistory();
    renderProgress();
    renderNotes();
    renderSubjects();
    renderCharts();
  }

  function bind() {
    $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => openView(btn.dataset.view)));
    $$("[data-open]").forEach((btn) => btn.addEventListener("click", () => openView(btn.dataset.open)));

    $("#cargoSelect").value = state.cargo;
    $("#cargoSelect").addEventListener("change", (e) => {
      state.cargo = e.target.value;
      localStorage.setItem(KEYS.cargo, state.cargo);
      populateSelectors();
      renderSubjects();
      renderOverview();
      renderProgress();
      toast("Cargo alterado para " + (state.cargo === "tecnico" ? "Técnico" : "Analista") + ".");
    });

    $("#heroRegisterBtn").addEventListener("click", () => openView("register"));
    $("#focusStudyBtn").addEventListener("click", (e) => {
      $("#studyUnit").value = e.currentTarget.dataset.code || state.seed.trail.items[0].code;
      syncUnitSubject("#studyUnit", "#studySubject");
      openView("register");
    });

    $("#studyUnit").addEventListener("change", () => syncUnitSubject("#studyUnit", "#studySubject"));
    $("#timerUnit").addEventListener("change", () => syncUnitSubject("#timerUnit", "#timerSubject"));
    $("#studyForm").addEventListener("submit", saveStudyForm);

    $$(".timer-mode").forEach((btn) => btn.addEventListener("click", () => configureTimerMode(btn.dataset.mode)));
    $("#timerStart").addEventListener("click", startTimer);
    $("#timerPause").addEventListener("click", pauseTimer);
    $("#timerReset").addEventListener("click", resetTimer);
    $("#timerSave").addEventListener("click", saveTimerSession);
    $("#countdownMinutes").addEventListener("change", () => {
      if (state.timer.mode === "countdown" && !state.timer.running) configureTimerMode("countdown");
    });

    $("#chartPeriod").addEventListener("change", renderCharts);
    $("#generateSchedule").addEventListener("click", generateSchedule);
    $("#progressFilter").addEventListener("change", renderProgressTable);
    $("#generateSim").addEventListener("click", generateSimulator);
    $("#copySim").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.simText);
        toast("Blueprint copiado.");
      } catch (_) {
        toast("Não foi possível copiar automaticamente.");
      }
    });

    $("#saveNote").addEventListener("click", saveNote);
    $("#noteSearch").addEventListener("input", renderNotes);
    $("#subjectSearch").addEventListener("input", renderSubjects);

    $("#exportBtn").addEventListener("click", () => {
      const payload = {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        cargo: state.cargo,
        sessions: state.sessions,
        notes: state.notes
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "planner-tjdft-" + todayIso() + ".json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function init() {
    try {
      const response = await fetch("./data/seed.json", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      state.seed = await response.json();
      $("#studyDate").value = todayIso();
      $("#scheduleStart").value = todayIso();
      bind();
      configureTimerMode("stopwatch");
      renderEverything();
    } catch (error) {
      console.error(error);
      $("#viewTitle").textContent = "Falha ao carregar";
      $("#view-overview").innerHTML = '<div class="notice">Não foi possível carregar a base do TJDFT. Verifique data/seed.json e o deploy.</div>';
    }
  }

  init();
})();