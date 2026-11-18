(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = "mathPractice_hist_v3";
  const LOG_KEY = "mathPractice_log_v1";
  const SETTINGS_KEY = "mathPractice_settings_v1";
  const THEME_KEY = "mathPractice_theme_v1";
  const SOUND_KEY = "mathPractice_sound_v1";

  const MAX_KEEP_PER_COMBO = 5;
  const MAX_LOG = 5000;
  const SESSION_GAP_MS = 20 * 60 * 1000;

  const MS_GREEN = 3000;
  const MS_YELLOW = 15000;
  const SCORE_CAP_MS = 20000;

  const OLD_FAIL_TIME = 16000;
  const FAIL_TIME = -1;

  const MAX_GAIN = 1 / 3;
  const MIN_GAIN = 0.05;
  const WRONG_PENALTY = 0.25;

  const RANGE_MIN = 1;
  const RANGE_MAX = 100;
  const TABLE_LEN = 10;

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

  const range = (from, to) => {
    const out = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
  };

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

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
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

    rangeLo: $("rangeLo"),
    rangeHi: $("rangeHi"),
    numLo: $("numLo"),
    numHi: $("numHi"),
    rangeFill: $("rangeFill"),
    rangeHint: $("rangeHint"),
    tenOnly: $("tenOnly"),

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

    btnToggleLedger: $("btnToggleLedger"),
    ledgerWrap: $("ledgerWrap"),
    ledgerBody: $("ledgerBody"),
    periodButtons: $("periodButtons"),

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

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let started = false;
  let current = null;
  let prevProblemKey = null;
  let startTime = 0;

  let sessionStars = 0;
  let starProgress = 0;

  let soundOn = storageGet(SOUND_KEY) !== "off";
  let audioEl = null;

  let ledgerPeriod = "session";
  let tenFallback = false;

  const histMap = loadHistMap();
  const log = loadLog();

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
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  // ---------------------------------------------------------------------------
  // Storage: per-problem history (drives the adaptive picking + heatmaps)
  // ---------------------------------------------------------------------------

  function loadHistMap() {
    const parsed = safeParse(storageGet(STORAGE_KEY), null);
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
    storageSet(
      STORAGE_KEY,
      JSON.stringify({ v: 3, data: Object.fromEntries(histMap.entries()) })
    );
  }

  // ---------------------------------------------------------------------------
  // Storage: timestamped log of every answer (drives the Recent Practice ledger)
  // Entry: [timestamp, op, a, b, givenAnswer, ms]
  // ---------------------------------------------------------------------------

  function loadLog() {
    const parsed = safeParse(storageGet(LOG_KEY), []);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(e =>
      Array.isArray(e) && e.length >= 6 && OPS[e[1]] && Number.isFinite(e[0])
    );
  }

  function saveLog() {
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    storageSet(LOG_KEY, JSON.stringify(log));
  }

  function logEntry(e) {
    const [t, op, a, b, ans, ms] = e;
    const correct = correctFor(op, a, b);
    return { t, op, a, b, ans, ms, correct, ok: ans === correct };
  }

  function clearHistory() {
    histMap.clear();
    log.length = 0;

    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LOG_KEY);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Problem keys / history lookup
  // ---------------------------------------------------------------------------

  function keyFor(op, a, b) {
    return `${op}:${a},${b}`;
  }

  function getTimes(op, a, b) {
    const times = histMap.get(keyFor(op, a, b));

    return Array.isArray(times)
      ? times.map(normalizeTime).filter(v => v != null)
      : [];
  }

  function recordAttempt(op, a, b, given, elapsedMs) {
    const ok = given === correctFor(op, a, b);
    const times = getTimes(op, a, b);

    times.push(ok ? elapsedMs : FAIL_TIME);
    histMap.set(keyFor(op, a, b), times.slice(-MAX_KEEP_PER_COMBO));
    saveHistMap();

    log.push([Date.now(), op, a, b, given, elapsedMs]);
    saveLog();
  }

  // ---------------------------------------------------------------------------
  // Settings: number range, operations, cross-the-ten
  // ---------------------------------------------------------------------------

  function getRange() {
    return {
      lo: Number(els.rangeLo.value),
      hi: Number(els.rangeHi.value)
    };
  }

  function getSelectedOps() {
    const active = Array.from(
      els.opButtons.querySelectorAll(".op-toggle.active")
    )
      .map(btn => btn.dataset.op)
      .filter(op => OPS[op]);

    return active.length ? active : ["+"];
  }

  function saveSettings() {
    const { lo, hi } = getRange();

    storageSet(SETTINGS_KEY, JSON.stringify({
      lo,
      hi,
      ops: getSelectedOps(),
      tenOnly: els.tenOnly.checked
    }));
  }

  function loadSettings() {
    const s = safeParse(storageGet(SETTINGS_KEY), null);
    if (!s) return;

    if (Number.isFinite(s.lo) && Number.isFinite(s.hi)) {
      setRange(s.lo, s.hi);
    }

    if (Array.isArray(s.ops) && s.ops.length) {
      els.opButtons.querySelectorAll(".op-toggle").forEach(btn => {
        btn.classList.toggle("active", s.ops.includes(btn.dataset.op));
      });
    }

    els.tenOnly.checked = !!s.tenOnly;
  }

  function setRange(lo, hi) {
    lo = clamp(Math.round(lo), RANGE_MIN, RANGE_MAX);
    hi = clamp(Math.round(hi), RANGE_MIN, RANGE_MAX);
    if (lo > hi) [lo, hi] = [hi, lo];

    els.rangeLo.value = lo;
    els.rangeHi.value = hi;
    renderRangeUi();
  }

  function renderRangeUi() {
    const { lo, hi } = getRange();
    const span = RANGE_MAX - RANGE_MIN;

    if (document.activeElement !== els.numLo) els.numLo.value = lo;
    if (document.activeElement !== els.numHi) els.numHi.value = hi;

    els.rangeFill.style.left = `${((lo - RANGE_MIN) / span) * 100}%`;
    els.rangeFill.style.right = `${100 - ((hi - RANGE_MIN) / span) * 100}%`;

    // When the thumbs overlap, keep on top the one that can still move.
    els.rangeLo.style.zIndex = lo > (RANGE_MIN + RANGE_MAX) / 2 ? 3 : 1;
    els.rangeHi.style.zIndex = 2;

    const r = lo === hi ? `${lo}` : `${lo}–${hi}`;
    const parts = [];
    const ops = getSelectedOps();

    if (ops.includes("+")) parts.push(`+ answers ${r}`);
    if (ops.includes("-")) parts.push(`− from ${r}`);
    if (ops.includes("*")) parts.push(`× tables ${r}`);
    if (ops.includes("/")) parts.push(`÷ by ${r}`);

    let hint = parts.join(" · ");
    if (tenFallback) hint += " · (no cross-the-ten problems in this range)";
    els.rangeHint.textContent = hint;
  }

  // ---------------------------------------------------------------------------
  // Operations / question generation
  // ---------------------------------------------------------------------------

  function correctFor(op, a, b) {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    return a / b;
  }

  // Crossing the ten: 8+5, 16−7 (ones digits need carrying / borrowing).
  function crossesTen(op, a, b) {
    if (op === "+") return (a % 10) + (b % 10) >= 10;
    if (op === "-") return (a % 10) < (b % 10);
    return true;
  }

  // The range controls the "starting number":
  //   +  the answer (sum)          −  the number subtracted from
  //   ×  the times table           ÷  the number divided by
  function pairsFor(op, lo, hi) {
    const pairs = [];

    if (op === "+") {
      for (let sum = Math.max(lo, 2); sum <= Math.max(hi, 2); sum++) {
        for (let b = 1; b < sum; b++) pairs.push([sum - b, b]);
      }
    } else if (op === "-") {
      for (let a = lo; a <= hi; a++) {
        for (let b = 1; b <= a; b++) pairs.push([a, b]);
      }
    } else if (op === "*") {
      for (let t = lo; t <= hi; t++) {
        for (let f = 1; f <= TABLE_LEN; f++) pairs.push([f, t]);
      }
    } else if (op === "/") {
      for (let t = lo; t <= hi; t++) {
        for (let q = 1; q <= TABLE_LEN; q++) pairs.push([t * q, t]);
      }
    }

    return pairs;
  }

  function selectedQuestionSet() {
    const { lo, hi } = getRange();
    const ops = getSelectedOps();
    const all = ops.flatMap(op =>
      pairsFor(op, lo, hi).map(([a, b]) => ({ op, a, b }))
    );

    tenFallback = false;
    if (!els.tenOnly.checked) return all;

    const filtered = all.filter(q => crossesTen(q.op, q.a, q.b));

    if (!filtered.length) {
      tenFallback = true;
      return all;
    }

    return filtered;
  }

  function summarize(times) {
    const attempts = times.map(ms => ({ ms, ok: !isFail(ms) }));
    const total = attempts.length;
    const correct = attempts.filter(x => x.ok).length;
    const wrong = total - correct;

    return {
      total,
      correct,
      wrong,
      acc: pct(correct, total),
      failRate: total ? wrong / total : 0,
      avgTime: avg(attempts.filter(x => x.ok).map(x => scoredMs(x.ms)))
    };
  }

  function comboSummary(op, a, b) {
    return summarize(getTimes(op, a, b));
  }

  function comboWeight(op, a, b) {
    const summary = comboSummary(op, a, b);

    if (!summary.total) return 1;

    const slowScore =
      summary.avgTime == null
        ? 0
        : clamp((summary.avgTime - MS_GREEN) / (MS_YELLOW - MS_GREEN), 0, 1);

    const confidence = Math.min(1, summary.total / 3);
    const boost = clamp(
      summary.failRate * 0.6 * confidence + slowScore * 0.3 * confidence,
      0,
      0.85
    );

    return (1 + boost) * (0.97 + Math.random() * 0.06);
  }

  function pickNewQuestionFirst(items) {
    const unseen = items.filter(item =>
      getTimes(item.op, item.a, item.b).length === 0
    );

    if (!unseen.length) return null;

    for (let i = 0; i < 20; i++) {
      const candidate = unseen[randInt(0, unseen.length - 1)];
      const key = keyFor(candidate.op, candidate.a, candidate.b);

      if (key !== prevProblemKey || unseen.length === 1) return candidate;
    }

    return unseen[randInt(0, unseen.length - 1)];
  }

  function makeProblem() {
    const items = selectedQuestionSet();
    let picked = pickNewQuestionFirst(items);

    if (!picked) {
      const weights = items.map(item => comboWeight(item.op, item.a, item.b));
      picked = weightedPick(items, weights);

      for (let i = 0; i < 14; i++) {
        if (keyFor(picked.op, picked.a, picked.b) !== prevProblemKey) break;
        picked = weightedPick(items, weights);
      }
    }

    prevProblemKey = keyFor(picked.op, picked.a, picked.b);

    return {
      op: picked.op,
      a: picked.a,
      b: picked.b,
      correct: correctFor(picked.op, picked.a, picked.b)
    };
  }

  // Wrong choices include the classic slips (off by one, off by ten, the
  // neighbouring table answer) so mistakes tell us something.
  function buildChoices({ op, a, b, correct }) {
    const targetCount = 8;
    const options = new Set([correct]);
    const valid = v => Number.isInteger(v) && v >= 0 && v !== correct;

    let likely;
    if (op === "*") likely = [correct + b, correct - b, correct + a, correct - a, correct + 1, correct - 1, correct + 10, correct - 10];
    else if (op === "/") likely = [correct + 1, correct - 1, correct + 2, correct - 2];
    else likely = [correct + 1, correct - 1, correct + 10, correct - 10, correct + 2, correct - 2];

    shuffle(likely.filter(valid))
      .slice(0, 4)
      .forEach(v => options.add(v));

    const radius = op === "*" ? Math.max(10, b * 3) : Math.max(5, Math.round(correct * 0.3));
    let guard = 0;

    while (options.size < targetCount && guard++ < 500) {
      const candidate = correct + randInt(-radius, radius);
      if (candidate >= 0) options.add(candidate);
    }

    return shuffle(Array.from(options));
  }

  // ---------------------------------------------------------------------------
  // Feedback / UI
  // ---------------------------------------------------------------------------

  function setFeedback(message, type) {
    els.feedback.textContent = message || "";
    els.feedback.classList.remove("good", "bad");
    if (type) els.feedback.classList.add(type);
  }

  function flash(message, type) {
    setFeedback(message, type);
    setTimeout(() => setFeedback("", null), 900);
  }

  function lockButtons() {
    els.answers.querySelectorAll("button").forEach(btn => {
      btn.disabled = true;
    });
  }

  function renderResults() {
    els.resultsPre.textContent = JSON.stringify(
      Object.fromEntries(histMap.entries()),
      null,
      2
    );

    const items = selectedQuestionSet();
    const filled = items.filter(i => getTimes(i.op, i.a, i.b).length > 0).length;

    els.historySub.textContent = filled >= items.length
      ? "Every problem in the range has been tried. The app now favours the ones that need practice."
      : `Trying every problem once first: ${filled} / ${items.length} done. Raw times are stored; failed = -1.`;
  }

  function applyTheme(theme) {
    document.body.classList.remove("theme-dark", "theme-pink");

    if (theme === "dark") document.body.classList.add("theme-dark");
    if (theme === "pink") document.body.classList.add("theme-pink");

    els.theme.value = theme;
    storageSet(THEME_KEY, theme);

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
    requestAnimationFrame(rewardLoop);
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
    if (!summary.total) return "rgba(128,128,128,0.14)";
    if (summary.wrong === summary.total) {
      return lerpColor(COLORS.orange, COLORS.red, 0.85);
    }

    const base = baseTimeRgb(summary.avgTime) || COLORS.yellow;

    if (!summary.failRate) return lerpColor(base, base, 0);

    return lerpColor(
      base,
      summary.failRate >= 0.5 ? COLORS.red : COLORS.orange,
      clamp(summary.failRate * 1.35, 0, 1)
    );
  }

  // ---------------------------------------------------------------------------
  // Heatmap drawing: one grid per operation, rows follow the selected range.
  // ---------------------------------------------------------------------------

  function gridSpec(op) {
    const { lo, hi } = getRange();

    if (op === "+") {
      const rows = range(Math.max(lo, 2), Math.max(hi, 2));
      return {
        rows,
        cols: range(1, rows[rows.length - 1] - 1),
        cell: (sum, b) => (b < sum ? { a: sum - b, b } : null)
      };
    }

    if (op === "-") {
      return {
        rows: range(lo, hi),
        cols: range(1, hi),
        cell: (a, b) => (b <= a ? { a, b } : null)
      };
    }

    if (op === "*") {
      return {
        rows: range(lo, hi),
        cols: range(1, TABLE_LEN),
        cell: (t, f) => ({ a: f, b: t })
      };
    }

    return {
      rows: range(lo, hi),
      cols: range(1, TABLE_LEN),
      cell: (t, q) => ({ a: t * q, b: t })
    };
  }

  function labelStep(count, px, minPx) {
    return Math.max(1, Math.ceil(count / Math.max(1, px / minPx)));
  }

  function drawHeatmap(canvas, op) {
    const pane = canvas.closest(".heat-pane");
    const visible = getSelectedOps().includes(op);

    if (pane) pane.style.display = visible ? "" : "none";
    if (!visible || els.heatWrap.classList.contains("hidden")) return;

    const spec = gridSpec(op);
    const padL = 30;
    const padT = 4;
    const padR = 4;
    const padB = 20;

    const w = canvas.getBoundingClientRect().width;
    const cellW = (w - padL - padR) / spec.cols.length;
    const h = clamp(spec.rows.length * cellW, 60, 460) + padT + padB;

    canvas.style.height = `${h}px`;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);

    const cellH = (h - padT - padB) / spec.rows.length;

    spec.rows.forEach((r, ri) => {
      spec.cols.forEach((c, ci) => {
        const pair = spec.cell(r, c);
        if (!pair) return;

        context.fillStyle = mixedColor(comboSummary(op, pair.a, pair.b));
        context.fillRect(
          padL + ci * cellW,
          padT + ri * cellH,
          Math.max(1, cellW - 1),
          Math.max(1, cellH - 1)
        );
      });
    });

    context.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#999";
    context.font = "11px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";

    const colStep = labelStep(spec.cols.length, w - padL - padR, 20);
    spec.cols.forEach((c, ci) => {
      if (ci % colStep === 0) {
        context.fillText(String(c), padL + (ci + 0.5) * cellW, h - padB / 2);
      }
    });

    const rowStep = labelStep(spec.rows.length, h - padT - padB, 14);
    spec.rows.forEach((r, ri) => {
      if (ri % rowStep === 0) {
        context.fillText(String(r), padL / 2, padT + (ri + 0.5) * cellH);
      }
    });

    canvas._layout = { op, spec, padL, padT, cellW, cellH };
  }

  function drawAllCharts() {
    drawHeatmap(els.heatAdd, "+");
    drawHeatmap(els.heatSub, "-");
    drawHeatmap(els.heatMul, "*");
    drawHeatmap(els.heatDiv, "/");
  }

  function bindHover(canvas) {
    canvas.addEventListener("mousemove", ev => {
      const L = canvas._layout;
      if (!L) return;

      const rect = canvas.getBoundingClientRect();
      const ci = Math.floor((ev.clientX - rect.left - L.padL) / L.cellW);
      const ri = Math.floor((ev.clientY - rect.top - L.padT) / L.cellH);
      const r = L.spec.rows[ri];
      const c = L.spec.cols[ci];
      const pair = r != null && c != null ? L.spec.cell(r, c) : null;

      if (!pair) {
        els.heatTip.classList.add("hidden");
        return;
      }

      const summary = comboSummary(L.op, pair.a, pair.b);
      const formula =
        `${pair.a} ${OPS[L.op].symbol} ${pair.b} = ${correctFor(L.op, pair.a, pair.b)}`;

      els.heatTip.textContent = summary.total
        ? `${formula} | tries ${summary.total}, right ${summary.acc}%, avg ${fmtMs(summary.avgTime)}`
        : `${formula} | not tried yet`;

      els.heatTip.classList.remove("hidden");
      els.heatTip.style.left = `${ev.clientX}px`;
      els.heatTip.style.top = `${ev.clientY}px`;
    });

    canvas.addEventListener("mouseleave", () => {
      els.heatTip.classList.add("hidden");
    });
  }

  // ---------------------------------------------------------------------------
  // Recent Practice ledger
  // ---------------------------------------------------------------------------

  const dayKey = t => new Date(t).toDateString();

  const fmtDay = t => new Date(t).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  });

  const fmtClock = t => new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  function splitSessions(entries) {
    const sessions = [];

    entries.forEach(e => {
      const last = sessions[sessions.length - 1];
      const prev = last && last[last.length - 1];

      if (prev && e.t - prev.t <= SESSION_GAP_MS && dayKey(e.t) === dayKey(prev.t)) {
        last.push(e);
      } else {
        sessions.push([e]);
      }
    });

    return sessions;
  }

  function entriesForPeriod() {
    const all = log.map(logEntry);
    if (!all.length) return [];

    if (ledgerPeriod === "session") {
      const sessions = splitSessions(all);
      return sessions[sessions.length - 1];
    }

    const days = ledgerPeriod === "today" ? 1 : ledgerPeriod === "3d" ? 3 : 7;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (days - 1));

    return all.filter(e => e.t >= from.getTime());
  }

  function groupLabels(e) {
    const labels = [];

    if (e.op === "+" || e.op === "-") {
      const word = e.op === "+" ? "Adding" : "Subtracting";
      labels.push(crossesTen(e.op, e.a, e.b)
        ? `${word}, crossing the ten`
        : `${word}, no crossing`);
    }

    if (e.op === "+") labels.push(`Adding ${Math.min(e.a, e.b)}`);
    if (e.op === "-") labels.push(`Taking away ${e.b}`);
    if (e.op === "*") labels.push(`${e.b} times table`);
    if (e.op === "/") labels.push(`Dividing by ${e.b}`);

    return labels;
  }

  function groupStats(list) {
    const okTimes = list.filter(e => e.ok).map(e => scoredMs(e.ms));
    const right = list.filter(e => e.ok).length;

    return {
      n: list.length,
      acc: pct(right, list.length),
      avgTime: avg(okTimes)
    };
  }

  function troubleScore(s) {
    const slow = s.avgTime == null
      ? 1
      : clamp((s.avgTime - MS_GREEN) / (MS_YELLOW - MS_GREEN), 0, 1);

    return (100 - s.acc) / 100 * 2 + slow;
  }

  function renderTroubleTable(entries) {
    const groups = new Map();

    entries.forEach(e => {
      groupLabels(e).forEach(label => {
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(e);
      });
    });

    const rows = Array.from(groups.entries())
      .map(([label, list]) => ({ label, ...groupStats(list) }))
      .filter(r => r.n >= 3)
      .sort((x, y) => troubleScore(y) - troubleScore(x))
      .slice(0, 10);

    if (!rows.length) {
      return `<div class="empty-note">Needs at least 3 tries of a kind of problem.</div>`;
    }

    const body = rows.map(r => {
      const cls = r.acc < 80 ? "weak" : (r.avgTime ?? 0) > 8000 ? "slow" : "";

      return `<tr class="${cls}"><td>${r.label}</td>` +
        `<td class="num">${r.n}</td>` +
        `<td class="num"><span class="accbar"><i style="width:${r.acc}%"></i></span>${r.acc}%</td>` +
        `<td class="num">${fmtMs(r.avgTime)}</td></tr>`;
    }).join("");

    return `<table class="trouble"><thead><tr><th>Kind of problem</th><th>Tries</th><th>Right</th><th>Avg time</th></tr></thead><tbody>${body}</tbody></table>` +
      `<div class="small-note">Hardest first. Red = under 80% right, orange = slow (over 8s).</div>`;
  }

  function renderMistakes(entries) {
    const wrong = entries.filter(e => !e.ok);

    if (!wrong.length) {
      return `<div class="empty-note">No mistakes in this period. 🎉</div>`;
    }

    const kinds = { one: 0, ten: 0, other: 0 };

    wrong.forEach(e => {
      const d = Math.abs(e.ans - e.correct);
      if (d === 1) kinds.one++;
      else if (d === 10) kinds.ten++;
      else kinds.other++;
    });

    const byFact = new Map();

    entries.forEach(e => {
      const k = keyFor(e.op, e.a, e.b);
      if (!byFact.has(k)) byFact.set(k, []);
      byFact.get(k).push(e);
    });

    const missed = Array.from(byFact.values())
      .map(list => ({ list, wrong: list.filter(e => !e.ok).length }))
      .filter(f => f.wrong > 0)
      .sort((x, y) => y.wrong - x.wrong || y.list.length - x.list.length)
      .slice(0, 10)
      .map(({ list }) => {
        const e = list[0];
        const marks = list
          .map(x => (x.ok ? `<span class="mk-ok">✓</span>` : `<span class="mk-bad">✗</span>`))
          .join("");

        return `<div>${e.a} ${OPS[e.op].symbol} ${e.b} = ${e.correct}<span class="marks">${marks}</span></div>`;
      })
      .join("");

    return `<div class="missed">${missed}</div>` +
      `<div class="small-note">Wrong answers: ${kinds.one} off by 1, ${kinds.ten} off by 10, ${kinds.other} other.` +
      (kinds.ten ? " Off by 10 often means a slip when crossing the ten." : "") +
      (kinds.one ? " Off by 1 often means counting slips." : "") +
      `</div>`;
  }

  function chipHtml(e) {
    const sym = OPS[e.op].symbol;
    const slow = e.ok && e.ms > 8000;
    const cls = e.ok ? (slow ? "chip slow" : "chip") : "chip bad";
    const title = `${fmtClock(e.t)} · ${fmtMs(e.ms)}`;
    const answer = e.ok ? `${e.correct}` : `<s>${e.ans}</s> ${e.correct}`;

    return `<span class="${cls}" title="${title}">${e.a} ${sym} ${e.b} = ${answer}<small>${fmtMs(scoredMs(e.ms))}</small></span>`;
  }

  function renderLedgerList(entries) {
    const sessions = splitSessions(entries).reverse();
    let html = "";
    let lastDay = null;

    sessions.forEach(s => {
      const day = dayKey(s[0].t);

      if (day !== lastDay) {
        html += `<div class="day-head">${fmtDay(s[0].t)}</div>`;
        lastDay = day;
      }

      const st = groupStats(s);

      html += `<div class="session-head">${fmtClock(s[0].t)}–${fmtClock(s[s.length - 1].t)} · ` +
        `${st.n} problems · ${st.acc}% right · avg ${fmtMs(st.avgTime)}</div>` +
        `<div class="chips">${s.map(chipHtml).join("")}</div>`;
    });

    return html;
  }

  function renderLedger() {
    if (els.ledgerWrap.classList.contains("hidden")) return;

    const entries = entriesForPeriod();

    if (!entries.length) {
      els.ledgerBody.innerHTML =
        `<div class="empty-note">No practice recorded in this period yet.</div>`;
      return;
    }

    const st = groupStats(entries);

    els.ledgerBody.innerHTML =
      `<div class="ledger-summary">${st.n} problems · ${st.acc}% right · average ${fmtMs(st.avgTime)}</div>` +
      `<div class="ledger-cols">` +
      `<div class="ledger-box"><h3>Trouble spots</h3>${renderTroubleTable(entries)}</div>` +
      `<div class="ledger-box"><h3>Most missed</h3>${renderMistakes(entries)}</div>` +
      `</div>` +
      renderLedgerList(entries);
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

    buildChoices(problem).forEach(value => {
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

    recordAttempt(current.op, current.a, current.b, selected, rawMs);
    lockButtons();

    if (ok) {
      addStarProgress(rewardGain(rawMs));
      setFeedback(`✅ Correct! (${fmtMs(scoredMs(rawMs))})`, "good");
    } else {
      starProgress = Math.max(0, starProgress - WRONG_PENALTY);
      setFeedback(`❌ Oops! Correct answer is ${current.correct}`, "bad");
    }

    refreshPanels();
    renderRewardCluster();

    setTimeout(nextProblem, 800);
  }

  function refreshPanels() {
    renderResults();
    renderLedger();
    drawAllCharts();
  }

  function settingsChanged() {
    prevProblemKey = null;
    selectedQuestionSet();
    renderRangeUi();
    saveSettings();

    if (started) nextProblem();

    refreshPanels();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function copyResults() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(Object.fromEntries(histMap.entries()), null, 2)
      );
      flash("📋 History copied!", "good");
    } catch {
      els.resultsWrap.classList.remove("hidden");
      els.btnToggleResults.textContent = "Hide";
    }
  }

  function ensureOneOperation(btn) {
    if (els.opButtons.querySelectorAll(".op-toggle.active").length) return;

    btn.classList.add("active");
    flash("Pick at least one operation.", "bad");
  }

  function toggleSection(section, button) {
    const hidden = section.classList.toggle("hidden");
    button.textContent = hidden ? "Show" : "Hide";
    return hidden;
  }

  function commitNumberInput(input, which) {
    const n = parseInt(input.value, 10);
    const { lo, hi } = getRange();

    if (Number.isFinite(n)) {
      if (which === "lo") setRange(n, Math.max(n, hi));
      else setRange(Math.min(lo, n), n);
      settingsChanged();
    } else {
      renderRangeUi();
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  els.btnStart.addEventListener("click", startGame);

  els.btnClearHistory.addEventListener("click", () => {
    if (!confirm("Delete all saved practice history on this computer?")) return;

    clearHistory();
    refreshPanels();
    flash("Saved history cleared.", "good");
  });

  els.rangeLo.addEventListener("input", () => {
    if (Number(els.rangeLo.value) > Number(els.rangeHi.value)) {
      els.rangeLo.value = els.rangeHi.value;
    }
    renderRangeUi();
  });

  els.rangeHi.addEventListener("input", () => {
    if (Number(els.rangeHi.value) < Number(els.rangeLo.value)) {
      els.rangeHi.value = els.rangeLo.value;
    }
    renderRangeUi();
  });

  els.rangeLo.addEventListener("change", settingsChanged);
  els.rangeHi.addEventListener("change", settingsChanged);

  [[els.numLo, "lo"], [els.numHi, "hi"]].forEach(([input, which]) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("change", () => commitNumberInput(input, which));
    input.addEventListener("keydown", ev => {
      if (ev.key === "Enter") input.blur();
      if (ev.key === "Escape") {
        renderRangeUi();
        input.blur();
      }
    });
    input.addEventListener("blur", () => renderRangeUi());
  });

  els.tenOnly.addEventListener("change", settingsChanged);

  els.theme.addEventListener("change", () => applyTheme(els.theme.value));

  els.btnSound.addEventListener("click", () => {
    soundOn = !soundOn;
    storageSet(SOUND_KEY, soundOn ? "on" : "off");
    updateSoundButton();
  });

  els.opButtons.addEventListener("click", e => {
    const btn = e.target.closest(".op-toggle");
    if (!btn) return;

    btn.classList.toggle("active");
    ensureOneOperation(btn);
    settingsChanged();
  });

  els.periodButtons.addEventListener("click", e => {
    const btn = e.target.closest(".period");
    if (!btn) return;

    ledgerPeriod = btn.dataset.period;
    els.periodButtons.querySelectorAll(".period").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
    renderLedger();
  });

  els.btnToggleLedger.addEventListener("click", () => {
    toggleSection(els.ledgerWrap, els.btnToggleLedger);
    renderLedger();
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

  [els.heatAdd, els.heatSub, els.heatMul, els.heatDiv].forEach(bindHover);

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  initSound();
  updateSoundButton();
  loadSettings();
  selectedQuestionSet();
  renderRangeUi();
  applyTheme(storageGet(THEME_KEY) || "standard");

  refreshPanels();
  rewardLoop();

  els.startOverlay.classList.remove("hidden");
})();
