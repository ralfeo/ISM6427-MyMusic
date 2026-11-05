// MyMusic — front end. Talks only to our own /api/* Netlify Functions,
// which hold the Suno API key server-side.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORE_KEY = "mymusic.jobs.v1";
const PW_KEY = "mymusic.pw";
const POLL_MS = 8000;
const MAX_POLL_MS = 15 * 60 * 1000; // give up after 15 minutes
const FAILED = new Set(["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "SENSITIVE_WORD_ERROR", "GENERATE_LYRICS_FAILED"]);
const STATUS_LABEL = {
  PENDING: "Queued…",
  TEXT_SUCCESS: "Writing lyrics…",
  FIRST_SUCCESS: "First track ready — finishing…",
  SUCCESS: "Done",
  CREATE_TASK_FAILED: "Failed",
  GENERATE_AUDIO_FAILED: "Failed",
  SENSITIVE_WORD_ERROR: "Blocked content",
  CALLBACK_EXCEPTION: "Done",
};
const ERROR_HINTS = {
  401: "Not authorized. Check the app password, or the SUNO_API_KEY on the server.",
  405: "Rate limit hit — please wait a moment and try again.",
  413: "Your description or lyrics are too long.",
  429: "Out of credits on the Suno API account.",
  430: "Too many requests — slow down a little and try again.",
  455: "The music service is under maintenance. Try again shortly.",
};

const IDEAS = [
  "A cozy lo-fi hip hop beat for studying on a rainy afternoon",
  "An epic orchestral trailer theme with choir and big drums",
  "A heartfelt acoustic country ballad about coming home",
  "A high-energy 80s synthwave track for a night drive",
  "A funny reggae song about a cat who hates Mondays",
  "A dreamy bedroom-pop love song with soft female vocals",
];
const STYLES = ["pop", "hip hop", "lo-fi", "rock", "EDM", "jazz", "R&B", "country", "cinematic", "synthwave", "acoustic", "latin"];

let mode = "simple";
let jobs = loadJobs();
const timers = new Map();

/* ---------------- API ---------------- */

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const pw = localStorage.getItem(PW_KEY) || $("#appPassword").value;
  if (pw) headers["x-app-password"] = pw;
  let res, data;
  try {
    res = await fetch(path, { ...opts, headers });
    data = await res.json();
  } catch {
    throw new Error("Couldn't reach the server. Are you online?");
  }
  if (res.ok && Number(data.code) === 200) return data.data;

  const code = Number(data?.code) || res.status;
  if (res.status === 401 && /app password/i.test(data?.msg || "")) {
    $("#passwordField").hidden = false;
    localStorage.removeItem(PW_KEY);
  }
  const err = new Error(ERROR_HINTS[code] && !(code === 401 && data?.msg) ? ERROR_HINTS[code] : data?.msg || ERROR_HINTS[code] || `Request failed (${code})`);
  err.code = code;
  throw err;
}

/* ---------------- Storage ---------------- */

function loadJobs() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveJobs() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(jobs.slice(0, 60)));
  } catch { /* storage full or blocked — app still works this session */ }
}

/* ---------------- UI: composer ---------------- */

function setMode(next) {
  mode = next;
  $$(".tab").forEach((t) => {
    const on = t.dataset.mode === next;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  $(".mode-simple").hidden = next !== "simple";
  $(".mode-custom").hidden = next !== "custom";
  $$(".custom-only").forEach((el) => (el.hidden = next !== "custom"));
  syncInstrumental();
}

function syncInstrumental() {
  const inst = $("#instrumental").checked;
  $(".lyrics-field").style.opacity = inst && mode === "custom" ? 0.45 : 1;
  $("#vocalGender").disabled = inst;
}

function showError(msg) {
  const el = $("#error");
  el.textContent = msg || "";
  el.hidden = !msg;
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (label) (btn.querySelector(".btn-label") || btn).textContent = label;
}

function buildChips() {
  const ideaBox = $("#ideaChips");
  IDEAS.forEach((idea) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = idea.split(" ").slice(1, 5).join(" ") + "…";
    b.title = idea;
    b.onclick = () => {
      $("#prompt").value = idea;
      updateCount("prompt");
    };
    ideaBox.append(b);
  });
  const styleBox = $("#styleChips");
  STYLES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = "+ " + s;
    b.onclick = () => {
      const cur = $("#style").value.trim();
      const parts = cur ? cur.split(/\s*,\s*/) : [];
      if (!parts.map((p) => p.toLowerCase()).includes(s.toLowerCase())) parts.push(s);
      $("#style").value = parts.join(", ");
    };
    styleBox.append(b);
  });
}

function updateCount(id) {
  const el = $(`#${id}`);
  const c = $(`.count[data-for="${id}"]`);
  if (c) c.textContent = `${el.value.length} / ${el.maxLength}`;
}

function collectForm() {
  const v = (id) => $(`#${id}`).value.trim();
  const body = {
    customMode: mode === "custom",
    instrumental: $("#instrumental").checked,
    model: v("model"),
    style: v("style"),
  };
  if (mode === "simple") {
    body.prompt = v("prompt");
  } else {
    Object.assign(body, {
      title: v("title"),
      lyrics: v("lyrics"),
      negativeTags: v("negativeTags"),
      vocalGender: body.instrumental ? "" : v("vocalGender"),
      duration: v("duration"),
    });
    for (const id of ["styleWeight", "weirdnessConstraint"]) {
      const el = $(`#${id}`);
      if (!el.dataset.untouched) body[id] = Number(el.value);
    }
  }
  return body;
}

function validate(body) {
  if (!body.customMode && !body.prompt && !body.style) return "Describe the song you want (or add a style).";
  if (body.customMode) {
    if (!body.style && !body.lyrics && !body.negativeTags) return "Add a style or some lyrics.";
    if (!body.instrumental && !body.lyrics) return "Add lyrics — or tap ✨ Write with AI, or switch on Instrumental.";
    if (body.duration && (body.duration < 10 || body.duration > 360)) return "Length must be between 10 and 360 seconds.";
  }
  return null;
}

async function onGenerate(e) {
  e.preventDefault();
  showError("");
  const pwInput = $("#appPassword").value.trim();
  if (pwInput) localStorage.setItem(PW_KEY, pwInput);

  const body = collectForm();
  const problem = validate(body);
  if (problem) return showError(problem);

  const btn = $("#generateBtn");
  setBusy(btn, true, "Starting…");
  try {
    const data = await api("/api/generate", { method: "POST", body: JSON.stringify(body) });
    const job = {
      taskId: data.taskId,
      createdAt: Date.now(),
      label: body.customMode ? body.title || body.style || "Custom song" : body.prompt || body.style,
      detail: [body.model.replace("_", " "), body.instrumental ? "Instrumental" : "Vocals", body.customMode ? "Custom" : "Simple"].join(" · "),
      status: "PENDING",
      tracks: [],
    };
    jobs.unshift(job);
    saveJobs();
    render();
    poll(job.taskId);
    refreshCredits();
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(btn, false, "Generate music");
  }
}

/* ---------------- AI lyrics ---------------- */

async function onAiLyrics() {
  const prompt = $("#lyricsPrompt").value.trim() || $("#title").value.trim() || $("#style").value.trim();
  if (!prompt) {
    $("#lyricsPrompt").focus();
    return showError("Tell the AI what your lyrics should be about.");
  }
  showError("");
  const btn = $("#aiLyricsGo");
  setBusy(btn, true, "Writing…");
  try {
    const { taskId } = await api("/api/lyrics", { method: "POST", body: JSON.stringify({ prompt }) });
    const started = Date.now();
    while (Date.now() - started < 3 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 4000));
      const info = await api(`/api/status?type=lyrics&taskId=${encodeURIComponent(taskId)}`);
      if (FAILED.has(info?.status)) throw new Error(info.errorMessage || "Lyrics generation failed.");
      const first = info?.response?.data?.find((d) => d.text);
      if (first) {
        $("#lyrics").value = first.text;
        if (!$("#title").value.trim() && first.title) $("#title").value = first.title;
        updateCount("lyrics");
        $("#aiLyricsBox").hidden = true;
        refreshCredits();
        return;
      }
    }
    throw new Error("Lyrics are taking too long. Please try again.");
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(btn, false, "Generate");
  }
}

/* ---------------- Polling ---------------- */

function extractTracks(info) {
  const list = info?.response?.sunoData || info?.response?.data || [];
  return list
    .filter((t) => t && (t.audio_url || t.stream_audio_url || t.audioUrl || t.streamAudioUrl))
    .map((t) => ({
      id: t.id,
      title: t.title || "Untitled",
      tags: t.tags || "",
      image: t.image_url || t.imageUrl || "",
      audio: t.audio_url || t.audioUrl || "",
      stream: t.stream_audio_url || t.streamAudioUrl || "",
      duration: t.duration || 0,
      lyrics: t.prompt || "",
    }));
}

function poll(taskId) {
  clearTimeout(timers.get(taskId));
  const tick = async () => {
    const job = jobs.find((j) => j.taskId === taskId);
    if (!job) return;
    try {
      const info = await api(`/api/status?taskId=${encodeURIComponent(taskId)}`);
      const tracks = extractTracks(info);
      if (tracks.length) job.tracks = tracks;
      job.status = info?.status || job.status;
      if (FAILED.has(job.status)) job.error = info.errorMessage || STATUS_LABEL[job.status];
    } catch (err) {
      job.lastError = err.message;
      if (err.code === 401) job.status = "PAUSED";
    }
    const allDone = job.tracks.length > 0 && job.tracks.every((t) => t.audio);
    if (job.status === "CALLBACK_EXCEPTION" && allDone) job.status = "SUCCESS";
    if (job.status === "SUCCESS" && !allDone && Date.now() - job.createdAt < MAX_POLL_MS) job.status = "FIRST_SUCCESS";

    const terminal = job.status === "SUCCESS" || FAILED.has(job.status) || job.status === "PAUSED";
    if (!terminal && Date.now() - job.createdAt > MAX_POLL_MS) {
      job.status = job.tracks.length ? "SUCCESS" : "GENERATE_AUDIO_FAILED";
      if (!job.tracks.length) job.error = "Timed out waiting for the music.";
    }
    saveJobs();
    renderJob(job);
    if (!(job.status === "SUCCESS" || FAILED.has(job.status) || job.status === "PAUSED")) {
      timers.set(taskId, setTimeout(tick, POLL_MS));
    } else {
      timers.delete(taskId);
      if (job.status === "SUCCESS") refreshCredits();
    }
  };
  timers.set(taskId, setTimeout(tick, 2500));
}

/* ---------------- UI: library ---------------- */

const fmtTime = (s) => {
  if (!s) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
};
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

function render() {
  const box = $("#jobs");
  box.replaceChildren(...jobs.map(buildJob));
  $("#empty").hidden = jobs.length > 0;
  $("#clearBtn").hidden = jobs.length === 0;
}

function renderJob(job) {
  const old = $(`.job[data-task="${CSS.escape(job.taskId)}"]`);
  if (!old) return render();
  old.replaceWith(buildJob(job));
}

function buildJob(job) {
  const el = $("#jobTpl").content.firstElementChild.cloneNode(true);
  el.dataset.task = job.taskId;
  $(".job-title", el).textContent = job.label || "Untitled";
  $(".job-sub", el).textContent = `${job.detail || ""} · ${ago(job.createdAt)}`;

  const failed = FAILED.has(job.status);
  const done = job.status === "SUCCESS";
  const status = $(".status", el);
  status.textContent = job.status === "PAUSED" ? "Paused — enter password" : STATUS_LABEL[job.status] || "Working…";
  status.classList.toggle("done", done);
  status.classList.toggle("failed", failed);
  el.classList.toggle("finished", done || failed || job.status === "PAUSED");

  $(".remove", el).onclick = () => {
    clearTimeout(timers.get(job.taskId));
    jobs = jobs.filter((j) => j.taskId !== job.taskId);
    saveJobs();
    render();
  };

  const tracks = $(".tracks", el);
  if (failed) {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = job.error || "Generation failed. Try rephrasing your description.";
    tracks.append(p);
  }
  job.tracks.forEach((t) => tracks.append(buildTrack(t)));
  return el;
}

function buildTrack(t) {
  const el = $("#trackTpl").content.firstElementChild.cloneNode(true);
  el.dataset.id = t.id;
  const img = $("img", el);
  if (t.image) img.src = t.image;
  else img.remove();
  $(".t-title", el).textContent = t.title;
  $(".t-tags", el).textContent = t.tags;
  $(".t-dur", el).textContent = t.audio ? fmtTime(t.duration) : "Streaming preview · final file coming";

  const dl = $(".download", el);
  if (t.audio) {
    dl.href = t.audio;
    dl.setAttribute("download", `${t.title}.mp3`);
  } else {
    dl.setAttribute("aria-disabled", "true");
  }

  const lyr = $(".t-lyrics", el);
  const lbtn = $(".lyrics-btn", el);
  if (t.lyrics) {
    lyr.textContent = t.lyrics;
    lbtn.onclick = () => (lyr.hidden = !lyr.hidden);
  } else {
    lbtn.remove();
  }

  const audio = $("#audio");
  const src = t.audio || t.stream;
  if (audio.dataset.id === t.id && !audio.paused) el.classList.add("playing");
  $(".art", el).onclick = () => play(t, src);
  return el;
}

function play(t, src) {
  const audio = $("#audio");
  if (audio.dataset.id === t.id) {
    audio.paused ? audio.play() : audio.pause();
    return;
  }
  audio.dataset.id = t.id;
  audio.src = src;
  $("#player").hidden = false;
  $("#playerTitle").textContent = t.title;
  $("#playerTags").textContent = t.tags;
  const art = $("#playerArt");
  art.src = t.image || "";
  art.style.visibility = t.image ? "visible" : "hidden";
  audio.play().catch(() => {});
}

function markPlaying() {
  const audio = $("#audio");
  $$(".track").forEach((el) => el.classList.toggle("playing", el.dataset.id === audio.dataset.id && !audio.paused));
}

/* ---------------- Credits ---------------- */

async function refreshCredits() {
  try {
    const n = await api("/api/credits");
    $("#credits").textContent = `Credits: ${Number(n).toLocaleString()}`;
  } catch (err) {
    $("#credits").textContent = err.code === 401 ? "Credits: locked" : "Credits: —";
  }
}

/* ---------------- Boot ---------------- */

function init() {
  buildChips();
  $$(".tab").forEach((t) => (t.onclick = () => setMode(t.dataset.mode)));
  $("#instrumental").onchange = syncInstrumental;
  $("#form").addEventListener("submit", onGenerate);
  ["prompt", "lyrics"].forEach((id) => $(`#${id}`).addEventListener("input", () => updateCount(id)));
  $("#aiLyricsBtn").onclick = () => {
    $("#aiLyricsBox").hidden = !$("#aiLyricsBox").hidden;
    if (!$("#aiLyricsBox").hidden) $("#lyricsPrompt").focus();
  };
  $("#aiLyricsGo").onclick = onAiLyrics;
  $("#lyricsPrompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAiLyrics();
    }
  });
  [["styleWeight", "styleWeightOut"], ["weirdnessConstraint", "weirdOut"]].forEach(([id, out]) => {
    $(`#${id}`).addEventListener("input", (e) => {
      delete e.target.dataset.untouched;
      $(`#${out}`).textContent = Number(e.target.value).toFixed(2);
    });
  });
  $("#clearBtn").onclick = () => {
    if (!confirm("Remove all tracks from this list? (Downloaded files are not affected.)")) return;
    timers.forEach(clearTimeout);
    timers.clear();
    jobs = [];
    saveJobs();
    render();
  };
  $("#appPassword").addEventListener("change", (e) => {
    const pw = e.target.value.trim();
    if (!pw) return;
    localStorage.setItem(PW_KEY, pw);
    refreshCredits();
    jobs.filter((j) => j.status === "PAUSED").forEach((j) => {
      j.status = "PENDING";
      poll(j.taskId);
    });
  });

  const audio = $("#audio");
  ["play", "pause", "ended"].forEach((ev) => audio.addEventListener(ev, markPlaying));

  setMode("simple");
  render();
  refreshCredits();
  // Resume any unfinished jobs from a previous visit.
  jobs.filter((j) => !(j.status === "SUCCESS" || FAILED.has(j.status))).forEach((j) => poll(j.taskId));
}

init();
