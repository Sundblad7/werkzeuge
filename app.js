/* =====================================================================
   Höher geht immer · Die Werkzeuge — PWA
   Variante A: die Vorlage evolviert. Render-Engine, Markup und Verhalten
   stammen 1:1 aus reference/Werkzeug-App-Vorlage.html; ergänzt um
   Daten aus werkzeuge.json, Deep-Link-Routing, Notiz-Historie und PWA.
   ===================================================================== */

/* ---------- DATEN (aus werkzeuge.json) ---------- */
let PHASES = [];   // [[ "k1", "Kapitel 1 · Der Anlauf" ], ...]
let TOOLS  = [];   // internes Modell, kompatibel zur Vorlage (typ, l/h/amp, opts)

// Flaggschiff zuerst im Schnellzugriff (CLAUDE.md: „prominent platzieren")
const QUICK_IDS = ["absprung", "zweituren", "decisionfriday", "vertrauen"];

// Wiederkehrende Werkzeuge (SPEC §6). Dezent kennzeichnen; bei festem Takt
// einen Kalender-Eintrag (.ics) anbieten – server-freier Ersatz für Push.
const RECURRING = {
  decisionfriday: { tag: "Routine · wöchentlich, freitags", cal: { rrule: "FREQ=WEEKLY;BYDAY=FR", weekday: 5, time: "16:00" } },
  stresstest:     { tag: "Routine · quartalsweise",         cal: { rrule: "FREQ=MONTHLY;INTERVAL=3", time: "10:00" } },
  befoerderung:   { tag: "Routine · quartalsweise",         cal: { rrule: "FREQ=MONTHLY;INTERVAL=3", time: "10:00" } },
  vorabend:       { tag: "Routine · vor wichtigen Terminen" }
};
const recurrenceOf = id => RECURRING[id];
const calBtn = id => (RECURRING[id] && RECURRING[id].cal)
  ? '<button class="btn ghost" onclick="downloadICS(\'' + id + '\')">In den Kalender</button>' : '';

/* ---------- STATE (lokal im Browser gespeichert) ---------- */
const SKEY = "hgi_werkzeuge_v1";          // Arbeitsstände je Werkzeug (wie Vorlage)
const EKEY = "hgi_werkzeuge_entries_v1";  // datierte Notiz-Einträge (neu)
const state = {};      // { toolId: {choice, lead, f, a} }  – der lebende Entwurf
let entries = [];      // [ {id, toolId, createdAt, updatedAt, values:{choice,lead,f,a}} ]
let current = null;    // aktive toolId (Entwurfsansicht)
let editingEntry = null; // aktiver Eintrag (Notiz-Bearbeitung) oder null

const blankState = () => ({ choice: null, lead: "", f: {}, a: {} });
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
                   : "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

function saveState(){ try{ localStorage.setItem(SKEY, JSON.stringify(state)); flashSaved(); }catch(e){} }
function loadState(){
  TOOLS.forEach(t => state[t.id] = blankState());
  try{ const raw = localStorage.getItem(SKEY); if(raw){ const d = JSON.parse(raw);
    TOOLS.forEach(t => { if(d[t.id]) state[t.id] = Object.assign(blankState(), d[t.id]); }); } }catch(e){}
}
function saveEntries(){ try{ localStorage.setItem(EKEY, JSON.stringify(entries)); flashSaved(); }catch(e){} updateNotesBadge(); }
function loadEntries(){ try{ const raw = localStorage.getItem(EKEY); entries = raw ? JSON.parse(raw) : []; }catch(e){ entries = []; } }

function resetAll(){
  if(!confirm("Wirklich alle Eingaben in allen Werkzeugen löschen? Gespeicherte Notizen bleiben erhalten."))return;
  TOOLS.forEach(t => state[t.id] = blankState()); saveState();
  toast("Alle Arbeitsstände zurückgesetzt"); go("/");
}
let _svt; function flashSaved(){ const e = document.getElementById("saved"); if(!e)return;
  e.style.opacity = "1"; clearTimeout(_svt); _svt = setTimeout(() => e.style.opacity = "0", 1200); }

/* ---------- DATEN LADEN & NORMALISIEREN ---------- */
async function loadData(){
  const res = await fetch("/werkzeuge.json", { cache: "no-cache" });
  if(!res.ok) throw new Error("werkzeuge.json " + res.status);
  const data = await res.json();
  PHASES = data.phases.map(p => [p.id, p.label]);
  TOOLS = data.tools.map(t => ({
    id: t.id,
    ph: "k" + t.chapter,
    typ: t.type,
    name: t.name,
    intro: t.intro,
    prompt: t.prompt,
    lead: t.lead ? { l: t.lead.label } : undefined,
    choice: t.choice ? { l: t.choice.label, opts: t.choice.options } : undefined,
    fields: t.fields ? t.fields.map(f => ({ l: f.label, h: f.hint, amp: !!f.ampel })) : undefined
  }));
}
const toolById = id => TOOLS.find(t => t.id === id);
const phaseLabel = ph => { const p = PHASES.find(x => x[0] === ph); return p ? p[1] : ""; };

/* ---------- MENÜ ---------- */
function buildMenu(){
  const m = document.getElementById("menu"); m.innerHTML = "";
  PHASES.forEach(([pk, plabel]) => {
    const tools = TOOLS.filter(t => t.ph === pk);
    if(!tools.length) return;
    const g = document.createElement("div"); g.className = "grp"; g.textContent = plabel;
    g.dataset.grp = pk; m.appendChild(g);
    tools.forEach(t => {
      const it = document.createElement("div"); it.className = "navitem"; it.dataset.id = t.id;
      it.dataset.name = t.name.toLowerCase() + " " + plabel.toLowerCase();
      it.innerHTML = '<span class="t ' + (t.typ === "blatt" ? "b" : "") + '">' + (t.typ === "blatt" ? "AB" : "IMP") + '</span><span>' + esc(t.name) + '</span>';
      it.onclick = () => go("/werkzeug/" + t.id);
      m.appendChild(it);
    });
  });
}
function markActiveTool(id){
  document.querySelectorAll(".navitem").forEach(n => n.classList.toggle("active", n.dataset.id === id));
}
function markActiveLink(route){
  document.querySelectorAll(".navlink").forEach(n => n.classList.toggle("active", n.dataset.route === route));
}

/* ---------- SUCHE ---------- */
let query = "";
function onSearch(v){
  query = (v || "").trim().toLowerCase();
  filterNav();
  if(routeName() === "home") renderHome();
}
function filterNav(){
  const items = document.querySelectorAll(".navitem");
  items.forEach(it => it.classList.toggle("hidden", query && !it.dataset.name.includes(query)));
  document.querySelectorAll(".grp[data-grp]").forEach(g => {
    const pk = g.dataset.grp;
    const any = [...document.querySelectorAll('.navitem[data-id]')]
      .some(it => it.parentNode && TOOLS.find(t => t.id === it.dataset.id)?.ph === pk && !it.classList.contains("hidden"));
    g.classList.toggle("hidden", !any);
  });
}

/* ---------- HOME ---------- */
function renderHome(){
  const v = document.getElementById("view");
  const matches = t => !query || (t.name.toLowerCase().includes(query) || phaseLabel(t.ph).toLowerCase().includes(query));
  const shown = TOOLS.filter(matches);

  let quick = "";
  if(!query){
    QUICK_IDS.forEach(id => { const t = toolById(id); if(!t) return;
      const flag = id === "absprung" ? " flag" : "";
      quick += '<button class="qcard' + flag + '" onclick="go(\'/werkzeug/' + t.id + '\')">' +
        '<div class="p">' + esc(phaseLabel(t.ph).split(" · ")[0]) + (id === "absprung" ? " · Flaggschiff" : "") + '</div>' +
        '<div class="n">' + esc(t.name) + '</div>' +
        '<div class="d">' + esc(firstSentence(t.intro)) + '</div></button>';
    });
  }

  let tiles = "";
  shown.forEach(t => {
    tiles += '<div class="tile" onclick="go(\'/werkzeug/' + t.id + '\')">' +
      '<div class="p">' + esc(phaseLabel(t.ph).split(" · ")[0]) + ' · ' + (t.typ === "blatt" ? "Arbeitsblatt" : "Impuls") + '</div>' +
      '<div class="n">' + esc(t.name) + '</div></div>';
  });

  v.innerHTML =
   '<div class="home"><div class="kick">Begleitend zum Buch</div>' +
   '<h2>Die Werkzeuge zum Mitnehmen</h2>' +
   '<p>Vierunddreißig Werkzeuge aus „Höher geht immer" – ausfüllbar, direkt am Schreibtisch nutzbar, ohne Installation. ' +
   'Die <b>Arbeitsblätter</b> begleiten dich durch eine konkrete Entscheidung, die <b>Impulse</b> sind kurze Denkanstöße.</p>' +
   '<div class="big">Nimm ein Werkzeug nicht beim Lesen, sondern im Moment der echten Entscheidung. Genau dann wird aus einem gelesenen Buch ein Handwerk.</div>' +
   '<p style="font-size:13px;color:var(--muted)">Deine Eingaben werden lokal in diesem Browser gespeichert und nirgendwohin gesendet – kein Login, kein Server, kein Tracking. Zum Mitnehmen „drucken" oder „als Text sichern".</p>' +
   (quick ? '<div class="section-h">Jetzt entscheiden</div><div class="quick">' + quick + '</div>' : '') +
   '<div class="section-h">' + (query ? shown.length + " Treffer" : "Alle Werkzeuge") + '</div>' +
   (shown.length ? '<div class="tiles">' + tiles + '</div>' : '<div class="empty">Kein Werkzeug gefunden für „' + esc(query) + '".</div>') +
   '</div>';
}

/* ---------- WERKZEUG-FORMULAR (Entwurf oder Notiz) ---------- */
// values = der zu bearbeitende Datensatz (Entwurf state[id] ODER entry.values)
// onPersist = wird nach jeder Änderung aufgerufen
function renderToolForm(t, values, opts){
  const phLabel = phaseLabel(t.ph);
  let html = '<div class="crumb"><div>' + esc(phLabel) + '</div><div class="nav2">' +
    '<button onclick="go(\'/\')">Übersicht</button>';
  if(opts.nav) html += '<button onclick="step(-1)" title="Vorheriges">‹</button><button onclick="step(1)" title="Nächstes">›</button>';
  html += '</div></div>';

  if(opts.banner) html += '<div class="editbanner">' + opts.banner + '</div>';

  html += '<span class="tag ' + t.typ + '">' + (t.typ === "blatt" ? "Arbeitsblatt" : "Impuls") + '</span>';
  if(opts.routineTag) html += ' <span class="tag routine">' + esc(opts.routineTag) + '</span>';
  html += '<h2 class="toolname">' + esc(t.name) + '</h2>';
  html += '<p class="toolsub">' + esc(phLabel) + '</p>';
  html += '<div class="intro">' + esc(t.intro) + '</div>';

  if(t.lead){
    html += '<div class="field"><div class="fl">' + esc(t.lead.l) + '</div>' +
      '<textarea data-lead="1" placeholder="In einem Satz …">' + esc(values.lead) + '</textarea></div>';
  }
  if(t.choice){
    html += '<div class="choice"><div class="cl">' + esc(t.choice.l) + '</div>';
    t.choice.opts.forEach((o, i) => { const sel = values.choice === i ? " sel" : "";
      html += '<label class="opt' + sel + '"><input type="radio" name="ch" ' + (values.choice === i ? "checked" : "") + ' onclick="setChoice(' + i + ')">' + esc(o) + '</label>'; });
    html += '</div>';
  }
  if(t.typ === "impuls"){
    html += '<div class="field"><div class="fl">Zum Nachdenken</div><div class="fh">' + esc(t.prompt) + '</div>' +
      '<textarea data-f="0" placeholder="Deine Gedanken …">' + esc(values.f[0] || "") + '</textarea></div>';
  } else if(t.fields){
    t.fields.forEach((f, i) => {
      html += '<div class="field"><div class="fl">' + esc(f.l) + '</div>' + (f.h ? '<div class="fh">' + esc(f.h) + '</div>' : '') +
        '<textarea data-f="' + i + '" placeholder="…">' + esc(values.f[i] || "") + '</textarea>';
      if(f.amp){ const a = values.a[i];
        html += '<div class="amp"><span>Eindruck:</span>' +
          '<div class="dot g' + (a === "g" ? " on" : "") + '" data-amp="' + i + '" data-v="g" title="passt / kein Risiko"></div>' +
          '<div class="dot y' + (a === "y" ? " on" : "") + '" data-amp="' + i + '" data-v="y" title="Spannung"></div>' +
          '<div class="dot r' + (a === "r" ? " on" : "") + '" data-amp="' + i + '" data-v="r" title="Warnsignal"></div></div>';
      }
      html += '</div>';
    });
  }

  html += '<div class="actions">' + opts.actions + '</div>';
  html += '<div class="src">Aus „Höher geht immer" · ' + esc(phLabel) + '. Dieses Blatt ersetzt nicht das Kapitel – es bringt sein Werkzeug in die Praxis.</div>';

  document.getElementById("view").innerHTML = html;

  // Bindings
  document.querySelectorAll("#view textarea").forEach(ta => {
    ta.addEventListener("input", e => {
      if(e.target.dataset.lead) values.lead = e.target.value;
      else values.f[e.target.dataset.f] = e.target.value;
      opts.persist();
    });
  });
  document.querySelectorAll("#view .dot").forEach(d => {
    d.addEventListener("click", () => { const i = d.dataset.amp, vv = d.dataset.v;
      values.a[i] = (values.a[i] === vv) ? null : vv;
      document.querySelectorAll('#view .dot[data-amp="' + i + '"]').forEach(x => x.classList.toggle("on", x.dataset.v === values.a[i]));
      opts.persist();
    });
  });
  window.scrollTo(0, 0);
}

/* ---------- WERKZEUG: Entwurfsansicht ---------- */
function openTool(id){
  const t = toolById(id);
  if(!t){ toast("Werkzeug nicht gefunden"); history.replaceState({}, "", "/"); return renderHome(); }
  current = id; editingEntry = null;
  markActiveTool(id); markActiveLink(null);
  const s = state[id];
  const actions =
    '<button class="btn primary" onclick="saveAsEntry()">Als Notiz sichern</button>' +
    calBtn(id) +
    '<button class="btn ghost" onclick="shareCurrent()">Teilen / Kopieren</button>' +
    '<button class="btn ghost" onclick="exportCurrent()">Als Text sichern</button>' +
    '<button class="btn ghost" onclick="window.print()">Drucken / PDF</button>' +
    '<button class="btn ghost" onclick="clearTool()">Leeren</button>';
  renderToolForm(t, s, { nav: true, actions, persist: saveState, routineTag: recurrenceOf(id)?.tag,
    banner: '<span>Arbeitsstand – wird automatisch gesichert. <b>„Als Notiz sichern"</b> legt einen datierten Eintrag an.</span>' });
}
function step(d){ const i = TOOLS.findIndex(t => t.id === current); let n = i + d;
  if(n < 0) n = TOOLS.length - 1; if(n >= TOOLS.length) n = 0; go("/werkzeug/" + TOOLS[n].id); }
function setChoice(i){
  const v = editingEntry ? editingEntry.values : state[current];
  v.choice = i;
  if(editingEntry){ touchEntry(); openEntry(editingEntry.id); } else { saveState(); openTool(current); }
}
function clearTool(){ if(!confirm("Diesen Arbeitsstand leeren?"))return;
  state[current] = blankState(); saveState(); openTool(current); toast("Geleert"); }

/* ---------- NOTIZ-HISTORIE ---------- */
function saveAsEntry(){
  const t = toolById(current); const s = state[current];
  if(isEmptyValues(t, s)){ toast("Noch nichts ausgefüllt"); return; }
  const now = new Date().toISOString();
  const e = { id: uid(), toolId: current, createdAt: now, updatedAt: now, values: clone(s) };
  entries.unshift(e); saveEntries();
  toast("Als Notiz gesichert · " + fmtDate(now));
}
function touchEntry(){ if(editingEntry){ editingEntry.updatedAt = new Date().toISOString();
  const idx = entries.findIndex(x => x.id === editingEntry.id); if(idx >= 0) entries[idx] = editingEntry; saveEntries(); } }

function openEntry(entryId){
  const e = entries.find(x => x.id === entryId);
  if(!e){ toast("Notiz nicht gefunden"); history.replaceState({}, "", "/notizen"); return renderNotes(); }
  const t = toolById(e.toolId);
  if(!t){ toast("Werkzeug zur Notiz fehlt"); return renderNotes(); }
  editingEntry = e; current = e.toolId;
  markActiveTool(null); markActiveLink("notes");
  const actions =
    '<button class="btn primary" onclick="go(\'/notizen\')">Fertig</button>' +
    calBtn(e.toolId) +
    '<button class="btn ghost" onclick="shareCurrent()">Teilen / Kopieren</button>' +
    '<button class="btn ghost" onclick="exportCurrent()">Als Text sichern</button>' +
    '<button class="btn ghost" onclick="window.print()">Drucken / PDF</button>' +
    '<button class="btn danger" onclick="deleteEntry()">Notiz löschen</button>';
  renderToolForm(t, e.values, { nav: false, actions, persist: touchEntry, routineTag: recurrenceOf(e.toolId)?.tag,
    banner: '<span>Gespeicherte Notiz vom <b>' + esc(fmtDate(e.createdAt)) + '</b>. Änderungen werden automatisch gesichert. ' +
            '<a href="#" onclick="go(\'/notizen\');return false;">Zurück zu „Meine Notizen"</a></span>' });
}
function deleteEntry(){
  if(!editingEntry || !confirm("Diese Notiz löschen?"))return;
  entries = entries.filter(x => x.id !== editingEntry.id); editingEntry = null; saveEntries();
  toast("Notiz gelöscht"); go("/notizen");
}

function renderNotes(){
  current = null; editingEntry = null;
  markActiveTool(null); markActiveLink("notes");
  const list = [...entries].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  let body;
  if(!list.length){
    body = '<div class="empty">Noch keine Notizen.<br>Öffne ein Arbeitsblatt, fülle es aus und tippe auf <b>„Als Notiz sichern"</b>.</div>';
  } else {
    body = list.map(e => {
      const t = toolById(e.toolId); if(!t) return "";
      return '<div class="note" onclick="go(\'/notiz/' + e.id + '\')">' +
        '<div class="nh"><div class="nn">' + esc(t.name) + '</div><div class="nd">' + esc(fmtDate(e.updatedAt || e.createdAt)) + '</div></div>' +
        '<div class="ns">' + esc(snippet(t, e.values) || "—") + '</div></div>';
    }).join("");
  }
  const foot =
    '<div class="notes-foot">' +
      '<button class="linkbtn" onclick="exportAllNotes()">Notizen sichern (Backup)</button>' +
      '<label class="linkbtn">Wiederherstellen<input type="file" accept="application/json,.json" hidden onchange="importNotesFile(this)"></label>' +
    '</div>';
  document.getElementById("view").innerHTML =
    '<div class="crumb"><div>Meine Notizen</div><div class="nav2"><button onclick="go(\'/\')">Übersicht</button></div></div>' +
    '<h2 class="toolname" style="font-size:26px">Meine Notizen</h2>' +
    '<p class="toolsub">' + (list.length ? list.length + " Einträge · " : "") + 'Alles bleibt auf diesem Gerät. Sichere dir bei Bedarf ein Backup.</p>' +
    body + foot;
  window.scrollTo(0, 0);
}
function updateNotesBadge(){ const b = document.getElementById("notesBadge"); if(!b) return;
  b.textContent = entries.length; b.style.display = entries.length ? "inline-block" : "none"; }

/* ---------- EXPORT / TEILEN ---------- */
function buildText(t, s){
  const phLabel = phaseLabel(t.ph);
  const ampL = { g: "grün (passt)", y: "gelb (Spannung)", r: "rot (Warnsignal)" };
  let o = "HÖHER GEHT IMMER · WERKZEUG\n" + t.name + "\n" + phLabel + "\n\n" + t.intro + "\n\n";
  if(t.lead) o += t.lead.l + "\n  " + ((s.lead || "").trim() || "—") + "\n\n";
  if(t.choice && s.choice != null) o += t.choice.l + ": " + t.choice.opts[s.choice] + "\n\n";
  if(t.typ === "impuls"){ o += "Zum Nachdenken: " + t.prompt + "\n  " + ((s.f[0] || "").trim() || "—") + "\n"; }
  else if(t.fields){ t.fields.forEach((f, i) => { o += f.l + "\n  " + ((s.f[i] || "").trim() || "—") + "\n";
    if(f.amp && s.a[i]) o += "  Eindruck: " + ampL[s.a[i]] + "\n"; o += "\n"; }); }
  return o;
}
function activeToolAndValues(){
  if(editingEntry){ return [toolById(editingEntry.toolId), editingEntry.values]; }
  return [toolById(current), state[current]];
}
function exportCurrent(){
  const [t, s] = activeToolAndValues(); const o = buildText(t, s);
  const blob = new Blob([o], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = t.name.replace(/[^a-zA-Z0-9]+/g, "_") + ".txt"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast("Als Textdatei gesichert");
}
async function shareCurrent(){
  const [t, s] = activeToolAndValues(); const text = buildText(t, s);
  if(navigator.share){ try{ await navigator.share({ title: t.name + " · Höher geht immer", text }); return; }catch(e){ if(e.name === "AbortError") return; } }
  try{ await navigator.clipboard.writeText(text); toast("In die Zwischenablage kopiert"); }
  catch(e){ exportCurrent(); }
}

/* ---------- KALENDER (.ics) für wiederkehrende Werkzeuge ---------- */
function downloadICS(id){
  const t = toolById(id), rec = recurrenceOf(id);
  if(!t || !rec || !rec.cal) return;
  const [h, m] = rec.cal.time.split(":").map(Number);
  const start = rec.cal.weekday != null ? nextWeekday(rec.cal.weekday, h, m) : nextAt(h, m);
  const url = location.origin + "/werkzeug/" + id;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Höher geht immer//Die Werkzeuge//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:hgi-" + id + "-" + Date.now() + "@hoeher-geht-immer",
    "DTSTAMP:" + icsStamp(new Date()),
    "DTSTART:" + icsLocal(start),
    "DURATION:PT30M",
    "RRULE:" + rec.cal.rrule,
    "SUMMARY:" + icsEsc(t.name + " · Höher geht immer"),
    "DESCRIPTION:" + icsEsc(t.intro + "\nWerkzeug öffnen: " + url),
    "URL:" + url,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + icsEsc(t.name),
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  const ics = lines.map(icsFold).join("\r\n") + "\r\n";
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" }); const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = t.name.replace(/[^a-zA-Z0-9]+/g, "_") + ".ics"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Kalender-Eintrag erstellt – jetzt im Kalender öffnen");
}
function nextWeekday(wd, h, m){ const d = new Date(); d.setSeconds(0, 0); d.setHours(h, m);
  let add = (wd - d.getDay() + 7) % 7; if(add === 0 && d.getTime() < Date.now()) add = 7;
  d.setDate(d.getDate() + add); return d; }
function nextAt(h, m){ const d = new Date(); d.setSeconds(0, 0); d.setHours(h, m);
  if(d.getTime() < Date.now()) d.setDate(d.getDate() + 1); return d; }
const p2 = n => String(n).padStart(2, "0");
function icsLocal(d){ return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "T" + p2(d.getHours()) + p2(d.getMinutes()) + "00"; }
function icsStamp(d){ return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + "T" + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + "Z"; }
function icsEsc(s){ return (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function icsFold(line){ if(line.length <= 73) return line;
  let out = line.slice(0, 73), rest = line.slice(73);
  while(rest.length > 72){ out += "\r\n " + rest.slice(0, 72); rest = rest.slice(72); }
  return out + "\r\n " + rest; }

/* ---------- BACKUP / WIEDERHERSTELLEN (Notizen) ---------- */
function exportAllNotes(){
  if(!entries.length){ toast("Noch keine Notizen"); return; }
  const data = { app: "Höher geht immer · Die Werkzeuge", version: 1, exportedAt: new Date().toISOString(), entries };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }); const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "hoeher-geht-immer-notizen.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast(entries.length + " Notizen gesichert");
}
function importNotesFile(input){
  const file = input.files && input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const d = JSON.parse(reader.result); const inc = Array.isArray(d) ? d : d.entries;
      if(!Array.isArray(inc)) throw new Error("kein Notiz-Backup");
      const have = new Set(entries.map(e => e.id)); let added = 0;
      inc.forEach(e => { if(e && e.toolId && e.values){ if(!e.id || have.has(e.id)) e.id = uid(); have.add(e.id); entries.push(e); added++; } });
      saveEntries(); renderNotes();
      toast(added ? added + " Notizen wiederhergestellt" : "Nichts zu importieren");
    }catch(err){ toast("Datei nicht lesbar"); }
    input.value = "";
  };
  reader.readAsText(file);
}

/* ---------- HILFSFUNKTIONEN ---------- */
function isEmptyValues(t, s){
  if(s.choice != null) return false;
  if((s.lead || "").trim()) return false;
  if(Object.values(s.f || {}).some(v => (v || "").trim())) return false;
  if(Object.values(s.a || {}).some(v => v)) return false;
  return true;
}
function snippet(t, s){
  if((s.lead || "").trim()) return s.lead.trim();
  const f = Object.values(s.f || {}).map(v => (v || "").trim()).find(Boolean);
  if(f) return f;
  if(s.choice != null && t.choice) return t.choice.opts[s.choice];
  return "";
}
function firstSentence(str){ const m = (str || "").match(/^.*?[.!?](\s|$)/); return (m ? m[0] : str || "").trim(); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function fmtDate(iso){ try{ return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }); }catch(e){ return iso; } }
function esc(s){ return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toggleMenu(open){ const a = document.getElementById("app"), s = document.getElementById("side");
  if(open){ s.classList.add("open"); a.classList.add("menuopen"); } else { s.classList.remove("open"); a.classList.remove("menuopen"); } }

let _tt; function toast(msg){ const el = document.getElementById("toast"); if(!el) return;
  el.textContent = msg; el.classList.add("show"); clearTimeout(_tt); _tt = setTimeout(() => el.classList.remove("show"), 2200); }

/* ---------- ROUTING (Deep Links: /werkzeug/:id, /notizen, /notiz/:id) ---------- */
function matchPath(p){
  p = (p || "/").replace(/\/+$/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  if(seg.length === 0) return { name: "home" };
  if(seg[0] === "werkzeug" && seg[1]) return { name: "tool", id: decodeURIComponent(seg[1]) };
  if(seg[0] === "notizen") return { name: "notes" };
  if(seg[0] === "notiz" && seg[1]) return { name: "entry", id: decodeURIComponent(seg[1]) };
  return { name: "home" };
}
function currentRoute(){
  // Hash-Deeplink hat Vorrang (#/werkzeug/x) – robust auch ohne Server-Rewrite
  const hash = location.hash;
  if(hash && hash.length > 1 && hash.slice(1).startsWith("/")) return matchPath(hash.slice(1));
  // Query-Fallback (?werkzeug=x / ?tool=x) für QR-Codes
  const qs = new URLSearchParams(location.search);
  const qt = qs.get("werkzeug") || qs.get("tool");
  if(qt) return { name: "tool", id: qt };
  return matchPath(location.pathname);
}
function routeName(){ return currentRoute().name; }
function go(path){ if(location.pathname + location.hash !== path){ history.pushState({}, "", path); } route(); }
function route(){
  const r = currentRoute();
  toggleMenu(false);
  if(r.name === "tool") openTool(r.id);
  else if(r.name === "notes") renderNotes();
  else if(r.name === "entry") openEntry(r.id);
  else { current = null; editingEntry = null; markActiveTool(null); markActiveLink("home"); renderHome(); }
  filterNav();
}
window.addEventListener("popstate", route);

/* ---------- PWA: Service Worker, Install, Offline ---------- */
let deferredPrompt = null;
function registerSW(){
  if(!("serviceWorker" in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(refreshing) return; refreshing = true; location.reload();
  });
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferredPrompt = e;
  document.getElementById("installbtn")?.classList.add("show");
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null; document.getElementById("installbtn")?.classList.remove("show");
  toast("App installiert");
});
async function promptInstall(){
  if(!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice;
  deferredPrompt = null; document.getElementById("installbtn")?.classList.remove("show");
}
window.addEventListener("offline", () => toast("Offline – die App und deine Notizen funktionieren weiter."));
window.addEventListener("online", () => toast("Wieder online."));

/* ---------- START ---------- */
async function boot(){
  try{
    await loadData();
  }catch(e){
    document.getElementById("view").innerHTML =
      '<div class="empty">Die Werkzeuge konnten nicht geladen werden.<br>Bitte Verbindung prüfen und neu laden.</div>';
    return;
  }
  loadState(); loadEntries();
  buildMenu(); updateNotesBadge();
  document.getElementById("q").addEventListener("input", e => onSearch(e.target.value));
  route();
  registerSW();
}
boot();
