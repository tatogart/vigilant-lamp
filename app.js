/* CodeClaw — офлайн код-ассистент на WebLLM (MLC) + WebGPU. */
"use strict";

const MODEL = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1";

const $ = (id) => document.getElementById(id);
const chatEl = $("chat"), inputEl = $("input"), sendBtn = $("send"),
      statusEl = $("status"), fillEl = $("fill"), loadText = $("load-text"),
      overlay = $("overlay");

let engine = null;
const history = [];
let deferredPrompt = null;

/* ---------- PWA: установка ---------- */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("install-btn").style.display = "inline-block";
  $("install-btn-2").style.display = "inline-block";
});
async function doInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("install-btn").style.display = "none";
  $("install-btn-2").style.display = "none";
}
$("install-btn").onclick = doInstall;
$("install-btn-2").onclick = doInstall;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------- Инициализация модели ---------- */
function setProgress(text, pct) {
  loadText.textContent = text;
  fillEl.style.width = pct + "%";
  statusEl.textContent = text;
}

async function init() {
  if (!navigator.gpu) {
    $("gpu-warn").style.display = "block";
    setProgress("WebGPU недоступен", 0);
    return;
  }
  try {
    engine = await webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (p) => {
        const t = p.text || "";
        if (p.progress !== undefined) {
          setProgress(`Модель: ${Math.round(p.progress)}%`, p.progress);
        } else {
          loadText.textContent = t.slice(0, 80);
        }
      },
    });
    overlay.classList.add("hidden");
    statusEl.textContent = "онлайн · офлайн-режим готов";
    sendBtn.disabled = false;
    inputEl.focus();
  } catch (err) {
    console.error(err);
    setProgress("Ошибка загрузки модели: " + err.message, 0);
  }
}

/* ---------- Рендер сообщений ---------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderAssistant(text) {
  // Простейший рендер: код-блоки ``` ... ``` в <pre><code>, остальное текст.
  const parts = text.split(/```/);
  let html = "";
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      const nl = p.indexOf("\n");
      const lang = nl > 0 ? p.slice(0, nl).trim() : "";
      const code = nl > 0 ? p.slice(nl + 1) : p;
      html += `<pre><button class="copy-btn">копировать</button><code>${escapeHtml(code)}</code></pre>`;
    } else {
      html += escapeHtml(p);
    }
  });
  return html;
}

function addMsg(role, text, streaming = false) {
  const div = document.createElement("div");
  div.className = "msg " + role + (streaming ? " streaming" : "");
  if (role === "assistant") {
    div.innerHTML = renderAssistant(text);
    div.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.onclick = () => {
        navigator.clipboard.writeText(btn.parentElement.querySelector("code").textContent);
        btn.textContent = "скопировано ✓";
        setTimeout(() => (btn.textContent = "копировать"), 1500);
      };
    });
  } else {
    div.textContent = text;
  }
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

/* ---------- Чат ---------- */
async function send() {
  const text = inputEl.value.trim();
  if (!text || !engine) return;
  inputEl.value = "";
  addMsg("user", text);

  history.push({ role: "user", content: text });
  const replyEl = addMsg("assistant", "", true);
  sendBtn.disabled = true;
  statusEl.textContent = "генерация…";

  let reply = "";
  try {
    const chunks = await engine.chat.completions.create({
      messages: [
        { role: "system", content:
          "Ты — компактный код-ассистент. Отвечай кратко, код давай в блоках ```. На русском, если пишут по-русски." },
        ...history.slice(-10),
      ],
      temperature: 0.3,
      max_tokens: 800,
      stream: true,
    });
    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta?.content || "";
      reply += delta;
      replyEl.innerHTML = renderAssistant(reply);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  } catch (err) {
    reply = "Ошибка: " + err.message;
    replyEl.textContent = reply;
  }
  replyEl.classList.remove("streaming");
  // Перепривяжем кнопки копирования на финальный рендер
  replyEl.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.onclick = () => {
      navigator.clipboard.writeText(btn.parentElement.querySelector("code").textContent);
      btn.textContent = "скопировано ✓";
      setTimeout(() => (btn.textContent = "копировать"), 1500);
    };
  });
  history.push({ role: "assistant", content: reply });
  sendBtn.disabled = false;
  statusEl.textContent = "онлайн · офлайн-режим готов";
}

sendBtn.onclick = send;
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});

init();
