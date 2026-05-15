(() => {
  "use strict";

  const STORAGE_KEY = "mathPractice_hist_v3";
  const THEME_KEY = "mathPractice_theme_v1";
  const MAX_KEEP_PER_COMBO = 5;
  const ROLLING_LIMIT = 100;
  const MS_GREEN = 3000;
  const MS_YELLOW = 15000;
  const OLD_FAIL_TIME = 16000;
  const FAIL_TIME = -1;

  const OPS = {
    "+": { label: "Addition", symbol: "+" },
    "-": { label: "Subtraction", symbol: "−" },
    "*": { label: "Multiplication", symbol: "×" },
    "/": { label: "Division", symbol: "÷" }
  };

  const $ = id => document.getElementById(id);
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pct = (part, total) => total ? Math.round((part / total) * 100) : 0;
  const avg = nums => nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function fmtMs(ms) {
    if (ms == null) return "—";
    if (isFail(ms)) return "failed";
    if (ms < 1000) return ms + " ms";
    return (ms / 1000).toFixed(2) + " s";
  }

  function safeParse(text, fallback) {
    try {
      const parsed = JSON.parse(text);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function weightedPick(items, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  const startOverlay = $("startOverlay");
  const btnStart = $("btnStart");
  const btnNew = $("btnNew");
  const btnReset = $("btnReset");
  const btnClearHistory = $("btnClearHistory");
  const elDifficulty = $("difficulty");
  const elTheme = $("theme");
  const opButtons = $("opButtons");
  const elLhs = $("lhs");
  const elOp = $("op");
  const elRhs = $("rhs");
  const elAnswers = $("answers");
  const elFeedback = $("feedback");
  const stTotal = $("stTotal");
  const stCorrect = $("stCorrect");
  const stWrong = $("stWrong");
  const stAcc = $("stAcc");
  const stAvg = $("stAvg");
  const stStreak = $("stStreak");
  const stBest = $("stBest");
  const operationBars = $("operationBars");
  const answerRangeBars = $("answerRangeBars");
  const numberSizeBars = $("numberSizeBars");
  const mostMissed = $("mostMissed");
  const btnToggleInsights = $("btnToggleInsights");
  const elInsights = $("insights");
  const btnToggleHeat = $("btnToggleHeat");
  const heatWrap = $("heatWrap");
  const heatTip = $("heatTip");
  const heatAdd = $("heatAdd");
  const heatSub = $("heatSub");
  const heatMul = $("heatMul");
  const heatDiv = $("heatDiv");
  const ctxAdd = heatAdd.getContext("2d");
  const ctxSub = heatSub.getContext("2d");
  const ctxMul = heatMul.getContext("2d");
  const ctxDiv = heatDiv.getContext("2d");
  const btnToggleResults = $("btnToggleResults");
  const btnCopy = $("btnCopy");
  const resultsWrap = $("resultsWrap");
  const elResultsPre = $("resultsPre");

  let started = false;
  let streak = 0;
  let bestStreak = 0;
  let current = null;
  let prevProblemKey = null;
  let startTime = 0;

  const histMap = loadHistMap();
  window.histMap = histMap;

  function isFail(ms) {
    return ms === FAIL_TIME || ms === OLD_FAIL_TIME;
  }

  function normalizeTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return null;
    return n === OLD_FAIL_TIME ? FAIL_TIME : n;
  }

  function loadHistMap() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = safeParse(raw, null);
    let data = null;

    if (parsed && parsed.v === 3 && parsed.data && typeof parsed.data === "object") data = parsed.data;
    else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;

    const map = new Map();
    if (!data) return map;

    Object.keys(data).forEach(k => {
      if (!/^[-+*/]:\d+,\d+$/.test(k)) return;
      if (!Array.isArray(data[k])) return;
      const arr = data[k].map(normalizeTime).filter(v => v != null).slice(-MAX_KEEP_PER_COMBO);
      if (arr.length) map.set(k, arr);
    });

    return map;
  }

  function saveHistMap() {
    const obj = Object.fromEntries(histMap.entries());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 3, data: obj }));
    } catch (err) {}
  }

  function clearHistory() {
    histMap.clear();
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
  }

  function getMaxN() {
    return Number(elDifficulty.value) || 10;
  }

  function getSelectedOps() {
    const active = Array.from(opButtons.querySelectorAll(".op-toggle.active"))
      .map(btn => btn.dataset.op)
      .filter(op => OPS[op]);
    return active.length ? active : ["+"];
  }

  function canonicalPair(op, a, b) {
    if (op === "-") return a >= b ? [a, b] : [b, a];
    return [a, b];
  }

  function keyFor(op, a, b) {
    const pair = canonicalPair(op, a, b);
    return op + ":" + pair[0] + "," + pair[1];
  }

  function parseKey(k) {
    const parts = k.split(":");
    if (parts.length !== 2) return null;
    const op = parts[0];
    const nums = parts[1].split(",").map(Number);
    if (!OPS[op] || nums.length !== 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) return null;
    return { op: op, a: nums[0], b: nums[1] };
  }

  function getTimes(op, a, b) {
    const arr = histMap.get(keyFor(op, a, b));
    return Array.isArray(arr) ? arr.map(normalizeTime).filter(v => v != null) : [];
  }

  function setTimes(op, a, b, times) {
    histMap.set(keyFor(op, a, b), times.slice(-MAX_KEEP_PER_COMBO));
  }

  function recordAttempt(op, a, b, ok, elapsedMs) {
    const arr = getTimes(op, a, b);
    arr.push(ok ? elapsedMs : FAIL_TIME);
    while (arr.length > MAX_KEEP_PER_COMBO) arr.shift();
    setTimes(op, a, b, arr);
    saveHistMap();
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
      for (let a = 1; a <= maxN; a++) for (let b = 1; b <= maxN; b++) pairs.push([a, b]);
    } else if (op === "-") {
      for (let a = 1; a <= maxN; a++) for (let b = 1; b <= a; b++) pairs.push([a, b]);
    } else if (op === "/") {
      for (let divisor = 1; divisor <= maxN; divisor++) {
        for (let quotient = 1; quotient <= maxN; quotient++) pairs.push([divisor * quotient, divisor]);
      }
    }
    return pairs;
  }

  function selectedQuestionSet(maxN) {
    const items = [];
    getSelectedOps().forEach(op => {
      allPairsFor(op, maxN).forEach(pair => items.push({ op: op, a: pair[0], b: pair[1] }));
    });
    return items;
  }

  function heatmapCompletion(maxN) {
    const items = selectedQuestionSet(maxN);
    const filled = items.filter(item => getTimes(item.op, item.a, item.b).length > 0).length;
    return { total: items.length, filled: filled, complete: items.length > 0 && filled >= items.length };
  }

  function inSelectedRange(entry, maxN) {
    if (!entry) return false;
    if (entry.op === "+" || entry.op === "*") return entry.a >= 1 && entry.a <= maxN && entry.b >= 1 && entry.b <= maxN;
    if (entry.op === "-") return entry.a >= 1 && entry.a <= maxN && entry.b >= 1 && entry.b <= entry.a;
    if (entry.op === "/") return entry.b >= 1 && entry.b <= maxN && entry.a >= entry.b && entry.a <= entry.b * maxN && entry.a % entry.b === 0;
    return false;
  }

  function flattenAttempts() {
    const maxN = getMaxN();
    const selectedOps = getSelectedOps();
    const out = [];

    for (const entry of histMap.entries()) {
      const info = parseKey(entry[0]);
      if (!info || selectedOps.indexOf(info.op) < 0 || !inSelectedRange(info, maxN)) continue;
      const times = Array.isArray(entry[1]) ? entry[1].map(normalizeTime).filter(v => v != null) : [];
      times.forEach((time, idx) => {
        out.push({ op: info.op, a: info.a, b: info.b, ms: time, ok: !isFail(time), correct: correctFor(info.op, info.a, info.b), idx: idx });
      });
    }

    return out.slice(-ROLLING_LIMIT);
  }

  function attemptSummary(list) {
    const total = list.length;
    const correct = list.filter(x => x.ok).length;
    const wrong = total - correct;
    const times = list.filter(x => x.ok).map(x => x.ms);
    return { total: total, correct: correct, wrong: wrong, acc: pct(correct, total), avgTime: avg(times) };
  }

  function comboSummary(op, a, b) {
    const times = getTimes(op, a, b);
    const attempts = times.map(t => ({ ms: t, ok: !isFail(t) }));
    const s = attemptSummary(attempts);
    s.failRate = s.total ? s.wrong / s.total : 0;
    return s;
  }

  function setFeedback(msg, type) {
    elFeedback.textContent = msg || "";
    elFeedback.classList.remove("good", "bad");
    if (type) elFeedback.classList.add(type);
  }

  function lockButtons() {
    Array.from(elAnswers.querySelectorAll("button")).forEach(b => b.disabled = true);
  }

  function renderResults() {
    elResultsPre.textContent = JSON.stringify(Object.fromEntries(histMap.entries()), null, 2);
  }

  function applyTheme(theme) {
    document.body.classList.remove("theme-dark", "theme-pink");
    if (theme === "dark") document.body.classList.add("theme-dark");
    if (theme === "pink") document.body.classList.add("theme-pink");
    elTheme.value = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) {}
    drawAllCharts();
  }

  function comboWeight(op, a, b) {
    const s = comboSummary(op, a, b);

    if (!s.total) return 1;

    const failRate = s.total ? s.wrong / s.total : 0;

    const slowScore = s.avgTime == null
      ? 0
      : clamp((s.avgTime - MS_GREEN) / (MS_YELLOW - MS_GREEN), 0, 1);

    const confidence = Math.min(1, s.total / 3);

    const failureBoost = failRate * 0.60 * confidence;
    const slowBoost = slowScore * 0.30 * confidence;
    const totalBoost = clamp(failureBoost + slowBoost, 0, 0.85);

    return (1 + totalBoost) * (0.97 + Math.random() * 0.06);
  }
  function pickNewQuestionFirst(items, maxN) {
    const unseen = items.filter(item => getTimes(item.op, item.a, item.b).length === 0);
    if (!unseen.length) return null;

    for (let i = 0; i < 20; i++) {
      const candidate = unseen[randInt(0, unseen.length - 1)];
      const k = keyFor(candidate.op, candidate.a, candidate.b) + ":" + maxN;
      if (k !== prevProblemKey || unseen.length === 1) return candidate;
    }

    return unseen[randInt(0, unseen.length - 1)];
  }

  function makeProblem() {
    const maxN = getMaxN();
    const items = selectedQuestionSet(maxN);
    let picked = pickNewQuestionFirst(items, maxN);

    if (!picked) {
      const weights = items.map(item => comboWeight(item.op, item.a, item.b));
      picked = weightedPick(items, weights);
      for (let i = 0; i < 14; i++) {
        const k = keyFor(picked.op, picked.a, picked.b) + ":" + maxN;
        if (k !== prevProblemKey) break;
        picked = weightedPick(items, weights);
      }
    }

    prevProblemKey = keyFor(picked.op, picked.a, picked.b) + ":" + maxN;
    return { op: picked.op, a: picked.a, b: picked.b, correct: correctFor(picked.op, picked.a, picked.b), maxN: maxN };
  }

  function buildChoices(correct, op, maxN) {
    const options = new Set([correct]);

    let minAns = 0;
    let maxAns = maxN * maxN;

    if (op === "+") {
      minAns = 2;
      maxAns = maxN * 2;
    }

    if (op === "-") {
      minAns = 0;
      maxAns = maxN - 1;
    }

    if (op === "*") {
      minAns = 1;
      maxAns = maxN * maxN;
    }

    if (op === "/") {
      minAns = 1;
      maxAns = maxN;
    }

    // For 1–5, always show only 4 buttons.
    // For all other difficulties, show up to 8 buttons.
    const possibleCount = Math.max(1, maxAns - minAns + 1);
    const wantedCount = maxN === 5 ? 4 : 8;
    const targetCount = Math.min(wantedCount, possibleCount);

    let radius = Math.max(5, Math.round(maxN * 0.25));
    let guard = 0;

    while (options.size < targetCount && guard++ < 500) {
      let candidate = correct + randInt(-radius, radius);

      if (op === "*") {
        candidate = correct + randInt(-radius * maxN, radius * maxN);
      }

      candidate = Math.round(candidate);

      if (candidate >= minAns && candidate <= maxAns) {
        options.add(candidate);
      }

      radius = Math.min(radius + 2, Math.max(20, maxN));
    }

    // Safe fallback: fills remaining choices without risking an infinite loop.
    for (let value = minAns; options.size < targetCount && value <= maxAns; value++) {
      options.add(value);
    }

    return shuffle(Array.from(options));
  }

  function renderProblem(p) {
    current = p;
    elLhs.textContent = String(p.a);
    elOp.textContent = OPS[p.op].symbol;
    elRhs.textContent = String(p.b);
    setFeedback("", null);
    elAnswers.innerHTML = "";

    buildChoices(p.correct, p.op, p.maxN).forEach(value => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "answer-btn";
      btn.textContent = value;
      btn.dataset.value = String(value);
      btn.addEventListener("click", onAnswerClick, { once: true });
      elAnswers.appendChild(btn);
    });

    startTime = performance.now();
  }

  function nextProblem() {
    renderProblem(makeProblem());
  }

  function bucketAnswerRange(ans, maxN) {
    const q1 = Math.max(5, Math.round(maxN * 0.5));
    const q2 = Math.max(10, maxN);
    const q3 = Math.max(20, maxN * 2);
    if (ans <= q1) return "≤" + q1;
    if (ans <= q2) return (q1 + 1) + "–" + q2;
    if (ans <= q3) return (q2 + 1) + "–" + q3;
    return (q3 + 1) + "+";
  }

  function bucketNumberSize(a, b, maxN) {
    const m = Math.max(a, b);
    if (m <= Math.max(3, Math.floor(maxN * 0.25))) return "Small";
    if (m <= Math.max(6, Math.floor(maxN * 0.6))) return "Medium";
    return "Big";
  }

  function renderBucketBars(container, buckets, mode) {
    container.innerHTML = "";
    Object.keys(buckets).forEach(name => {
      const s = attemptSummary(buckets[name]);
      const row = document.createElement("div");
      row.className = "bucket";
      const label = document.createElement("div");
      label.className = "name";
      label.textContent = name + " (" + s.total + ")";
      const bar = document.createElement("div");
      bar.className = mode === "time" ? "bar slow" : "bar";
      const fill = document.createElement("div");
      fill.className = "fill";
      fill.style.width = (mode === "time" && s.avgTime != null ? pct(clamp(s.avgTime, 0, MS_YELLOW), MS_YELLOW) : s.acc) + "%";
      const val = document.createElement("div");
      val.className = "val";
      val.textContent = s.acc + "% • " + fmtMs(s.avgTime);
      bar.appendChild(fill);
      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(val);
      container.appendChild(row);
    });
  }

  function renderOperationBars(attempts) {
    const buckets = { "+": [], "-": [], "*": [], "/": [] };
    attempts.forEach(a => buckets[a.op].push(a));
    operationBars.innerHTML = "";

    getSelectedOps().forEach(op => {
      const s = attemptSummary(buckets[op]);
      const row = document.createElement("div");
      row.className = "bucket";
      const label = document.createElement("div");
      label.className = "name";
      label.textContent = OPS[op].label + " (" + s.total + ")";
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("div");
      fill.className = "fill";
      fill.style.width = s.acc + "%";
      const val = document.createElement("div");
      val.className = "val";
      val.textContent = s.acc + "% • " + fmtMs(s.avgTime);
      bar.appendChild(fill);
      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(val);
      operationBars.appendChild(row);
    });
  }

  function renderMostMissed(attempts) {
    mostMissed.innerHTML = "";
    const missed = new Map();
    attempts.forEach(a => {
      if (!a.ok) {
        const txt = a.a + " " + OPS[a.op].symbol + " " + a.b + " = " + a.correct;
        missed.set(txt, (missed.get(txt) || 0) + 1);
      }
    });

    const top = Array.from(missed.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) {
      const li = document.createElement("li");
      li.textContent = "No misses yet 🎉";
      mostMissed.appendChild(li);
      return;
    }

    top.forEach(pair => {
      const li = document.createElement("li");
      li.textContent = pair[0] + " — missed " + pair[1] + " time" + (pair[1] === 1 ? "" : "s");
      mostMissed.appendChild(li);
    });
  }

  function renderStatsAndInsights() {
    const attempts = flattenAttempts();
    const s = attemptSummary(attempts);
    const maxN = getMaxN();
    const completion = heatmapCompletion(maxN);

    stTotal.textContent = s.total;
    stCorrect.textContent = s.correct;
    stWrong.textContent = s.wrong;
    stAcc.textContent = s.acc + "%";
    stAvg.textContent = fmtMs(s.avgTime);
    stStreak.textContent = streak;
    stBest.textContent = bestStreak;

    renderOperationBars(attempts);

    const q1 = Math.max(5, Math.round(maxN * 0.5));
    const q2 = Math.max(10, maxN);
    const q3 = Math.max(20, maxN * 2);
    const rangeBuckets = {};
    rangeBuckets["≤" + q1] = [];
    rangeBuckets[(q1 + 1) + "–" + q2] = [];
    rangeBuckets[(q2 + 1) + "–" + q3] = [];
    rangeBuckets[(q3 + 1) + "+"] = [];
    const sizeBuckets = { Small: [], Medium: [], Big: [] };

    attempts.forEach(a => {
      rangeBuckets[bucketAnswerRange(a.correct, maxN)].push(a);
      sizeBuckets[bucketNumberSize(a.a, a.b, maxN)].push(a);
    });

    renderBucketBars(answerRangeBars, rangeBuckets);
    renderBucketBars(numberSizeBars, sizeBuckets);
    renderMostMissed(attempts);

    const note = document.querySelector(".insights-note");
    if (note) {
      note.textContent = completion.complete
        ? "Heatmap complete for the selected setup. Adaptive weighting is active with a gentle 10–20% bias toward weaker combinations."
        : "Filling heatmap first: " + completion.filled + " / " + completion.total + " combinations have data. Adaptive weighting starts when this is complete.";
    }

    drawAllCharts();
  }

  const C_GREEN = [34, 197, 94];
  const C_YELLOW = [234, 179, 8];
  const C_ORANGE = [249, 115, 22];
  const C_RED = [239, 68, 68];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpColor(c1, c2, t) {
    return "rgb(" + Math.round(lerp(c1[0], c2[0], t)) + "," + Math.round(lerp(c1[1], c2[1], t)) + "," + Math.round(lerp(c1[2], c2[2], t)) + ")";
  }

  function baseTimeRgb(avgTime) {
    if (avgTime == null) return null;
    const u = (clamp(avgTime, MS_GREEN, MS_YELLOW) - MS_GREEN) / (MS_YELLOW - MS_GREEN);
    return [Math.round(lerp(C_GREEN[0], C_YELLOW[0], u)), Math.round(lerp(C_GREEN[1], C_YELLOW[1], u)), Math.round(lerp(C_GREEN[2], C_YELLOW[2], u))];
  }

  function mixedColor(summary) {
    if (!summary.total) return "rgba(255,255,255,0.06)";
    if (summary.wrong === summary.total) return lerpColor(C_ORANGE, C_RED, 0.85);
    const base = baseTimeRgb(summary.avgTime) || C_YELLOW;
    if (!summary.failRate) return lerpColor(base, base, 0);
    const target = summary.failRate >= 0.5 ? C_RED : C_ORANGE;
    return lerpColor(base, target, clamp(summary.failRate * 1.35, 0, 1));
  }

  function resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height) * dpr);
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { w: rect.width, h: rect.height };
  }

  function axisStep(maxN) {
    if (maxN <= 20) return 1;
    if (maxN <= 50) return 5;
    return 10;
  }

  function drawPairHeatmap(canvas, ctx, op) {
    const pane = canvas.closest(".heat-pane");
    const visible = getSelectedOps().indexOf(op) >= 0;
    if (pane) pane.style.display = visible ? "" : "none";
    if (!visible) return;

    const maxN = getMaxN();
    const size = resizeCanvas(canvas, ctx);
    const w = size.w;
    const h = size.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, 0, w, h);

    const pad = 26;
    const gridW = w - pad - 6;
    const gridH = h - pad - 6;
    const cellW = gridW / maxN;
    const cellH = gridH / maxN;

    for (let a = 1; a <= maxN; a++) {
      for (let b = 1; b <= maxN; b++) {
        if (op === "-" && a < b) continue;
        ctx.fillStyle = mixedColor(comboSummary(op, a, b));
        ctx.fillRect(pad + (b - 1) * cellW, 4 + (a - 1) * cellH, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
      }
    }

    ctx.fillStyle = "rgba(255,255,255,.58)";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const step = axisStep(maxN);
    for (let i = 1; i <= maxN; i += step) {
      ctx.fillText(String(i), pad + (i - 0.5) * cellW, h - pad / 2);
      ctx.fillText(String(i), pad / 2, 4 + (i - 0.5) * cellH);
    }
  }

  function drawDivisionGraph() {
    const pane = heatDiv.closest(".heat-pane");
    const visible = getSelectedOps().indexOf("/") >= 0;
    if (pane) pane.style.display = visible ? "" : "none";
    if (!visible) return;

    const maxN = getMaxN();
    const size = resizeCanvas(heatDiv, ctxDiv);
    const w = size.w;
    const h = size.h;
    ctxDiv.clearRect(0, 0, w, h);
    ctxDiv.fillStyle = "rgba(255,255,255,0.03)";
    ctxDiv.fillRect(0, 0, w, h);

    const padL = 34, padB = 30, padT = 12, padR = 10;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const barW = chartW / maxN;

    for (let divisor = 1; divisor <= maxN; divisor++) {
      let allTimes = [];
      for (let q = 1; q <= maxN; q++) allTimes = allTimes.concat(getTimes("/", divisor * q, divisor));
      const attempts = allTimes.map(t => ({ ms: t, ok: !isFail(t) }));
      const s = attemptSummary(attempts);
      const failRate = s.total ? s.wrong / s.total : 0;
      const heightScore = s.avgTime == null ? 0 : clamp(s.avgTime, 0, MS_YELLOW) / MS_YELLOW;
      const barH = Math.max(2, chartH * clamp(heightScore + failRate * 0.35, 0, 1));
      ctxDiv.fillStyle = mixedColor({ total: s.total, wrong: s.wrong, failRate: failRate, avgTime: s.avgTime });
      ctxDiv.fillRect(padL + (divisor - 1) * barW + 1, padT + chartH - barH, Math.max(1, barW - 2), barH);
    }

    ctxDiv.strokeStyle = "rgba(255,255,255,.22)";
    ctxDiv.beginPath();
    ctxDiv.moveTo(padL, padT);
    ctxDiv.lineTo(padL, padT + chartH);
    ctxDiv.lineTo(padL + chartW, padT + chartH);
    ctxDiv.stroke();
    ctxDiv.fillStyle = "rgba(255,255,255,.58)";
    ctxDiv.font = "11px system-ui";
    ctxDiv.textAlign = "center";
    ctxDiv.textBaseline = "middle";
    const step = axisStep(maxN);
    for (let i = 1; i <= maxN; i += step) ctxDiv.fillText(String(i), padL + (i - 0.5) * barW, h - 13);
    ctxDiv.save();
    ctxDiv.translate(12, padT + chartH / 2);
    ctxDiv.rotate(-Math.PI / 2);
    ctxDiv.fillText("slower / weaker", 0, 0);
    ctxDiv.restore();
    ctxDiv.fillText("divisor", padL + chartW / 2, h - 4);
  }

  function drawAllCharts() {
    drawPairHeatmap(heatAdd, ctxAdd, "+");
    drawPairHeatmap(heatSub, ctxSub, "-");
    drawPairHeatmap(heatMul, ctxMul, "*");
    drawDivisionGraph();
  }

  function hitPairHeat(canvas, ev) {
    const rect = canvas.getBoundingClientRect();
    const maxN = getMaxN();
    const pad = 26;
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const gridW = rect.width - pad - 6;
    const gridH = rect.height - pad - 6;
    const b = Math.floor((mx - pad) / (gridW / maxN)) + 1;
    const a = Math.floor((my - 4) / (gridH / maxN)) + 1;
    if (a < 1 || b < 1 || a > maxN || b > maxN) return null;
    return { a: a, b: b };
  }

  function bindPairHover(canvas, op) {
    canvas.addEventListener("mousemove", ev => {
      const hit = hitPairHeat(canvas, ev);
      if (!hit || (op === "-" && hit.a < hit.b)) {
        heatTip.classList.add("hidden");
        return;
      }
      const s = comboSummary(op, hit.a, hit.b);
      const formula = hit.a + " " + OPS[op].symbol + " " + hit.b + " = " + correctFor(op, hit.a, hit.b);
      heatTip.textContent = s.total ? formula + " | n=" + s.total + ", acc=" + s.acc + "%, wrong=" + s.wrong + ", avg=" + fmtMs(s.avgTime) : formula + " | no data";
      heatTip.classList.remove("hidden");
      heatTip.style.left = ev.clientX + "px";
      heatTip.style.top = ev.clientY + "px";
    });
    canvas.addEventListener("mouseleave", () => heatTip.classList.add("hidden"));
  }

  function bindDivisionHover() {
    heatDiv.addEventListener("mousemove", ev => {
      const rect = heatDiv.getBoundingClientRect();
      const maxN = getMaxN();
      const padL = 34, padR = 10;
      const divisor = Math.floor((ev.clientX - rect.left - padL) / ((rect.width - padL - padR) / maxN)) + 1;
      if (divisor < 1 || divisor > maxN) {
        heatTip.classList.add("hidden");
        return;
      }
      let allTimes = [];
      for (let q = 1; q <= maxN; q++) allTimes = allTimes.concat(getTimes("/", divisor * q, divisor));
      const attempts = allTimes.map(t => ({ ms: t, ok: !isFail(t) }));
      const s = attemptSummary(attempts);
      heatTip.textContent = s.total ? "Divisor " + divisor + " | n=" + s.total + ", acc=" + s.acc + "%, wrong=" + s.wrong + ", avg=" + fmtMs(s.avgTime) : "Divisor " + divisor + " | no data";
      heatTip.classList.remove("hidden");
      heatTip.style.left = ev.clientX + "px";
      heatTip.style.top = ev.clientY + "px";
    });
    heatDiv.addEventListener("mouseleave", () => heatTip.classList.add("hidden"));
  }

  function onAnswerClick(e) {
    if (!current) return;
    const chosen = Number(e.currentTarget.dataset.value);
    const elapsedMs = Math.round(performance.now() - startTime);
    const ok = chosen === current.correct;

    recordAttempt(current.op, current.a, current.b, ok, elapsedMs);
    renderResults();
    lockButtons();

    if (ok) {
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      setFeedback("✅ Correct! (" + fmtMs(elapsedMs) + ")", "good");
    } else {
      streak = 0;
      setFeedback("❌ Oops! Correct answer is " + current.correct, "bad");
    }

    renderStatsAndInsights();
    setTimeout(nextProblem, 800);
  }

  function startGame() {
    started = true;
    startOverlay.classList.add("hidden");
    btnNew.disabled = false;
    setFeedback("", null);
    prevProblemKey = null;
    nextProblem();
  }

  function resetAll() {
    started = false;
    btnNew.disabled = true;
    startOverlay.classList.remove("hidden");
    current = null;
    prevProblemKey = null;
    streak = 0;
    setFeedback("", null);
    elLhs.textContent = "?";
    elOp.textContent = "+";
    elRhs.textContent = "?";
    elAnswers.innerHTML = "";
    renderResults();
    renderStatsAndInsights();
  }

  async function copyResults() {
    const text = JSON.stringify(Object.fromEntries(histMap.entries()), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("📋 History copied!", "good");
      setTimeout(() => setFeedback("", null), 900);
    } catch (err) {
      resultsWrap.classList.remove("hidden");
      btnToggleResults.textContent = "Hide";
      const range = document.createRange();
      range.selectNodeContents(elResultsPre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      setFeedback("Select the history and copy it manually.", "bad");
    }
  }

  function ensureOneOperation(btn) {
    if (!opButtons.querySelectorAll(".op-toggle.active").length) {
      btn.classList.add("active");
      setFeedback("Pick at least one operation.", "bad");
      setTimeout(() => setFeedback("", null), 900);
    }
  }

  btnStart.addEventListener("click", startGame);
  btnNew.addEventListener("click", () => { if (started) nextProblem(); });
  btnReset.addEventListener("click", resetAll);
  btnClearHistory.addEventListener("click", () => {
    clearHistory();
    resetAll();
    setFeedback("Saved history cleared.", "good");
    setTimeout(() => setFeedback("", null), 900);
  });
  elDifficulty.addEventListener("change", () => {
    prevProblemKey = null;
    if (started) nextProblem();
    renderStatsAndInsights();
  });
  elTheme.addEventListener("change", () => applyTheme(elTheme.value));
  opButtons.addEventListener("click", e => {
    const btn = e.target.closest(".op-toggle");
    if (!btn) return;
    btn.classList.toggle("active");
    ensureOneOperation(btn);
    prevProblemKey = null;
    if (started) nextProblem();
    renderStatsAndInsights();
  });
  btnToggleResults.addEventListener("click", () => {
    const hidden = resultsWrap.classList.toggle("hidden");
    btnToggleResults.textContent = hidden ? "Show" : "Hide";
  });
  btnCopy.addEventListener("click", copyResults);
  btnToggleInsights.addEventListener("click", () => {
    const hidden = elInsights.classList.toggle("hidden");
    btnToggleInsights.textContent = hidden ? "Show" : "Hide";
  });
  btnToggleHeat.addEventListener("click", () => {
    const hidden = heatWrap.classList.toggle("hidden");
    btnToggleHeat.textContent = hidden ? "Show" : "Hide";
    drawAllCharts();
  });

  bindPairHover(heatAdd, "+");
  bindPairHover(heatSub, "-");
  bindPairHover(heatMul, "*");
  bindDivisionHover();
  window.addEventListener("resize", drawAllCharts);

  applyTheme(localStorage.getItem(THEME_KEY) || "standard");
  renderResults();
  renderStatsAndInsights();
  drawAllCharts();
  startOverlay.classList.remove("hidden");
  btnNew.disabled = true;
})();
