
let summarizerInstance = null;
let lmSession = null;
let writerInstance = null;
let rewriterInstance = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const ui = {
  tabs: $$('.tab'),
  panels: $$('.panel'),
  mode: $('#mode'),
  length: $('#length'),
  askInput: $('#ask-input'),
  writeInput: $('#write-input'),
  tone: $('#tone'),
  writeLength: $('#write-length'),
  rewriteInput: $('#rewrite-input'),
  rewriteGoal: $('#rewrite-goal'),
  btnSummarize: $('#btn-run-summarize'),
  btnAsk: $('#btn-run-ask'),
  btnWrite: $('#btn-run-write'),
  btnRewrite: $('#btn-run-rewrite'),
  btnCopy: $('#btn-copy'),
  btnExport: $('#btn-export'),
  status: $('#status'),
  progress: $('.progress'),
  progressBar: $('#progress-bar'),
  result: $('#result'),
  historyBtn: $('#btn-history'),
  historyDialog: $('#history-dialog'),
  historyList: $('#history-list'),
  historyClose: $('#close-history'),
  settingsBtn: $('#btn-settings'),
  settingsDialog: $('#settings-dialog'),
  settingsSave: $('#save-settings'),
  useReadability: $('#use-readability'),
  preferYt: $('#prefer-yt'),
  lang: $('#lang'),
  themeBtn: $('#btn-theme')
};

function setStatus(msg, cls=""){ ui.status.classList.remove('hidden'); ui.status.className = 'status'; if (cls) ui.status.classList.add(cls); ui.status.textContent = msg; }
function clearStatus(){ ui.status.classList.add('hidden'); ui.status.textContent = ''; }
function setProgress(p){ ui.progress.classList.remove('hidden'); ui.progressBar.style.width = `${Math.max(0, Math.min(100, p*100)).toFixed(0)}%`; if (p>=1) setTimeout(()=> ui.progress.classList.add('hidden'), 400); }
function renderMarkdown(md){
  // Very small, safe-ish renderer (subset), inspired by marked usage
  const escapeHtml = (s)=> s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  if (!md) return '';
  // Normalize newlines
  md = md.replace(/\r\n?/g,'\n');
  // Fenced code blocks ```lang\ncode\n```
  md = md.replace(/```([\s\S]*?)```/g, (m, code)=> `<pre><code>${escapeHtml(code.trim())}</code></pre>`);
  // Inline code `code`
  md = md.replace(/`([^`]+)`/g, (m, code)=> `<code>${escapeHtml(code)}</code>`);
  // Headings # .. ######
  md = md.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
         .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
         .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
         .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
         .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
         .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // Bold and italic (basic, non-nested)
  md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Lists (unordered)
  md = md.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
  md = md.replace(/(<li>.*<\/li>\n?)+/g, m=> `<ul>${m.replace(/\n/g,'')}</ul>`);
  // Ordered lists
  md = md.replace(/^\d+\. (.*)$/gm, '<li>$1</li>');
  md = md.replace(/(<li>.*<\/li>\n?)+/g, m=> m.includes('<ul>')?m:`<ol>${m.replace(/\n/g,'')}</ol>`);
  // Paragraphs: wrap leftover text blocks
  md = md.split(/\n{2,}/).map(block=>{
    if (/^\s*<(h\d|ul|ol|pre)/.test(block)) return block;
    if (!block.trim()) return '';
    return `<p>${block.replace(/\n/g,'<br/>')}</p>`;
  }).join('\n');
  return md;
}
function setResult(text){ ui.result.innerHTML = renderMarkdown((text||'').trim()); }
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function beginSkeleton(){
  ui.result.classList.add('skeleton');
  ui.result.textContent = '';
}
function endSkeleton(){ ui.result.classList.remove('skeleton'); }

chrome.storage.local.get({ useReadability: true, preferYt: true, lang: 'en' }, (cfg)=> {
  if (ui.useReadability) ui.useReadability.checked = cfg.useReadability;
  if (ui.preferYt) ui.preferYt.checked = cfg.preferYt;
  if (ui.lang) ui.lang.value = cfg.lang;
});

ui.tabs.forEach(tab=> tab.addEventListener('click', ()=> {
  ui.tabs.forEach(t=> t.classList.remove('active'));
  ui.panels.forEach(p=> p.classList.remove('active'));
  tab.classList.add('active');
  $('#panel-'+tab.dataset.tab).classList.add('active');
  clearStatus();
  setResult('');
}));

ui.settingsBtn.addEventListener('click', ()=> ui.settingsDialog.showModal());
ui.settingsSave.addEventListener('click', ()=> {
  const lang = ui.lang ? ui.lang.value : 'en';
  chrome.storage.local.set({
    useReadability: ui.useReadability?.checked ?? true,
    preferYt: ui.preferYt?.checked ?? true,
    lang
  }, ()=> ui.settingsDialog.close());
});
$('#close-settings').addEventListener('click', ()=> ui.settingsDialog.close());

// Theme toggle
ui.themeBtn?.addEventListener('click', ()=>{
  const isLight = document.documentElement.classList.toggle('theme-light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

ui.historyBtn.addEventListener('click', renderHistory);
ui.historyClose.addEventListener('click', ()=> ui.historyDialog.close());

function saveHistory(entry){
  chrome.storage.local.get({ history: [] }, data => {
    const list = data.history;
    list.unshift(entry);
    while(list.length>50) list.pop();
    chrome.storage.local.set({ history: list });
  });
}

function renderHistory(){
  chrome.storage.local.get({ history: [] }, data => {
    const list = data.history;
    if (!list.length){ ui.historyList.innerHTML = '<p class="small">No history yet.</p>'; }
    else {
      ui.historyList.innerHTML = list.map(item => `
        <div class="history-item">
          <h4>${escapeHtml(item.title || '(No title)')}</h4>
          <time>${new Date(item.ts).toLocaleString()}</time>
          <div class="small">${escapeHtml(item.url || '')}</div>
          <pre class="small">${escapeHtml(item.output.slice(0, 600))}${item.output.length>600?'…':''}</pre>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button data-copy="${encodeURIComponent(item.output)}" class="ghost">Copy</button>
            <button data-export="${encodeURIComponent(item.output)}" class="ghost">Export</button>
          </div>
        </div>`).join('');
      ui.historyList.querySelectorAll('button[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
          const text = decodeURIComponent(btn.dataset.copy);
          navigator.clipboard.writeText(text);
        });
      });
      ui.historyList.querySelectorAll('button[data-export]').forEach(btn => {
        btn.addEventListener('click', () => {
          const text = decodeURIComponent(btn.dataset.export);
          exportMarkdown(text);
        });
      });
    }
    ui.historyDialog.showModal();
  });
}

async function getSetting(key, def){ return new Promise(res=> chrome.storage.local.get({ [key]: def }, o=> res(o[key]))); }

// Safe stream collector: handles ReadableStream<Uint8Array> and async-iterable<string|Uint8Array>
async function collectStream(stream){
  let out = '';
  try {
    if (!stream) return out;
    if (typeof stream.getReader === 'function'){
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true){
        const { value, done } = await reader.read();
        if (done) break;
        if (typeof value === 'string') out += value;
        else if (value instanceof Uint8Array) out += decoder.decode(value, { stream: true });
        else if (value?.buffer) out += decoder.decode(value.buffer, { stream: true });
      }
      return out;
    }
    if (Symbol.asyncIterator in Object(stream)){
      const decoder = new TextDecoder();
      for await (const chunk of stream){
        if (typeof chunk === 'string') out += chunk;
        else if (chunk instanceof Uint8Array) out += decoder.decode(chunk, { stream: true });
        else if (chunk?.buffer) out += decoder.decode(chunk.buffer, { stream: true });
      }
      return out;
    }
    if (typeof stream === 'string') return stream;
  } catch(e){ /* ignore */ }
  return out;
}

// Extraction with YouTube transcript preference
async function extractActiveTabText(){
  const [{id: tabId, url, title}] = await chrome.tabs.query({ active: true, currentWindow: true });
  const preferYt = await getSetting('preferYt', true);
  const useReadability = await getSetting('useReadability', true);

  if (preferYt && /^https?:\/\/(www\.)?youtube\.com\/watch/.test(url)){
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          const urlParams = new URLSearchParams(location.search);
          const vid = urlParams.get('v');
          if (!vid) return null;
          const langs = ['en','en-US','en-GB','hi','auto','a.en'];
          const tryFetch = async (lang) => {
            const eps = [
              `https://www.youtube.com/api/timedtext?v=${vid}&lang=${encodeURIComponent(lang)}&fmt=vtt`,
              `https://www.youtube.com/api/timedtext?v=${vid}&lang=${encodeURIComponent(lang)}`
            ];
            for (const ep of eps){
              const resp = await fetch(ep, { credentials: 'include' });
              if (resp.ok){
                const text = await resp.text();
                if (text && text.length > 50) return { lang, text, endpoint: ep };
              }
            }
            return null;
          };
          let found = null;
          for (const l of langs){ try { found = await tryFetch(l); } catch{} if (found) break; }
          if (!found) return null;
          const strip = (s) => s.replace(/<[^>]+>/g,' ').replace(/\r/g,'').replace(/^\uFEFF/,'');
          let lines = strip(found.text).split('\n');
          const out = [];
          for (let i=0;i<lines.length;i++){
            const line = lines[i].trim();
            if (!line) continue;
            if (/^WEBVTT/i.test(line)) continue;
            if (/-->/i.test(line)){
              const ts = line.split('-->')[0].trim();
              const parts = ts.split(':').map(x=>x.trim());
              let stamp = '';
              if (parts.length >= 2){
                const h = parts.length===3 ? parseInt(parts[0],10) : 0;
                const m = parseInt(parts[parts.length-2],10);
                const s = Math.floor(parseFloat(parts[parts.length-1]));
                const mm = (h*60 + m).toString().padStart(2,'0');
                stamp = `[${mm}:${s.toString().padStart(2,'0')}]`;
              }
              let textLine = '';
              let j = i+1;
              while (j<lines.length && lines[j].trim() && !/-->/i.test(lines[j])){ textLine += (textLine?' ':'') + lines[j].trim(); j++; }
              if (textLine) out.push(`${stamp} ${textLine}`);
            }
          }
          const finalText = out.join('\n');
          const title = document.title || '';
          return { title, text: finalText || '' };
        },
      });
      if (result && result.text) return { tabId, url, title: result.title || title, text: result.text, pageTitle: result.title || title };
    } catch(e){ /* ignore and fall back */ }
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (useReadability) => {
      function basicExtract(){
        const title = document.title || '';
        const text = (document.body && document.body.innerText) ? document.body.innerText : '';
        return { title, text: text.slice(0, 250000) };
      }
      if (!useReadability) return basicExtract();
      try {
        const article = document.querySelector('article');
        if (article && article.innerText && article.innerText.split(/\s+/).length > 150){
          return { title: document.title || '', text: article.innerText.slice(0, 250000) };
        }
        const candidates = Array.from(document.querySelectorAll('main, #main, .content, #content, .post, .article, .entry, .story'))
          .map(el => (el.innerText || '').trim())
          .filter(t => t && t.split(/\s+/).length > 150)
          .sort((a,b)=> b.length - a.length);
        if (candidates.length) return { title: document.title || '', text: candidates[0].slice(0, 250000) };
      } catch(e){}
      return basicExtract();
    },
    args: [useReadability]
  });
  return { tabId, url, title, text: result?.text || '', pageTitle: result?.title || title || '' };
}

// On-device API helpers with explicit language
async function ensureSummarizerReady(mode, length){
  const availability = await Summarizer.availability();
  if (availability === 'unavailable') throw new Error("Summarizer unavailable on this device");
  if (!navigator.userActivation?.isActive) throw new Error("Click again to activate the on-device model (user gesture required).");
  const lang = await getSetting('lang','en');
  if (!summarizerInstance){
    const typeMap = { tldr:'tldr', keypoints:'key-points', paragraph:'tldr' };
    summarizerInstance = await Summarizer.create({
      type: typeMap[mode] || 'key-points',
      length: length || 'medium',
      format: 'markdown',
      language: lang,
      monitor(m){ m.addEventListener('downloadprogress', e => setProgress(e.loaded || 0)); }
    });
  }
  return summarizerInstance;
}
async function ensurePromptReady(){
  const avail = await LanguageModel.availability();
  if (avail === 'unavailable') throw new Error("Prompt API unavailable");
  if (!navigator.userActivation?.isActive) throw new Error("Click again to activate the on-device model (user gesture required).");
  if (!lmSession){
    lmSession = await LanguageModel.create({
      monitor(m){ m.addEventListener('downloadprogress', e => setProgress(e.loaded || 0)); }
    });
  }
  return lmSession;
}
async function ensureWriterReady(ctx=''){
  const avail = await Writer.availability();
  if (avail === 'unavailable') throw new Error("Writer unavailable (origin-trial or device)");
  if (!navigator.userActivation?.isActive) throw new Error("Click again to activate the on-device model (user gesture required).");
  if (!writerInstance){
    const lang = await getSetting('lang','en');
    const requestedTone = $('#tone')?.value || 'neutral';
    const toneMap = {
      // Map UI values to valid WriterTone enums
      neutral: 'neutral',
      teaching: 'teaching',
      persuasive: 'persuasive',
      friendly: 'casual' // 'friendly' is not valid; use closest valid tone
    };
    const resolvedTone = toneMap[requestedTone] || 'neutral';
    writerInstance = await Writer.create({
      tone: resolvedTone,
      format: 'markdown',
      length: $('#write-length')?.value || 'medium',
      sharedContext: ctx,
      language: lang,
      monitor(m){ m.addEventListener('downloadprogress', e => setProgress(e.loaded || 0)); }
    });
  }
  return writerInstance;
}
async function ensureRewriterReady(){
  const avail = await Rewriter.availability();
  if (avail === 'unavailable') throw new Error("Rewriter unavailable (origin-trial or device)");
  if (!navigator.userActivation?.isActive) throw new Error("Click again to activate the on-device model (user gesture required).");
  if (!rewriterInstance){
    const lang = await getSetting('lang','en');
    rewriterInstance = await Rewriter.create({
      tone: 'as-is', length: 'as-is', format: 'markdown', language: lang,
      monitor(m){ m.addEventListener('downloadprogress', e => setProgress(e.loaded || 0)); }
    });
  }
  return rewriterInstance;
}

// Actions
$('#btn-run-summarize').addEventListener('click', async () => {
  try {
    ui.btnSummarize.classList.add('btn-loading');
    setProgress(0); setStatus('Preparing summarizer…');
    const mode = ui.mode.value; const length = ui.length.value;
    const summarizer = await ensureSummarizerReady(mode, length);
    setStatus('Extracting text…');
    beginSkeleton();
    const { url, pageTitle, text } = await extractActiveTabText();
    setStatus('Summarizing…');
    let out = '';
    if (summarizer.summarizeStreaming){
      const stream = await summarizer.summarizeStreaming(text, { context: 'General audience' });
      out = await collectStream(stream);
    } else {
      out = await summarizer.summarize(text, { context: 'General audience' });
    }
    setResult(out); clearStatus(); setProgress(1);
    endSkeleton();
    saveHistory({ ts: Date.now(), url, title: pageTitle, output: out, kind: 'summarize', mode, length });
  } catch (e) { setStatus(e.message || String(e), 'error'); setProgress(0); }
  finally { ui.btnSummarize.classList.remove('btn-loading'); }
});

$('#btn-run-ask').addEventListener('click', async () => {
  try {
    ui.btnAsk.classList.add('btn-loading');
    setProgress(0); setStatus('Preparing model…');
    const session = await ensurePromptReady();
    setStatus('Extracting text…');
    beginSkeleton();
    const { url, pageTitle, text } = await extractActiveTabText();
    setStatus('Answering…');
    const q = ui.askInput.value.trim(); if (!q) throw new Error('Ask a question first.');
    let out = '';
    if (session.promptStreaming){
      const rs = await session.promptStreaming(`Context:\n${text.slice(0, 20000)}\n\nQuestion:\n${q}`);
      out = await collectStream(rs);
    } else {
      out = await session.prompt(`Context:\n${text.slice(0, 20000)}\n\nQuestion:\n${q}`);
    }
    setResult(out); clearStatus(); setProgress(1);
    endSkeleton();
    saveHistory({ ts: Date.now(), url, title: pageTitle, output: out, kind: 'ask', q });
  } catch (e) { setStatus(e.message || String(e), 'error'); setProgress(0); }
  finally { ui.btnAsk.classList.remove('btn-loading'); }
});

$('#btn-run-write').addEventListener('click', async () => {
  try {
    ui.btnWrite.classList.add('btn-loading');
    setProgress(0); setStatus('Preparing writer…');
    const writer = await ensureWriterReady('');
    setStatus('Writing…');
    beginSkeleton();
    const instruction = ui.writeInput.value.trim(); if (!instruction) throw new Error('Describe what to write.');
    const out = await writer.write(instruction);
    setResult(out); clearStatus(); setProgress(1);
    endSkeleton();
    saveHistory({ ts: Date.now(), url: '', title: 'Writer', output: out, kind: 'write', instruction });
  } catch (e) { setStatus(e.message || String(e), 'error'); setProgress(0); }
  finally { ui.btnWrite.classList.remove('btn-loading'); }
});

$('#btn-run-rewrite').addEventListener('click', async () => {
  try {
    ui.btnRewrite.classList.add('btn-loading');
    setProgress(0); setStatus('Preparing rewriter…');
    const rewriter = await ensureRewriterReady();
    setStatus('Rewriting…');
    beginSkeleton();
    const text = ui.rewriteInput.value.trim(); if (!text) throw new Error('Paste some text first.');
    const out = await rewriter.rewrite(text);
    setResult(out); clearStatus(); setProgress(1);
    endSkeleton();
    saveHistory({ ts: Date.now(), url: '', title: 'Rewriter', output: out, kind: 'rewrite' });
  } catch (e) { setStatus(e.message || String(e), 'error'); setProgress(0); }
  finally { ui.btnRewrite.classList.remove('btn-loading'); }
});

$('#btn-copy').addEventListener('click', async () => {
  const txt = ui.result.textContent || '';
  if (!txt) return;
  await navigator.clipboard.writeText(txt);
  setStatus('Copied to clipboard', 'success');
  setTimeout(clearStatus, 1200);
});
$('#btn-export').addEventListener('click', ()=> exportMarkdown(ui.result.textContent || ''));

function exportMarkdown(text){
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'summary.md'; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
}
