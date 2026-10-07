(() => {
  "use strict";

  const STORAGE_KEY = "planner-adaptativo-tjdft:sessions:v1";
  const CARGO_KEY = "planner-adaptativo-tjdft:cargo";
  const titles = {
    hoje: "O que estudar agora?",
    mapa: "Mapa adaptativo do edital",
    trilha: "Trilha de estudo",
    simulador: "Simulador de blueprint",
    registro: "Registrar evidência"
  };

  const state = {
    seed: null,
    cargo: localStorage.getItem(CARGO_KEY) || "tecnico",
    localSessions: readJson(STORAGE_KEY, []),
    simulatorText: ""
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function fmtDate(value) {
    if (!value) return "—";
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split("-");
    return y && m && d ? `${d}/${m}/${y}` : value;
  }

  function todayIso() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function pct(value, digits = 0) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function switchView(view) {
    $$(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
    $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
    $("#pageTitle").textContent = titles[view] || titles.hoje;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function allSessions() {
    return [...(state.seed?.importedSessions || []), ...state.localSessions];
  }

  function statsForCode(code) {
    const sessions = allSessions().filter((s) => s.code === code);
    return sessions.reduce(
      (acc, s) => {
        acc.questions += Number(s.questions || 0);
        acc.correct += Number(s.correct || 0);
        acc.errors += Number(s.errors ?? Math.max(0, Number(s.questions || 0) - Number(s.correct || 0)));
        acc.minutes += Number(s.minutes || 0);
        acc.sessions += 1;
        return acc;
      },
      { questions: 0, correct: 0, errors: 0, minutes: 0, sessions: 0 }
    );
  }

  function globalStats() {
    return allSessions().reduce(
      (acc, s) => {
        acc.questions += Number(s.questions || 0);
        acc.correct += Number(s.correct || 0);
        acc.errors += Number(s.errors ?? Math.max(0, Number(s.questions || 0) - Number(s.correct || 0)));
        acc.minutes += Number(s.minutes || 0);
        acc.sessions += 1;
        return acc;
      },
      { questions: 0, correct: 0, errors: 0, minutes: 0, sessions: 0 }
    );
  }

  function priorityValue(item) {
    const scale = state.seed.scoringPolicy.editorialPriorityScale;
    return scale[item.priority] ?? 0.55;
  }

  function reviewUrgency(item) {
    const today = new Date(`${todayIso()}T12:00:00`);
    if (item.next_review) {
      const due = new Date(item.next_review);
      const diff = Math.ceil((due - today) / 86400000);
      if (diff <= 0) return 1;
      if (diff <= 2) return 0.82;
      if (diff <= 7) return 0.58;
      return 0.28;
    }
    if (item.last_execution && !item.d0) return 0.78;
    if (item.state !== "Não estudado") return 0.58;
    return 0.26;
  }

  function itemScore(item) {
    const stats = statsForCode(item.code);
    const accuracy = stats.questions ? stats.correct / stats.questions : null;
    const weakness = accuracy === null ? state.seed.scoringPolicy.unknownWeakness : 1 - accuracy;
    const priority = priorityValue(item);
    const review = reviewUrgency(item);
    const w = state.seed.scoringPolicy.weights;
    const score = Math.round((priority * w.editorialPriority + weakness * w.weakness + review * w.reviewUrgency) * 100);
    return { item, stats, accuracy, weakness, priority, review, score };
  }

  function rankedTrail() {
    return state.seed.trail.items
      .map(itemScore)
      .sort((a, b) => b.score - a.score || a.item.order - b.item.order);
  }

  function recommendationReasons(entry) {
    const parts = [];
    if (entry.item.next_review && reviewUrgency(entry.item) >= 1) parts.push("revisão vencida");
    if (entry.accuracy !== null && entry.accuracy < 0.7) parts.push(`aproveitamento em ${pct(entry.accuracy)}`);
    if (entry.item.priority === "Muito alta") parts.push("prioridade editorial muito alta");
    if (entry.stats.questions === 0) parts.push("ainda sem desempenho medido");
    if (entry.item.state === "Em aprendizagem") parts.push("conteúdo em aprendizagem");
    return parts.length ? parts.join(" · ") : "melhor combinação de prioridade, fragilidade e revisão no momento";
  }

  function renderMetrics() {
    const g = globalStats();
    const accuracy = g.questions ? g.correct / g.questions : null;
    const overdue = state.seed.trail.items.filter((i) => i.next_review && reviewUrgency(i) >= 1).length;
    const studied = state.seed.trail.items.filter((i) => i.last_execution || statsForCode(i.code).sessions).length;
    const metrics = [
      ["Questões", g.questions, `${g.correct} acertos · ${g.errors} erros`],
      ["Aproveitamento", accuracy === null ? "—" : pct(accuracy, 1), accuracy !== null && accuracy < .7 ? "atenção: abaixo de 70%" : "base + sessões locais"],
      ["Trilha com evidência", `${studied}/${state.seed.trail.total}`, `${pct(studied / state.seed.trail.total)} da esteira`],
      ["Revisões vencidas", overdue, overdue ? "pedem retorno agora" : "nenhuma vencida"]
    ];
    $("#metricGrid").innerHTML = metrics.map(([label, value, foot]) => `
      <article class="metric-card">
        <div class="metric-label">${escapeHtml(label)}</div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-foot">${escapeHtml(foot)}</div>
      </article>`).join("");
  }

  function renderRecommendation() {
    const best = rankedTrail()[0];
    if (!best) return;
    $("#recommendTitle").textContent = `${best.item.code} · ${best.item.title.replace(/^\w+\s+—\s+/, "")}`;
    $("#recommendScore").textContent = best.score;
    $("#recommendReason").textContent = recommendationReasons(best);
    $("#recommendFactors").innerHTML = [
      ["Prioridade", Math.round(best.priority * 100)],
      ["Fragilidade", Math.round(best.weakness * 100)],
      ["Revisão", Math.round(best.review * 100)]
    ].map(([label, value]) => `<div class="factor"><strong>${value}</strong><span>${label}</span></div>`).join("");
    $("#studyRecommendationBtn").dataset.code = best.item.code;
  }

  function renderQueue() {
    $("#priorityQueue").innerHTML = rankedTrail().slice(0, 6).map((entry, index) => {
      const due = entry.item.next_review && reviewUrgency(entry.item) >= 1;
      const label = due ? "revisão vencida" : entry.accuracy === null ? "sem medida" : pct(entry.accuracy);
      const tone = due || (entry.accuracy !== null && entry.accuracy < .7) ? "bad" : entry.accuracy === null ? "warn" : "good";
      return `
        <div class="priority-item">
          <div class="rank-score">${entry.score}</div>
          <div>
            <strong>${escapeHtml(entry.item.code)} · ${escapeHtml(entry.item.title.replace(/^\w+\s+—\s+/, ""))}</strong>
            <small>#${index + 1} · ${escapeHtml(recommendationReasons(entry))}</small>
          </div>
          <span class="pill ${tone}">${escapeHtml(label)}</span>
        </div>`;
    }).join("");
  }

  function renderErrors() {
    const errors = state.seed.baseline.errors.top || [];
    $("#errorList").innerHTML = errors.slice(0, 6).map((e) => `
      <div class="error-item">
        <strong>${escapeHtml(e.topic)}</strong>
        <small>${escapeHtml(e.action || "Revisar o padrão de erro.")}</small>
        <small class="bad-text">Revisão: ${fmtDate(e.review_at)} · ${escapeHtml(e.state)}</small>
      </div>`).join("") || '<div class="empty-state">Nenhum erro ativo.</div>';
  }

  function renderDomainMatrix() {
    let attack = 0, maintain = 0, secondary = 0, unknown = 0;
    state.seed.trail.items.forEach((item) => {
      const p = priorityValue(item);
      const stats = statsForCode(item.code);
      if (!stats.questions) {
        unknown++;
        return;
      }
      const acc = stats.correct / stats.questions;
      if (p >= .8 && acc < .75) attack++;
      else if (p >= .8 && acc >= .75) maintain++;
      else secondary++;
    });
    const cells = [
      ["q-attack", "Atacar", "Alta prioridade + desempenho baixo", attack],
      ["q-maintain", "Manter", "Alta prioridade + desempenho bom", maintain],
      ["q-secondary", "Secundário", "Baixa/média prioridade medida", secondary],
      ["", "Sem medida", "Ainda sem questões suficientes", unknown]
    ];
    $("#domainMatrix").innerHTML = cells.map(([cls, title, desc, count]) => `
      <div class="quadrant ${cls}">
        <strong>${title}</strong><span>${desc}</span><b>${count}</b>
      </div>`).join("");
  }

  function disciplineProgress(discipline) {
    if (!String(discipline.canonicalSubject).includes("Língua Portuguesa")) return { done: 0, total: 0, value: null };
    const portuguese = state.seed.trail.items.filter((x) => /^P\d+/.test(x.code));
    const done = portuguese.filter((x) => x.last_execution || statsForCode(x.code).sessions).length;
    return { done, total: portuguese.length, value: portuguese.length ? done / portuguese.length : null };
  }

  function renderMap() {
    const cargo = state.seed.cargos[state.cargo];
    const query = ($("#mapSearch").value || "").trim().toLowerCase();
    $("#mapTitle").textContent = `Mapa do ${state.cargo === "tecnico" ? "Técnico" : "Analista"}`;

    let disciplines = cargo.disciplines;
    if (query) {
      disciplines = disciplines.filter((d) => {
        const hay = [
          d.name, d.canonicalSubject,
          ...(d.items || []).flatMap((i) => [i.topic, i.subtopic])
        ].join(" ").toLowerCase();
        return hay.includes(query);
      });
    }

    const topicCount = cargo.disciplines.reduce((sum, d) => sum + (d.items?.length || 0), 0);
    $("#mapSummary").innerHTML = `
      <span class="pill">${cargo.disciplines.length} disciplinas/eixos</span>
      <span class="pill">${topicCount} tópicos/subtópicos</span>
      <span class="pill warn">base histórica 2022 · pré-edital</span>
      <span class="pill">cargo: ${escapeHtml(cargo.label)}</span>`;

    $("#disciplineGrid").innerHTML = disciplines.map((d) => {
      const progress = disciplineProgress(d);
      const progressText = progress.value === null ? "sem execução vinculada" : `${progress.done}/${progress.total} unidades da trilha`;
      return `
        <article class="discipline-card">
          <div class="discipline-head" tabindex="0">
            <div>
              <h3>${escapeHtml(d.name)}</h3>
              <p>${escapeHtml(d.group)} · ${d.items?.length || 0} recortes · ${escapeHtml(progressText)}</p>
            </div>
            <span class="pill">abrir</span>
          </div>
          <div class="discipline-body">
            ${(d.items || []).map((item) => `
              <div class="topic-row">
                <strong>${escapeHtml(item.topic)}</strong>
                <span>${escapeHtml(item.subtopic)}</span>
              </div>`).join("")}
          </div>
        </article>`;
    }).join("") || '<div class="empty-state">Nenhum tópico encontrado.</div>';

    $$(".discipline-head").forEach((head) => {
      const toggle = () => head.closest(".discipline-card").classList.toggle("open");
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") toggle();
      });
    });
  }

  function trailMatches(entry, filter) {
    if (filter === "priority") return entry.priority >= .8;
    if (filter === "review") return entry.item.next_review && entry.review >= 1;
    if (filter === "studied") return entry.stats.sessions > 0 || Boolean(entry.item.last_execution);
    if (filter === "pending") return entry.item.state === "Não estudado" && entry.stats.sessions === 0;
    return true;
  }

  function renderTrail() {
    const filter = $("#trailFilter").value;
    const rows = state.seed.trail.items.map(itemScore).filter((entry) => trailMatches(entry, filter));
    $("#trailTable").innerHTML = rows.map((entry) => {
      const acc = entry.accuracy === null ? "—" : pct(entry.accuracy);
      const overdue = entry.item.next_review && entry.review >= 1;
      return `
        <div class="trail-row">
          <div class="trail-code">${escapeHtml(entry.item.code)}</div>
          <div class="trail-title">
            ${escapeHtml(entry.item.title.replace(/^\w+\s+—\s+/, ""))}
            <small>${escapeHtml(entry.item.block)} · ${escapeHtml(entry.item.priority)}${overdue ? " · revisão vencida" : ""}</small>
          </div>
          <div class="track-col"><span class="pill">${escapeHtml(entry.item.track)}</span></div>
          <div class="state-col"><span class="pill ${overdue ? "bad" : ""}">${escapeHtml(entry.item.state)}</span></div>
          <div class="trail-score">${entry.score}<small style="display:block;color:var(--muted)">${acc}</small></div>
        </div>`;
    }).join("") || '<div class="empty-state">Nenhuma unidade nesse filtro.</div>';
  }

  function allocate(total, weighted) {
    const sum = weighted.reduce((s, x) => s + x.weight, 0) || 1;
    const raw = weighted.map((x) => ({ ...x, raw: total * x.weight / sum }));
    const out = raw.map((x) => ({ ...x, count: Math.floor(x.raw), frac: x.raw - Math.floor(x.raw) }));
    let used = out.reduce((s, x) => s + x.count, 0);
    out.sort((a, b) => b.frac - a.frac);
    for (let i = 0; used < total; i = (i + 1) % out.length) {
      out[i].count++;
      used++;
    }
    return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function disciplineWeakness(discipline) {
    if (String(discipline.canonicalSubject).includes("Língua Portuguesa")) {
      const g = globalStats();
      if (g.questions) return 1 - g.correct / g.questions;
    }
    return state.seed.scoringPolicy.unknownWeakness;
  }

  function generateSimulator() {
    const cargo = state.seed.cargos[state.cargo];
    const total = Math.max(10, Math.min(120, Number($("#simQuestions").value || 40)));
    const mode = $("#simMode").value;

    const weighted = cargo.disciplines.map((d) => {
      const coverage = Math.max(1, d.items?.length || 1);
      const weakness = disciplineWeakness(d);
      const weight = mode === "attack" ? coverage * (1 + weakness * .9) : coverage;
      return { name: d.name, weight, weakness };
    });

    const allocated = allocate(total, weighted).filter((x) => x.count > 0);
    $("#simTitle").textContent = `${total} questões · ${mode === "attack" ? "Ataque adaptativo" : "Cobertura"}`;
    $("#simOutput").classList.remove("empty-state");
    $("#simOutput").innerHTML = allocated.map((row) => `
      <div class="sim-row">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${row.count} q.</span>
      </div>`).join("");

    state.simulatorText = [
      `TJDFT — ${cargo.label}`,
      `Blueprint: ${total} questões · ${mode === "attack" ? "Ataque adaptativo" : "Cobertura do edital"}`,
      "",
      ...allocated.map((row) => `${row.name}: ${row.count} questões`),
      "",
      "Observação: distribuição experimental por granularidade do edital; não representa incidência histórica oficial."
    ].join("\n");
    $("#copySimBtn").disabled = false;
  }

  function populateSessionCodes() {
    $("#sessionCode").innerHTML = state.seed.trail.items.map((item) =>
      `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} — ${escapeHtml(item.title.replace(/^\w+\s+—\s+/, ""))}</option>`
    ).join("");
  }

  function renderLocalSessions() {
    const list = [...state.localSessions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $("#localSessionList").innerHTML = list.length ? list.map((s) => {
      const accuracy = s.questions ? s.correct / s.questions : null;
      return `
        <div class="session-item">
          <div>
            <strong>${escapeHtml(s.code)} · ${fmtDate(s.date)}</strong>
            <small>${escapeHtml(s.notes || "Sem observação.")}</small>
            <div class="session-stats">${s.minutes || 0} min · ${s.questions || 0} questões · ${accuracy === null ? "—" : pct(accuracy)} de acerto</div>
          </div>
          <button class="ghost-btn small delete-session" data-id="${escapeHtml(s.id)}">Excluir</button>
        </div>`;
    }).join("") : '<div class="empty-state">Nenhuma sessão local ainda. As 61 questões importadas continuam preservadas na semente.</div>';

    $$(".delete-session").forEach((btn) => btn.addEventListener("click", () => {
      state.localSessions = state.localSessions.filter((s) => s.id !== btn.dataset.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.localSessions));
      renderAll();
      toast("Sessão local excluída.");
    }));
  }

  function renderWarning() {
    const sourceDate = state.seed.source.snapshotAsOf || state.seed.source.snapshotSyncedAt;
    $("#dataWarning").innerHTML = `Base inicial importada do <strong>tjdft-dashboard</strong> (${fmtDate(sourceDate)}). Novas sessões deste laboratório ficam somente neste navegador. O score é experimental e <strong>não</strong> é incidência histórica oficial.`;
    $("#syncBadge").textContent = `Seed: ${fmtDate(sourceDate)}`;
  }

  function renderAll() {
    renderWarning();
    renderMetrics();
    renderRecommendation();
    renderQueue();
    renderErrors();
    renderDomainMatrix();
    renderMap();
    renderTrail();
    renderLocalSessions();
  }

  function bindEvents() {
    $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
    $$("[data-go]").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.go)));

    $("#cargoSelect").value = state.cargo;
    $("#cargoSelect").addEventListener("change", (e) => {
      state.cargo = e.target.value;
      localStorage.setItem(CARGO_KEY, state.cargo);
      renderMap();
      if (state.simulatorText) generateSimulator();
    });

    $("#mapSearch").addEventListener("input", renderMap);
    $("#trailFilter").addEventListener("change", renderTrail);
    $("#generateSimBtn").addEventListener("click", generateSimulator);
    $("#copySimBtn").addEventListener("click", async () => {
      if (!state.simulatorText) return;
      try {
        await navigator.clipboard.writeText(state.simulatorText);
        toast("Blueprint copiado.");
      } catch {
        toast("Não foi possível acessar a área de transferência.");
      }
    });

    $("#studyRecommendationBtn").addEventListener("click", (e) => {
      $("#sessionCode").value = e.currentTarget.dataset.code;
      switchView("registro");
    });

    $("#sessionForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const questions = Number($("#sessionQuestions").value || 0);
      const correct = Number($("#sessionCorrect").value || 0);
      if (correct > questions) {
        toast("Acertos não podem superar o número de questões.");
        return;
      }
      const session = {
        id: `lab-${Date.now()}`,
        origin: "planner-adaptativo-tjdft",
        code: $("#sessionCode").value,
        date: $("#sessionDate").value,
        minutes: Number($("#sessionMinutes").value || 0),
        questions,
        correct,
        errors: Math.max(0, questions - correct),
        notes: $("#sessionNotes").value.trim()
      };
      state.localSessions.push(session);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.localSessions));
      $("#sessionNotes").value = "";
      renderAll();
      toast("Sessão salva. Score recalculado.");
      switchView("hoje");
    });

    $("#exportBtn").addEventListener("click", () => {
      const payload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        cargo: state.cargo,
        sessions: state.localSessions
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `planner-tjdft-${todayIso()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    $("#resetBtn").addEventListener("click", () => {
      if (!confirm("Apagar somente as sessões locais deste laboratório? A semente importada do TJDFT será preservada.")) return;
      state.localSessions = [];
      localStorage.removeItem(STORAGE_KEY);
      renderAll();
      toast("Dados locais limpos.");
    });
  }

  async function init() {
    try {
      const response = await fetch("./data/seed.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.seed = await response.json();
      $("#sessionDate").value = todayIso();
      populateSessionCodes();
      bindEvents();
      renderAll();
    } catch (error) {
      console.error(error);
      $("#pageTitle").textContent = "Falha ao carregar a base";
      $("#view-hoje").innerHTML = `<div class="notice">Não foi possível carregar <code>data/seed.json</code>. Verifique a publicação do GitHub Pages.</div>`;
    }
  }

  init();
})();