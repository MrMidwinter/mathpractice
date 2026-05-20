(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = "mathPractice_hist_v3";
  const THEME_KEY = "mathPractice_theme_v1";
  const SOUND_KEY = "mathPractice_sound_v1";

  const MAX_KEEP_PER_COMBO = 5;
  const MS_GREEN = 3000;
  const MS_YELLOW = 15000;
  const SCORE_CAP_MS = 20000;

  const OLD_FAIL_TIME = 16000;
  const FAIL_TIME = -1;

  const MAX_GAIN = 1 / 3;
  const MIN_GAIN = 0.05;
  const WRONG_PENALTY = 0.25;

  const OPS = {
    "+": { symbol: "+" },
    "-": { symbol: "−" },
    "*": { symbol: "×" },
    "/": { symbol: "÷" }
  };

  const COLORS = {
    green: [34, 197, 94],
    yellow: [234, 179, 8],
    orange: [249, 115, 22],
    red: [239, 68, 68]
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const $ = id => document.getElementById(id);

  const randInt = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

  const pct = (part, total) =>
    total ? Math.round((part / total) * 100) : 0;

  const avg = nums =>
    nums.length
      ? Math.round(nums.reduce((sum, n) => sum + n, 0) / nums.length)
      : null;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
  }

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function weightedPick(items, weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * total;

    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }

    return items[items.length - 1];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(c1, c2, t) {
    const r = Math.round(lerp(c1[0], c2[0], t));
    const g = Math.round(lerp(c1[1], c2[1], t));
    const b = Math.round(lerp(c1[2], c2[2], t));

    return `rgb(${r},${g},${b})`;
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  const els = {
    startOverlay: $("startOverlay"),
    btnStart: $("btnStart"),
    btnClearHistory: $("btnClearHistory"),
    btnSound: $("btnSound"),

    difficulty: $("difficulty"),
    theme: $("theme"),
    opButtons: $("opButtons"),

    lhs: $("lhs"),
    op: $("op"),
    rhs: $("rhs"),
    answers: $("answers"),
    feedback: $("feedback"),

    rewardCluster: $("rewardCluster"),
    starFill: $("starFill"),
    starGhost: $("starGhost"),

    stTotal: $("stTotal"),
    stCorrect: $("stCorrect"),
    stWrong: $("stWrong"),
    stAcc: $("stAcc"),
    stAvg: $("stAvg"),
    stStreak: $("stStreak"),

    btnToggleHeat: $("btnToggleHeat"),
    heatWrap: $("heatWrap"),
    heatTip: $("heatTip"),
    heatAdd: $("heatAdd"),
    heatSub: $("heatSub"),
    heatMul: $("heatMul"),
    heatDiv: $("heatDiv"),

    btnToggleResults: $("btnToggleResults"),
    btnCopy: $("btnCopy"),
    resultsWrap: $("resultsWrap"),
    resultsPre: $("resultsPre"),
    historySub: $("historySub")
  };

  const ctx = {
    add: els.heatAdd.getContext("2d"),
    sub: els.heatSub.getContext("2d"),
    mul: els.heatMul.getContext("2d"),
    div: els.heatDiv.getContext("2d")
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let started = false;
  let streak = 0;
  let current = null;
  let prevProblemKey = null;
  let startTime = 0;

  let sessionAttempts = [];
  let sessionStars = 0;
  let starProgress = 0;

  let soundOn = localStorage.getItem(SOUND_KEY) !== "off";
  let audioEl = null;
  let rewardRaf = null;

  const histMap = loadHistMap();

  // ---------------------------------------------------------------------------
  // Time / scoring
  // ---------------------------------------------------------------------------

  function normalizeTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return null;
    return n === OLD_FAIL_TIME ? FAIL_TIME : n;
  }

  function isFail(ms) {
    return ms === FAIL_TIME || ms === OLD_FAIL_TIME;
  }

  function scoredMs(ms) {
    return isFail(ms) ? FAIL_TIME : Math.min(ms, SCORE_CAP_MS);
  }

  function fmtMs(ms) {
    if (ms == null) return "—";
    if (isFail(ms)) return "failed";
    if (ms >= SCORE_CAP_MS) return ">20s";
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  function loadHistMap() {
    const parsed = safeParse(localStorage.getItem(STORAGE_KEY), null);
    let data = null;

    if (parsed?.v === 3 && parsed.data && typeof parsed.data === "object") {
      data = parsed.data;
    } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed;
    }

    const map = new Map();
    if (!data) return map;

    Object.keys(data).forEach(key => {
      if (!/^[-+*/]:\d+,\d+$/.test(key)) return;
      if (!Array.isArray(data[key])) return;

      const times = data[key]
        .map(normalizeTime)
        .filter(v => v != null)
        .slice(-MAX_KEEP_PER_COMBO);

      if (times.length) map.set(key, times);
    });

    return map;
  }

  function saveHistMap() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 3,
          data: Object.fromEntries(histMap.entries())
        })
      );
    } catch {}
  }

  function clearHistory() {
    histMap.clear();

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Problem keys / history lookup
  // ---------------------------------------------------------------------------

  function canonicalPair(op, a, b) {
    return op === "-" && a < b ? [b, a] : [a, b];
  }

  function keyFor(op, a, b) {
    const [x, y] = canonicalPair(op, a, b);
    return `${op}:${x},${y}`;
  }

  function parseKey(key) {
    const [op, pair] = key.split(":");
    if (!pair || !OPS[op]) return null;

    const [a, b] = pair.split(",").map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

    return { op, a, b };
  }

  function getTimes(op, a, b) {
    const times = histMap.get(keyFor(op, a, b));

    return Array.isArray(times)
      ? times.map(normalizeTime).filter(v => v != null)
      : [];
  }

  function setTimes(op, a, b, times) {
    histMap.set(keyFor(op, a, b), times.slice(-MAX_KEEP_PER_COMBO));
  }

  function recordAttempt(op, a, b, ok, elapsedMs) {
    const times = getTimes(op, a, b);

    times.push(ok ? elapsedMs : FAIL_TIME);

    while (times.length > MAX_KEEP_PER_COMBO) {
      times.shift();
    }

    setTimes(op, a, b, times);
    saveHistMap();
  }

  // ---------------------------------------------------------------------------
  // Operations / question generation
  // ---------------------------------------------------------------------------

  function getMaxN() {
    return Number(els.difficulty.value) || 10;
  }

  function getSelectedOps() {
    const active = Array.from(
      els.opButtons.querySelectorAll(".op-toggle.active")
    )
      .map(btn => btn.dataset.op)
      .filter(op => OPS[op]);

    return active.length ? active : ["+"];
  }

  function correctFor(op, a, b) {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    return a / b;
  }

  function allPairsFor(op, maxN) {
    const pairs = [];

    if (op === "+" || op === "*") {
      for (let a = 1; a <= maxN; a++) {
        for (let b = 1; b <= maxN; b++) {
          pairs.push([a, b]);
        }
      }
    }

    if (op === "-") {
      for (let a = 1; a <= maxN; a++) {
        for (let b = 1; b <= a; b++) {
          pairs.push([a, b]);
        }
      }
    }

    if (op === "/") {
      for (let divisor = 1; divisor <= maxN; divisor++) {
        for (let quotient = 1; quotient <= maxN; quotient++) {
          pairs.push([divisor * quotient, divisor]);
        }
      }
    }

    return pairs;
  }

  function selectedQuestionSet(maxN) {
    return getSelectedOps().flatMap(op =>
      allPairsFor(op, maxN).map(([a, b]) => ({ op, a, b }))
    );
  }

  function comboSummary(op, a, b) {
    const attempts = getTimes(op, a, b).map(ms => ({
      ms,
      scored: scoredMs(ms),
      ok: !isFail(ms)
    }));

    const summary = attemptSummary(attempts);
    summary.failRate = summary.total ? summary.wrong / summary.total : 0;

    return summary;
  }

  function comboWeight(op, a, b) {
    const summary = comboSummary(op, a, b);

    if (!summary.total) return 1;

    const failRate = summary.wrong / summary.total;
    const slowScore =
      summary.avgTime == null
        ? 0
        : clamp((summary.avgTime - MS_GREEN) / (MS_YELLOW - MS_GREEN), 0, 1);

    const confidence = Math.min(1, summary.total / 3);
    const boost = clamp(
      failRate * 0.6 * confidence + slowScore * 0.3 * confidence,
      0,
      0.85
    );

    return (1 + boost) * (0.97 + Math.random() * 0.06);
  }

  function pickNewQuestionFirst(items, maxN) {
    const unseen = items.filter(item =>
      getTimes(item.op, item.a, item.b).length === 0
    );

    if (!unseen.length) return null;

    for (let i = 0; i < 20; i++) {
      const candidate = unseen[randInt(0, unseen.length - 1)];
      const key = `${keyFor(candidate.op, candidate.a, candidate.b)}:${maxN}`;

      if (key !== prevProblemKey || unseen.length === 1) {
        return candidate;
      }
    }

    return unseen[randInt(0, unseen.length - 1)];
  }

  function makeProblem() {
    const maxN = getMaxN();
    const items = selectedQuestionSet(maxN);

    let picked = pickNewQuestionFirst(items, maxN);

    if (!picked) {
      const weights = items.map(item =>
        comboWeight(item.op, item.a, item.b)
      );

      picked = weightedPick(items, weights);

      for (let i = 0; i < 14; i++) {
        const key = `${keyFor(picked.op, picked.a, picked.b)}:${maxN}`;
        if (key !== prevProblemKey) break;

        picked = weightedPick(items, weights);
      }
    }

    prevProblemKey = `${keyFor(picked.op, picked.a, picked.b)}:${maxN}`;

    return {
      op: picked.op,
      a: picked.a,
      b: picked.b,
      correct: correctFor(picked.op, picked.a, picked.b),
      maxN
    };
  }

  function buildChoices(correct, op, maxN) {
    const options = new Set([correct]);

    let minAns = 0;
    let maxAns = maxN * maxN;

    if (op === "+") {
      minAns = 2;
      maxAns = maxN * 2;
    } else if (op === "-") {
      minAns = 0;
      maxAns = maxN - 1;
    } else if (op === "*") {
      minAns = 1;
      maxAns = maxN * maxN;
    } else if (op === "/") {
      minAns = 1;
      maxAns = maxN;
    }

    const targetCount = Math.min(
      maxN === 5 ? 4 : 8,
      Math.max(1, maxAns - minAns + 1)
    );

    let radius = Math.max(5, Math.round(maxN * 0.25));
    let guard = 0;

    while (options.size < targetCount && guard++ < 500) {
      let candidate =
        op === "*"
          ? correct + randInt(-radius * maxN, radius * maxN)
          : correct + randInt(-radius, radius);

      candidate = Math.round(candidate);

      if (candidate >= minAns && candidate <= maxAns) {
        options.add(candidate);
      }

      radius = Math.min(radius + 2, Math.max(20, maxN));
    }

    for (let value = minAns; options.size < targetCount && value <= maxAns; value++) {
      options.add(value);
    }

    return shuffle(Array.from(options));
  }

  // ---------------------------------------------------------------------------
  // Attempts / stats
  // ---------------------------------------------------------------------------

  function attemptSummary(list) {
    const total = list.length;
    const correct = list.filter(x => x.ok).length;
    const wrong = total - correct;
    const times = list
      .filter(x => x.ok)
      .map(x => x.scored ?? scoredMs(x.ms));

    return {
      total,
      correct,
      wrong,
      acc: pct(correct, total),
      avgTime: avg(times)
    };
  }

  function heatmapCompletion(maxN) {
    const items = selectedQuestionSet(maxN);
    const filled = items.filter(item =>
      getTimes(item.op, item.a, item.b).length > 0
    ).length;

    return {
      total: items.length,
      filled,
      complete: items.length > 0 && filled >= items.length
    };
  }

  function renderStats() {
    const summary = attemptSummary(sessionAttempts);
    const completion = heatmapCompletion(getMaxN());

    els.stTotal.textContent = summary.total;
    els.stCorrect.textContent = summary.correct;
    els.stWrong.textContent = summary.wrong;
    els.stAcc.textContent = `${summary.acc}%`;
    els.stAvg.textContent = fmtMs(summary.avgTime);
    els.stStreak.textContent = streak;

    els.historySub.textContent = completion.complete
      ? "Heatmap complete. Adaptive weighting is active. Raw times are stored; stats clamp at >20s."
      : `Filling heatmap: ${completion.filled} / ${completion.total} combinations have data. Raw times are stored; stats clamp at >20s.`;

    drawAllCharts();
  }

  // ---------------------------------------------------------------------------
  // Feedback / UI
  // ---------------------------------------------------------------------------

  function setFeedback(message, type) {
    els.feedback.textContent = message || "";
    els.feedback.classList.remove("good", "bad");

    if (type) {
      els.feedback.classList.add(type);
    }
  }

  function lockButtons() {
    els.answers
      .querySelectorAll("button")
      .forEach(btn => {
        btn.disabled = true;
      });
  }

  function renderResults() {
    els.resultsPre.textContent = JSON.stringify(
      Object.fromEntries(histMap.entries()),
      null,
      2
    );
  }

  function applyTheme(theme) {
    document.body.classList.remove("theme-dark", "theme-pink");

    if (theme === "dark") document.body.classList.add("theme-dark");
    if (theme === "pink") document.body.classList.add("theme-pink");

    els.theme.value = theme;

    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}

    drawAllCharts();
  }

  // ---------------------------------------------------------------------------
  // Sound / rewards
  // ---------------------------------------------------------------------------

  function updateSoundButton() {
    els.btnSound.textContent = soundOn ? "Sound On" : "Sound Off";
  }

  function initSound() {
    audioEl = new Audio("sounds/chime.ogg");
    audioEl.preload = "auto";

    audioEl.onerror = () => {
      if (audioEl && !audioEl.src.includes("chime.m4a")) {
        audioEl.src = "sounds/chime.m4a";
        audioEl.load();
      }
    };
  }

  function playRewardSound() {
    if (!soundOn || !audioEl) return;

    try {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    } catch {}
  }

  function rewardGain(ms) {
    const capped = Math.min(ms, SCORE_CAP_MS);

    if (capped <= MS_GREEN) return MAX_GAIN;

    const t = (capped - MS_GREEN) / (SCORE_CAP_MS - MS_GREEN);

    return MIN_GAIN + (MAX_GAIN - MIN_GAIN) * (1 - t);
  }

  function addStarProgress(amount) {
    starProgress += amount;

    while (starProgress >= 1) {
      sessionStars++;
      starProgress -= 1;

      playRewardSound();

      els.rewardCluster.classList.add("pop");
      setTimeout(() => els.rewardCluster.classList.remove("pop"), 260);
    }
  }

  function currentGhostGain() {
    if (!current || !started) return 0;
    return rewardGain(performance.now() - startTime);
  }

  function renderRewardCluster() {
    const compactStarLimit = window.innerWidth <= 520 ? 6 : 10;

    if (sessionStars <= 0) {
      els.rewardCluster.textContent = "";
    } else if (sessionStars < compactStarLimit) {
      els.rewardCluster.textContent = "⭐".repeat(sessionStars);
    } else {
      els.rewardCluster.innerHTML =
        `⭐ <span class="reward-count">x ${sessionStars}</span>`;
    }

    const ghost = currentGhostGain();

    els.starFill.style.width = `${starProgress * 100}%`;
    els.starGhost.style.left = `${starProgress * 100}%`;
    els.starGhost.style.width =
      `${Math.min(1 - starProgress, ghost) * 100}%`;
  }

  function rewardLoop() {
    renderRewardCluster();
    rewardRaf = requestAnimationFrame(rewardLoop);
  }

  // ---------------------------------------------------------------------------
  // Heatmap colors
  // ---------------------------------------------------------------------------

  function baseTimeRgb(ms) {
    if (ms == null) return null;

    const t = (clamp(ms, MS_GREEN, MS_YELLOW) - MS_GREEN) /
      (MS_YELLOW - MS_GREEN);

    return [
      Math.round(lerp(COLORS.green[0], COLORS.yellow[0], t)),
      Math.round(lerp(COLORS.green[1], COLORS.yellow[1], t)),
      Math.round(lerp(COLORS.green[2], COLORS.yellow[2], t))
    ];
  }

  function mixedColor(summary) {
    if (!summary.total) return "rgba(255,255,255,0.06)";
    if (summary.wrong === summary.total) {
      return lerpColor(COLORS.orange, COLORS.red, 0.85);
    }

    const base = baseTimeRgb(summary.avgTime) || COLORS.yellow;

    if (!summary.failRate) {
      return lerpColor(base, base, 0);
    }

    return lerpColor(
      base,
      summary.failRate >= 0.5 ? COLORS.red : COLORS.orange,
      clamp(summary.failRate * 1.35, 0, 1)
    );
  }

  // ---------------------------------------------------------------------------
  // Heatmap drawing
  // ---------------------------------------------------------------------------

  function resizeCanvas(canvas, context) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height) * dpr);

    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(dpr, dpr);

    return {
      w: rect.width,
      h: rect.height
    };
  }

  function axisStep(maxN) {
    if (maxN <= 20) return 1;
    if (maxN <= 50) return 5;
    return 10;
  }

  function drawPairHeatmap(canvas, context, op) {
    const pane = canvas.closest(".heat-pane");
    const visible = getSelectedOps().includes(op);

    if (pane) {
      pane.style.display = visible ? "" : "none";
    }

    if (!visible) return;

    const maxN = getMaxN();
    const { w, h } = resizeCanvas(canvas, context);

    context.clearRect(0, 0, w, h);
    context.fillStyle = "rgba(255,255,255,0.03)";
    context.fillRect(0, 0, w, h);

    const pad = 26;
    const gridW = w - pad - 6;
    const gridH = h - pad - 6;
    const cellW = gridW / maxN;
    const cellH = gridH / maxN;

    for (let a = 1; a <= maxN; a++) {
      for (let b = 1; b <= maxN; b++) {
        if (op === "-" && a < b) continue;

        context.fillStyle = mixedColor(comboSummary(op, a, b));
        context.fillRect(
          pad + (b - 1) * cellW,
          4 + (a - 1) * cellH,
          Math.max(1, cellW - 1),
          Math.max(1, cellH - 1)
        );
      }
    }

    context.fillStyle = "rgba(255,255,255,.58)";
    context.font = "11px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (let i = 1; i <= maxN; i += axisStep(maxN)) {
      context.fillText(String(i), pad + (i - 0.5) * cellW, h - pad / 2);
      context.fillText(String(i), pad / 2, 4 + (i - 0.5) * cellH);
    }
  }

  function drawDivisionGraph() {
    const pane = els.heatDiv.closest(".heat-pane");
    const visible = getSelectedOps().includes("/");

    if (pane) {
      pane.style.display = visible ? "" : "none";
    }

    if (!visible) return;

    const maxN = getMaxN();
    const { w, h } = resizeCanvas(els.heatDiv, ctx.div);

    ctx.div.clearRect(0, 0, w, h);
    ctx.div.fillStyle = "rgba(255,255,255,0.03)";
    ctx.div.fillRect(0, 0, w, h);

    const padL = 34;
    const padT = 12;
    const padR = 10;
    const padB = 30;

    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const barW = chartW / maxN;

    for (let divisor = 1; divisor <= maxN; divisor++) {
      let times = [];

      for (let quotient = 1; quotient <= maxN; quotient++) {
        times = times.concat(getTimes("/", divisor * quotient, divisor));
      }

      const summary = attemptSummary(
        times.map(ms => ({
          ms,
          scored: scoredMs(ms),
          ok: !isFail(ms)
        }))
      );

      const failRate = summary.total
        ? summary.wrong / summary.total
        : 0;

      const height = summary.avgTime == null
        ? 0
        : clamp(summary.avgTime, 0, MS_YELLOW) / MS_YELLOW;

      const barH = Math.max(
        2,
        chartH * clamp(height + failRate * 0.35, 0, 1)
      );

      ctx.div.fillStyle = mixedColor({
        total: summary.total,
        wrong: summary.wrong,
        failRate,
        avgTime: summary.avgTime
      });

      ctx.div.fillRect(
        padL + (divisor - 1) * barW + 1,
        padT + chartH - barH,
        Math.max(1, barW - 2),
        barH
      );
    }
  }

  function drawAllCharts() {
    drawPairHeatmap(els.heatAdd, ctx.add, "+");
    drawPairHeatmap(els.heatSub, ctx.sub, "-");
    drawPairHeatmap(els.heatMul, ctx.mul, "*");
    drawDivisionGraph();
  }

  // ---------------------------------------------------------------------------
  // Heatmap hover
  // ---------------------------------------------------------------------------

  function hitPairHeat(canvas, ev) {
    const rect = canvas.getBoundingClientRect();
    const maxN = getMaxN();
    const pad = 26;

    const b = Math.floor(
      (ev.clientX - rect.left - pad) / ((rect.width - pad - 6) / maxN)
    ) + 1;

    const a = Math.floor(
      (ev.clientY - rect.top - 4) / ((rect.height - pad - 6) / maxN)
    ) + 1;

    if (a < 1 || b < 1 || a > maxN || b > maxN) return null;

    return { a, b };
  }

  function bindPairHover(canvas, op) {
    canvas.addEventListener("mousemove", ev => {
      const hit = hitPairHeat(canvas, ev);

      if (!hit || (op === "-" && hit.a < hit.b)) {
        els.heatTip.classList.add("hidden");
        return;
      }

      const summary = comboSummary(op, hit.a, hit.b);
      const formula =
        `${hit.a} ${OPS[op].symbol} ${hit.b} = ${correctFor(op, hit.a, hit.b)}`;

      els.heatTip.textContent = summary.total
        ? `${formula} | n=${summary.total}, acc=${summary.acc}%, wrong=${summary.wrong}, avg=${fmtMs(summary.avgTime)}`
        : `${formula} | no data`;

      els.heatTip.classList.remove("hidden");
      els.heatTip.style.left = `${ev.clientX}px`;
      els.heatTip.style.top = `${ev.clientY}px`;
    });

    canvas.addEventListener("mouseleave", () => {
      els.heatTip.classList.add("hidden");
    });
  }

  // ---------------------------------------------------------------------------
  // Game rendering / flow
  // ---------------------------------------------------------------------------

  function renderProblem(problem) {
    current = problem;

    els.lhs.textContent = String(problem.a);
    els.op.textContent = OPS[problem.op].symbol;
    els.rhs.textContent = String(problem.b);

    setFeedback("", null);

    els.answers.innerHTML = "";

    buildChoices(problem.correct, problem.op, problem.maxN).forEach(value => {
      const btn = document.createElement("button");

      btn.type = "button";
      btn.className = "answer-btn";
      btn.textContent = value;
      btn.dataset.value = String(value);
      btn.addEventListener("click", onAnswerClick, { once: true });

      els.answers.appendChild(btn);
    });

    startTime = performance.now();
  }

  function nextProblem() {
    renderProblem(makeProblem());
  }

  function startGame() {
    started = true;
    prevProblemKey = null;

    els.startOverlay.classList.add("hidden");

    setFeedback("", null);
    nextProblem();
  }

  function onAnswerClick(e) {
    if (!current) return;

    const rawMs = Math.round(performance.now() - startTime);
    const selected = Number(e.currentTarget.dataset.value);
    const ok = selected === current.correct;

    recordAttempt(current.op, current.a, current.b, ok, rawMs);

    sessionAttempts.push({
      op: current.op,
      a: current.a,
      b: current.b,
      ms: ok ? rawMs : FAIL_TIME,
      scored: ok ? scoredMs(rawMs) : FAIL_TIME,
      ok,
      correct: current.correct
    });

    renderResults();
    lockButtons();

    if (ok) {
      streak++;
      addStarProgress(rewardGain(rawMs));
      setFeedback(`✅ Correct! (${fmtMs(scoredMs(rawMs))})`, "good");
    } else {
      streak = 0;
      starProgress = Math.max(0, starProgress - WRONG_PENALTY);
      setFeedback(`❌ Oops! Correct answer is ${current.correct}`, "bad");
    }

    renderStats();
    renderRewardCluster();

    setTimeout(nextProblem, 800);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function copyResults() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(Object.fromEntries(histMap.entries()), null, 2)
      );

      setFeedback("📋 History copied!", "good");
      setTimeout(() => setFeedback("", null), 900);
    } catch {
      els.resultsWrap.classList.remove("hidden");
      els.btnToggleResults.textContent = "Hide";
    }
  }

  function ensureOneOperation(btn) {
    const hasActive = els.opButtons.querySelectorAll(".op-toggle.active").length;

    if (hasActive) return;

    btn.classList.add("active");

    setFeedback("Pick at least one operation.", "bad");
    setTimeout(() => setFeedback("", null), 900);
  }

  function toggleSection(section, button) {
    const hidden = section.classList.toggle("hidden");
    button.textContent = hidden ? "Show" : "Hide";
    return hidden;
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  els.btnStart.addEventListener("click", startGame);

  els.btnClearHistory.addEventListener("click", () => {
    clearHistory();
    renderResults();
    renderStats();

    setFeedback("Saved history cleared.", "good");
    setTimeout(() => setFeedback("", null), 900);
  });

  els.difficulty.addEventListener("change", () => {
    prevProblemKey = null;

    if (started) nextProblem();

    renderStats();
  });

  els.theme.addEventListener("change", () => {
    applyTheme(els.theme.value);
  });

  els.btnSound.addEventListener("click", () => {
    soundOn = !soundOn;

    try {
      localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
    } catch {}

    updateSoundButton();
  });

  els.opButtons.addEventListener("click", e => {
    const btn = e.target.closest(".op-toggle");
    if (!btn) return;

    btn.classList.toggle("active");
    ensureOneOperation(btn);

    prevProblemKey = null;

    if (started) nextProblem();

    renderStats();
  });

  els.btnToggleResults.addEventListener("click", () => {
    toggleSection(els.resultsWrap, els.btnToggleResults);
  });

  els.btnCopy.addEventListener("click", copyResults);

  els.btnToggleHeat.addEventListener("click", () => {
    toggleSection(els.heatWrap, els.btnToggleHeat);
    drawAllCharts();
  });

  window.addEventListener("resize", drawAllCharts);

  bindPairHover(els.heatAdd, "+");
  bindPairHover(els.heatSub, "-");
  bindPairHover(els.heatMul, "*");

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  initSound();
  updateSoundButton();
  applyTheme(localStorage.getItem(THEME_KEY) || "standard");

  renderResults();
  renderStats();
  drawAllCharts();

  rewardLoop();

  els.startOverlay.classList.remove("hidden");
})();
