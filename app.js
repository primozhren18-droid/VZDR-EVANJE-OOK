import { putEntry, getAllEntries, getEntry, deleteEntry, wipeAll, getMeta, setMeta } from "./db.js";

const $ = (id) => document.getElementById(id);

const app = $("app");
const pinCard = $("pinCard");
const pinInput = $("pinInput");
const pinBtn = $("pinBtn");
const pinMsg = $("pinMsg");
const pinTitle = $("pinTitle");
const pinHint = $("pinHint");
const lockBtn = $("lockBtn");

const teamWrap = $("teamWrap");
const teamChips = $("teamChips");

const matList = $("matList");
const photoPreview = $("photoPreview");

const modal = $("modal");
const modalTitle = $("modalTitle");
const modalBody = $("modalBody");
const modalClose = $("modalClose");

let mats = [];
let photos = [];
let teamSel = new Set();

let editingId = null;

const DEFAULT_NAMES = {
  ME: "HREN PRIMOŽ",
  SODELAVEC_1: "FRANCI SEVŠEK",
  SODELAVEC_2: "MIROSLAV KLEMEN",
  SODELAVEC_3: "SODELAVEC 3",
};

function nowISO() { return new Date().toISOString(); }
function fmtDT(iso){
  const d = new Date(iso);
  return d.toLocaleString("sl-SI", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function monthKeyFromISO(iso){
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}
function yearFromISO(iso){ return new Date(iso).getFullYear(); }

async function sha256(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function ensureSW(){
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }
}

function setTodayLine(){
  const d = new Date();
  $("todayLine").textContent = d.toLocaleDateString("sl-SI", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}

function showTab(name){
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active", b.dataset.tab===name));
  ["new","list","summary","settings"].forEach(t=>{
    $("tab-"+t).classList.toggle("hidden", t!==name);
  });
}

function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

function statusBadgeClass(s){
  if (s==="NUJNO") return "urgent";
  if (s==="CAKA_DELE") return "wait";
  return "ok";
}
function statusLabel(s){
  if (s==="NUJNO") return "NUJNO";
  if (s==="CAKA_DELE") return "ČAKA DELE";
  return "OK";
}

function minsToHM(mins){
  const m = Number(mins)||0;
  const h = Math.floor(m/60);
  const r = m%60;
  if (h<=0) return `${r} min`;
  return `${h} h ${r} min`;
}

async function getNames(){
  const saved = await getMeta("names");
  return { ...DEFAULT_NAMES, ...(saved || {}) };
}

async function setNames(obj){
  await setMeta("names", obj);
}

async function getMachines(){
  const saved = await getMeta("machines");
  if (Array.isArray(saved)) return saved;
  return [];
}

async function setMachines(list){
  await setMeta("machines", list);
}

async function setLastMachine(val){
  await setMeta("lastMachine", val || "");
}
async function getLastMachine(){
  return (await getMeta("lastMachine")) || "";
}

async function renderLeadOptions(){
  const names = await getNames();
  const sel = $("lead");
  sel.innerHTML = "";
  const opts = [
    { key:"ME", label:names.ME },
    { key:"SODELAVEC_1", label:names.SODELAVEC_1 },
    { key:"SODELAVEC_2", label:names.SODELAVEC_2 },
    { key:"SODELAVEC_3", label:names.SODELAVEC_3 },
  ];
  opts.forEach(o=>{
    const opt = document.createElement("option");
    opt.value = o.key;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
}

async function renderTeamChips(){
  const names = await getNames();
  const options = [
    { key:"ME", label:names.ME },
    { key:"SODELAVEC_1", label:names.SODELAVEC_1 },
    { key:"SODELAVEC_2", label:names.SODELAVEC_2 },
    { key:"SODELAVEC_3", label:names.SODELAVEC_3 },
  ];
  teamChips.innerHTML = "";
  options.forEach(o=>{
    const b = document.createElement("button");
    b.className = "chip" + (teamSel.has(o.key) ? " on" : "");
    b.textContent = o.label;
    b.addEventListener("click", ()=>{
      if (teamSel.has(o.key)) teamSel.delete(o.key); else teamSel.add(o.key);
      renderTeamChips();
    });
    teamChips.appendChild(b);
  });
}

function renderMats(){
  matList.innerHTML = "";
  if (!mats.length){ matList.innerHTML = `<div class="muted small">Ni dodanega materiala.</div>`; return; }
  mats.forEach((m, idx)=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div><b>${escapeHtml(m.name)}</b> — ${escapeHtml(m.qty)} ${escapeHtml(m.unit)}</div>
        <button class="btn ghost" data-delmat="${idx}">🗑️</button>
      </div>`;
    matList.appendChild(div);
  });
  matList.querySelectorAll("[data-delmat]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      mats.splice(Number(btn.dataset.delmat),1);
      renderMats();
    });
  });
}

function renderPhotoPreview(){
  photoPreview.innerHTML = "";
  photos.forEach((p, idx)=>{
    const img = document.createElement("img");
    img.className="thumb";
    img.src = p.dataUrl;
    img.title = p.name;
    img.addEventListener("click", ()=>{
      if (confirm("Odstranim sliko?")) {
        photos.splice(idx,1);
        renderPhotoPreview();
      }
    });
    photoPreview.appendChild(img);
  });
  if (!photos.length) photoPreview.innerHTML = `<div class="muted small">Ni dodanih slik.</div>`;
}

async function isUnlocked(){ return (await getMeta("unlocked")) === true; }

async function lock(){
  await setMeta("unlocked", false);
  app.classList.add("hidden");
  pinCard.classList.remove("hidden");
  pinInput.value = "";
  pinMsg.textContent = "";
}

async function unlockFlow(pin){
  const pinHash = await getMeta("pinHash");
  if (!pinHash) {
    const h = await sha256(pin);
    await setMeta("pinHash", h);
    await setMeta("unlocked", true);
    return { ok:true, first:true };
  }
  const h = await sha256(pin);
  if (h === pinHash) {
    await setMeta("unlocked", true);
    return { ok:true };
  }
  return { ok:false };
}

async function showApp(){
  pinCard.classList.add("hidden");
  app.classList.remove("hidden");
  showTab("new");
  await refreshList();
  await refreshSummaryDefaults();
  await loadSettingsToUI();
}

function clearForm(){
  editingId = null;
  $("formTitle").textContent = "Novi vnos";
  $("cancelEditBtn").classList.add("hidden");

  $("machine").value = "";
  $("work").value = "";
  $("obs").value = "";
  $("think").value = "";
  $("status").value = "OK";
  $("duration").value = "";
  $("mode").value = "SAM";
  $("lead").value = "ME";
  teamWrap.classList.add("hidden");

  mats = [];
  photos = [];
  teamSel = new Set();

  renderMats();
  renderPhotoPreview();
  $("saveMsg").textContent = "";
}

function openModal(title, bodyNode){
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalBody.appendChild(bodyNode);
  modal.classList.remove("hidden");
}
function closeModal(){
  modal.classList.add("hidden");
}

async function refreshLastMachineLine(){
  const last = await getLastMachine();
  $("lastMachineLine").textContent = last ? `Zadnji stroj: ${last}` : "";
}

async function showMachinesPicker(){
  const machines = await getMachines();
  const wrap = document.createElement("div");
  wrap.className = "modalList";
  if (!machines.length){
    wrap.innerHTML = `<div class="muted small">Ni seznama. Dodaj v Nastavitve → Seznam strojev.</div>`;
  } else {
    machines.forEach(m=>{
      const b = document.createElement("button");
      b.className = "modalItem";
      b.textContent = m;
      b.addEventListener("click", async ()=>{
        $("machine").value = m;
        await setLastMachine(m);
        await refreshLastMachineLine();
        closeModal();
      });
      wrap.appendChild(b);
    });
  }
  openModal("Izberi stroj", wrap);
}

async function refreshList(){
  const entriesAll = (await getAllEntries()).sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||""));
  const q = ($("search").value || "").trim().toLowerCase();
  const names = await getNames();

  const entries = !q ? entriesAll : entriesAll.filter(e=>{
    const blob = [
      e.machine, e.work, e.obs, e.think, e.status,
      ...(e.materials||[]).map(m=>`${m.name} ${m.qty} ${m.unit}`)
    ].join(" ").toLowerCase();
    return blob.includes(q);
  });

  const wrap = $("entryList");
  wrap.innerHTML = "";
  if (!entries.length){
    wrap.innerHTML = `<div class="muted">Ni vnosov.</div>`;
    return;
  }

  entries.forEach(e=>{
    const div = document.createElement("div");
    div.className = "item";

    const modeBadge = e.mode === "SAM" ? "SAM" : "TIM";
    const leadLabel = names[e.lead] || e.lead;

    const teamLabels = (e.team||[]).map(k=>names[k]||k).join(", ");
    const teamLine = e.mode==="TIM" ? `<div class="muted small">Tim: ${escapeHtml(teamLabels || "—")}</div>` : "";

    const durLine = (Number(e.durationMin)||0) ? `<span class="badge">${minsToHM(e.durationMin)}</span>` : "";
    const sClass = statusBadgeClass(e.status);

    div.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="muted small">${fmtDT(e.createdAt)} • <span class="badge">${modeBadge}</span> • <span class="badge">Vodil: ${escapeHtml(leadLabel)}</span> • <span class="badge ${sClass}">${statusLabel(e.status)}</span> ${durLine}</div>
          <div><b>${escapeHtml(e.machine || "—")}</b></div>
          <div>${escapeHtml(e.work || "")}</div>
          ${teamLine}
        </div>
        <div class="row" style="gap:6px;">
          <button class="btn ghost" data-edit="${e.id}">✏️</button>
          <button class="btn ghost" data-del="${e.id}">🗑️</button>
        </div>
      </div>

      ${e.materials?.length ? `<div class="muted small" style="margin-top:8px;">Material: ${e.materials.map(m=>`${escapeHtml(m.name)} (${escapeHtml(m.qty)} ${escapeHtml(m.unit)})`).join(", ")}</div>` : ""}

      ${(e.photos?.length) ? `<div class="photoRow">${e.photos.slice(0,4).map(p=>`<img class="thumb" src="${p.dataUrl}" />`).join("")}</div>` : ""}

      ${(e.obs||e.think) ? `<div class="muted small" style="margin-top:8px;">${escapeHtml((e.obs||"") + (e.think?(" • "+e.think):""))}</div>` : ""}
    `;
    wrap.appendChild(div);
  });

  wrap.querySelectorAll("[data-del]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      if (confirm("Pobrišem vnos?")) {
        await deleteEntry(b.dataset.del);
        await refreshList();
      }
    });
  });

  wrap.querySelectorAll("[data-edit]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      await startEdit(b.dataset.edit);
    });
  });
}

async function startEdit(id){
  const e = await getEntry(id);
  if (!e) return;
  editingId = id;

  $("formTitle").textContent = "Urejanje vnosa";
  $("cancelEditBtn").classList.remove("hidden");

  $("machine").value = e.machine || "";
  $("work").value = e.work || "";
  $("obs").value = e.obs || "";
  $("think").value = e.think || "";
  $("status").value = e.status || "OK";
  $("duration").value = (e.durationMin ?? "").toString();
  $("mode").value = e.mode || "SAM";
  $("lead").value = e.lead || "ME";

  mats = Array.isArray(e.materials) ? [...e.materials] : [];
  photos = Array.isArray(e.photos) ? [...e.photos] : [];
  teamSel = new Set(Array.isArray(e.team) ? e.team : []);

  teamWrap.classList.toggle("hidden", $("mode").value !== "TIM");
  if ($("mode").value === "TIM" && teamSel.size === 0) teamSel.add("ME");

  renderMats();
  renderPhotoPreview();
  await renderTeamChips();

  showTab("new");
  $("saveMsg").textContent = "Urejaš obstoječ vnos.";
}

function computeSummary(entries){
  const total = entries.length;
  const sam = entries.filter(e=>e.mode==="SAM").length;
  const tim = total - sam;

  const urgent = entries.filter(e=>e.status==="NUJNO").length;
  const wait = entries.filter(e=>e.status==="CAKA_DELE").length;

  const minutesTotal = entries.reduce((acc,e)=>acc + (Number(e.durationMin)||0), 0);
  const minutesSam = entries.filter(e=>e.mode==="SAM").reduce((acc,e)=>acc + (Number(e.durationMin)||0), 0);
  const minutesTim = minutesTotal - minutesSam;

  const byMachine = new Map();
  const byMaterial = new Map();
  const byLead = new Map();

  for (const e of entries){
    const m = (e.machine||"—").trim() || "—";
    byMachine.set(m, (byMachine.get(m)||0) + 1);
    byLead.set(e.lead||"—", (byLead.get(e.lead||"—")||0) + 1);

    for (const it of (e.materials||[])){
      const key = (it.name||"—").trim() || "—";
      byMaterial.set(key, (byMaterial.get(key)||0) + 1);
    }
  }

  const top = (map) => [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);

  return {
    total, sam, tim, urgent, wait,
    minutesTotal, minutesSam, minutesTim,
    topMachines: top(byMachine),
    topMaterials: top(byMaterial),
    topLead: top(byLead),
  };
}

function summaryToText(title, s, names){
  const topMachines = s.topMachines.length ? s.topMachines.map(([k,v])=>`${k} (${v})`).join(", ") : "—";
  const topMaterials = s.topMaterials.length ? s.topMaterials.map(([k,v])=>`${k} (${v})`).join(", ") : "—";
  const topLead = s.topLead.length ? s.topLead.map(([k,v])=>`${names[k]||k} (${v})`).join(", ") : "—";

  return [
    title,
    `Skupaj vnosov: ${s.total}`,
    `SAM: ${s.sam} | TIM: ${s.tim}`,
    `NUJNO: ${s.urgent} | ČAKA DELE: ${s.wait}`,
    `Čas skupaj: ${minsToHM(s.minutesTotal)} (SAM: ${minsToHM(s.minutesSam)} | TIM: ${minsToHM(s.minutesTim)})`,
    `Top stroji/lokacije: ${topMachines}`,
    `Top materiali: ${topMaterials}`,
    `Največ vodil: ${topLead}`,
    ``,
    `Argumenti za višjo plačo (osnova):`,
    `- dokazano št. intervencij + sledljivost`,
    `- delež samostojnega dela (SAM) + prevzem vodenja`,
    `- ponavljajoči se problemi po strojih → predlogi izboljšav`,
    `- evidenca porabljenega materiala + časa`,
  ].join("\n");
}

function renderSummaryBox(title, s, names){
  const box = $("summaryBox");
  box.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <div class="list">
      <div class="item"><b>Skupaj vnosov:</b> ${s.total}</div>
      <div class="item"><b>SAM:</b> ${s.sam} &nbsp;&nbsp; <b>TIM:</b> ${s.tim}</div>
      <div class="item"><b>NUJNO:</b> ${s.urgent} &nbsp;&nbsp; <b>ČAKA DELE:</b> ${s.wait}</div>
      <div class="item"><b>Čas skupaj:</b> ${minsToHM(s.minutesTotal)} <div class="muted small">SAM: ${minsToHM(s.minutesSam)} • TIM: ${minsToHM(s.minutesTim)}</div></div>

      <div class="item">
        <b>Top stroji/lokacije:</b>
        <div class="muted small">${s.topMachines.length ? s.topMachines.map(([k,v])=>`${escapeHtml(k)} (${v})`).join(", ") : "—"}</div>
      </div>

      <div class="item">
        <b>Top materiali (po pojavnosti):</b>
        <div class="muted small">${s.topMaterials.length ? s.topMaterials.map(([k,v])=>`${escapeHtml(k)} (${v})`).join(", ") : "—"}</div>
      </div>

      <div class="item">
        <b>Največ vodil:</b>
        <div class="muted small">${s.topLead.length ? s.topLead.map(([k,v])=>`${escapeHtml(names[k]||k)} (${v})`).join(", ") : "—"}</div>
      </div>
    </div>
  `;
}

async function refreshSummaryDefaults(){
  const d = new Date();
  $("monthPick").value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  $("yearPick").value = String(d.getFullYear());
  $("summaryBox").innerHTML = `<div class="muted">Izberi mesec ali leto.</div>`;
}

function printCurrent(){ window.print(); }

function csvEscape(v){
  const s = (v ?? "").toString();
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

async function exportCSV(){
  const names = await getNames();
  const entries = (await getAllEntries()).sort((a,b)=> (a.createdAt||"").localeCompare(b.createdAt||""));

  const header = [
    "createdAt","machine","work","status","durationMin","mode","lead","team","materials","obs","think"
  ].join(",");

  const lines = entries.map(e=>{
    const team = (e.team||[]).map(k=>names[k]||k).join(" | ");
    const materials = (e.materials||[]).map(m=>`${m.name}=${m.qty} ${m.unit}`).join(" | ");
    return [
      e.createdAt,
      e.machine,
      e.work,
      statusLabel(e.status),
      (e.durationMin ?? ""),
      e.mode,
      (names[e.lead]||e.lead),
      team,
      materials,
      e.obs,
      e.think
    ].map(csvEscape).join(",");
  });

  const blob = new Blob([header+"\n"+lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vzdrzevanje_ook_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadSettingsToUI(){
  const names = await getNames();
  $("nameMe").value = names.ME;
  $("name1").value = names.SODELAVEC_1;
  $("name2").value = names.SODELAVEC_2;
  $("name3").value = names.SODELAVEC_3;

  const machines = await getMachines();
  $("machinesList").value = machines.join("\n");

  await renderLeadOptions();
  await renderTeamChips();

  // default lead = ME if empty
  if (!$("lead").value) $("lead").value = "ME";

  await refreshLastMachineLine();
}

function fileToDataUrl(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = ()=>reject(r.error);
    r.readAsDataURL(file);
  });
}

async function main(){
  setTodayLine();
  await ensureSW();

  // modal
  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e)=>{ if (e.target === modal) closeModal(); });

  // tabs
  document.querySelectorAll(".tab").forEach(b=>{
    b.addEventListener("click", ()=>showTab(b.dataset.tab));
  });

  // lock
  lockBtn.addEventListener("click", lock);

  // mode toggle
  $("mode").addEventListener("change", async ()=>{
    const isTeam = $("mode").value === "TIM";
    teamWrap.classList.toggle("hidden", !isTeam);
    if (isTeam && teamSel.size===0){
      teamSel = new Set(["ME"]);
      await renderTeamChips();
    }
  });

  // pick machine
  $("pickMachineBtn").addEventListener("click", showMachinesPicker);

  // add material
  $("addMatBtn").addEventListener("click", ()=>{
    const name = $("matName").value.trim();
    const qty = $("matQty").value.trim();
    const unit = $("matUnit").value.trim() || "kos";
    if (!name) return;
    mats.push({ name, qty: qty || "1", unit });
    $("matName").value = ""; $("matQty").value = "";
    renderMats();
  });

  // photos
  $("photos").addEventListener("change", async (e)=>{
    const files = [...e.target.files];
    for (const f of files){
      const dataUrl = await fileToDataUrl(f);
      photos.push({ name:f.name, type:f.type, dataUrl });
    }
    renderPhotoPreview();
    e.target.value = "";
  });

  // save
  $("saveBtn").addEventListener("click", async ()=>{
    const machine = $("machine").value.trim();
    const work = $("work").value.trim();

    if (!machine && !work){
      $("saveMsg").textContent = "Vpiši vsaj stroj ali opis dela.";
      return;
    }

    const durationMin = Number(($("duration").value||"").trim());
    const entry = {
      id: editingId || crypto.randomUUID(),
      createdAt: (editingId ? (await getEntry(editingId))?.createdAt : null) || nowISO(),
      updatedAt: nowISO(),
      machine,
      work,
      status: $("status").value,
      durationMin: Number.isFinite(durationMin) ? durationMin : 0,
      mode: $("mode").value,
      lead: $("lead").value,
      team: $("mode").value === "TIM" ? [...teamSel] : [],
      materials: mats,
      obs: $("obs").value.trim(),
      think: $("think").value.trim(),
      photos
    };

    await putEntry(entry);
    await setLastMachine(machine);
    await refreshLastMachineLine();

    $("saveMsg").textContent = editingId ? "Posodobljeno ✅" : "Shranjeno ✅";
    clearForm();
    await refreshList();
  });

  $("clearBtn").addEventListener("click", clearForm);
  $("cancelEditBtn").addEventListener("click", clearForm);

  // search
  $("search").addEventListener("input", refreshList);

  // summaries
  let lastSummaryText = "";
  $("monthSummaryBtn").addEventListener("click", async ()=>{
    const mk = $("monthPick").value;
    const names = await getNames();
    const entries = (await getAllEntries()).filter(e=>monthKeyFromISO(e.createdAt)===mk);
    const s = computeSummary(entries);
    const title = `Mesečni povzetek: ${mk}`;
    renderSummaryBox(title, s, names);
    lastSummaryText = summaryToText(title, s, names);
  });

  $("yearSummaryBtn").addEventListener("click", async ()=>{
    const y = Number($("yearPick").value);
    const names = await getNames();
    const entries = (await getAllEntries()).filter(e=>yearFromISO(e.createdAt)===y);
    const s = computeSummary(entries);
    const title = `Letni povzetek: ${y}`;
    renderSummaryBox(title, s, names);
    lastSummaryText = summaryToText(title, s, names);
  });

  $("copySummaryBtn").addEventListener("click", async ()=>{
    if (!lastSummaryText) {
      alert("Najprej ustvari povzetek (mesec ali leto).");
      return;
    }
    try {
      await navigator.clipboard.writeText(lastSummaryText);
      alert("Povzetek kopiran ✅");
    } catch {
      alert("Kopiranje ni uspelo (odpri v Chrome in poskusi znova).");
    }
  });

  // print
  $("printSummaryBtn").addEventListener("click", printCurrent);

  // export month to pdf quickly
  $("exportMonthBtn").addEventListener("click", async ()=>{
    showTab("summary");
    await new Promise(r=>setTimeout(r,50));
    $("monthSummaryBtn").click();
    await new Promise(r=>setTimeout(r,50));
    printCurrent();
  });

  // CSV
  $("exportCsvBtn").addEventListener("click", exportCSV);

  // settings PIN
  $("setPinBtn").addEventListener("click", async ()=>{
    const p = $("newPin").value.trim();
    if (p.length < 4) { $("pinSetMsg").textContent = "PIN naj bo vsaj 4 številke."; return; }
    await setMeta("pinHash", await sha256(p));
    $("newPin").value = "";
    $("pinSetMsg").textContent = "PIN shranjen ✅";
  });

  // settings names
  $("saveNamesBtn").addEventListener("click", async ()=>{
    await setNames({
      ME: $("nameMe").value.trim() || DEFAULT_NAMES.ME,
      SODELAVEC_1: $("name1").value.trim() || DEFAULT_NAMES.SODELAVEC_1,
      SODELAVEC_2: $("name2").value.trim() || DEFAULT_NAMES.SODELAVEC_2,
      SODELAVEC_3: $("name3").value.trim() || DEFAULT_NAMES.SODELAVEC_3,
    });
    $("namesMsg").textContent = "Imena shranjena ✅";
    await loadSettingsToUI();
    await refreshList();
  });

  // settings machines
  $("saveMachinesBtn").addEventListener("click", async ()=>{
    const lines = ($("machinesList").value || "")
      .split("\n")
      .map(s=>s.trim())
      .filter(Boolean);
    await setMachines(lines);
    $("machinesMsg").textContent = "Seznam strojev shranjen ✅";
  });

  // wipe
  $("wipeBtn").addEventListener("click", async ()=>{
    if (confirm("Res pobrišem VSE?")) {
      await wipeAll();
      alert("Pobrisano.");
      await lock();
    }
  });

  // PIN logic
  const hasPin = await getMeta("pinHash");
  pinTitle.textContent = hasPin ? "Odkleni" : "Nastavi PIN (prvič)";
  pinHint.textContent = hasPin ? "Vnesi PIN." : "Vnesi PIN, ki ga boš uporabljal za odklep.";
  pinBtn.addEventListener("click", async ()=>{
    const pin = pinInput.value.trim();
    if (!pin) return;
    const r = await unlockFlow(pin);
    if (r.ok){
      pinMsg.textContent = r.first ? "PIN nastavljen ✅" : "Odklenjeno ✅";
      await showApp();
      clearForm();
    } else {
      pinMsg.textContent = "Napačen PIN.";
    }
  });

  // initial state
  if (await isUnlocked()) await showApp();
  else await lock();

  // init UI defaults
  await loadSettingsToUI();
  renderMats();
  renderPhotoPreview();
  await refreshSummaryDefaults();
}

main();
