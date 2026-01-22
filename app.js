import { auth, db, storage } from "./firebase.js";

import {
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  collection, doc, getDoc, setDoc, addDoc,
  onSnapshot, query, orderBy, serverTimestamp,
  updateDoc, where, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const $ = (id) => document.getElementById(id);

// FORCE: modal ne sme biti odprt ob zagonu (reši overlay bug)
window.addEventListener("load", () => {
  const m = document.getElementById("modal");
  if (m) m.classList.add("hidden");
});

const DEFAULT_MACHINES = [
  "20141 FPZ UNIOR 1",
  "20142 FPZ UNIOR 2",
  "20146 FPZ UNIOR 3",
  "20170 UNIFLEX"
];

const SERVICE_ANNUAL = "ANNUAL_PREVENTIVE";

// UI
const loginBox = $("login");
const appBox = $("app");

const modal = $("modal");
const modalTitle = $("modalTitle");
const modalBody = $("modalBody");
const modalClose = $("modalClose");

let unsubEntries = null;
let entriesCache = [];
let editingId = null;
let selectedFiles = [];
let machinesCache = [];
let listFilter = "ALL"; // ALL | OPEN | WAIT | CLOSED

// -------- helpers --------
function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}
function setTodayLine(){
  const d = new Date();
  const el = $("todayLine");
  if (el) el.textContent = d.toLocaleDateString("sl-SI", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}
function showTab(name){
  document.querySelectorAll(".navbtn").forEach(b=>b.classList.toggle("active", b.dataset.tab===name));
  ["new","list","machine","preventiva","settings"].forEach(t=>{
    const panel = $("tab-"+t);
    if (panel) panel.classList.toggle("hidden", t!==name);
  });
}
function openModal(title, bodyNode){
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalBody.appendChild(bodyNode);
  modal.classList.remove("hidden");
}
function closeModal(){ modal.classList.add("hidden"); }

function fmtTS(ts){
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("sl-SI", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function fmtDateISO(d){
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth()+1).padStart(2,"0");
  const dd = String(x.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseDateInput(v){
  if (!v) return null;
  const d = new Date(v+"T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
function addDays(date, days){
  const d = new Date(date);
  d.setDate(d.getDate()+days);
  return d;
}
function badgeClassStatus(status){
  if (status==="NUJNO") return "urgent";
  if (status==="CAKA_DELE") return "wait";
  return "ok";
}
function badgeClassState(state){
  return state==="CLOSED" ? "closed" : "open";
}
function stateLabel(state){
  return state==="CLOSED" ? "ZAKLJUČENO" : "ODPRTO";
}

modalClose?.addEventListener("click", closeModal);
modal?.addEventListener("click", (e)=>{ if (e.target === modal) closeModal(); });

document.querySelectorAll(".navbtn").forEach(b=>{
  b.addEventListener("click", async ()=>{
    showTab(b.dataset.tab);
    if (b.dataset.tab === "preventiva") await refreshPreventivaList();
    if (b.dataset.tab === "machine") await refreshMachineProfile();
  });
});

$("syncBtn")?.addEventListener("click", async ()=> {
  await loadMachines();
  renderEntries(getFilteredEntries());
  await refreshPreventivaList();
  await refreshMachineProfile();
  alert("Sinhronizirano ✅");
});

$("logoutBtn")?.addEventListener("click", async ()=> {
  await signOut(auth);
});

// -------- AUTH (BREZ GESLA: samo gumb) --------
$("loginBtn")?.addEventListener("click", async ()=>{
  $("loginMsg").textContent = "";
  try{
    await signInAnonymously(auth);
  } catch(e){
    console.error("AUTH ERROR:", e);

    const code = e?.code || "unknown";
    const msg = e?.message || "";

    $("loginMsg").textContent =
      `Firebase napaka: ${code}\n` +
      (msg ? msg : "") +
      `\n\nNajpogosteje: ` +
      `1) Authentication → Sign-in method → Anonymous ENABLE ` +
      `2) Authentication → Settings → Authorized domains → dodaj primo.zh...github.io`;
  }
});

onAuthStateChanged(auth, async (user)=>{
  if (!user){
    if (unsubEntries) { unsubEntries(); unsubEntries = null; }
    entriesCache = [];
    loginBox?.classList.remove("hidden");
    appBox?.classList.add("hidden");
    return;
  }

  loginBox?.classList.add("hidden");
  appBox?.classList.remove("hidden");

  setTodayLine();
  showTab("new");

  await ensureMachinesDoc();
  await loadMachines();
  await setupEntriesListener();

  if ($("prevDate")) $("prevDate").value = fmtDateISO(new Date());
  if ($("machinePrevDate")) $("machinePrevDate").value = fmtDateISO(new Date());

  resetPhotoUI();

  await refreshPreventivaList();
  await refreshMachineProfile();
});

// -------- MACHINES --------
async function ensureMachinesDoc(){
  const refDoc = doc(db, "meta", "machines");
  const snap = await getDoc(refDoc);
  if (!snap.exists()){
    await setDoc(refDoc, { list: DEFAULT_MACHINES, updatedAt: serverTimestamp() });
  }
}
async function loadMachines(){
  const refDoc = doc(db, "meta", "machines");
  const snap = await getDoc(refDoc);
  machinesCache = (snap.data()?.list || DEFAULT_MACHINES);
  if ($("machinesList")) $("machinesList").value = machinesCache.join("\n");
}
$("saveMachinesBtn")?.addEventListener("click", async ()=>{
  const lines = ($("machinesList")?.value || "").split("\n").map(s=>s.trim()).filter(Boolean);
  await setDoc(doc(db,"meta","machines"), { list: lines, updatedAt: serverTimestamp() }, { merge:true });
  if ($("machinesMsg")) $("machinesMsg").textContent = "Shranjeno ✅";
  machinesCache = lines;
  await refreshPreventivaList();
  await refreshMachineProfile();
});

async function showMachinesPicker(targetInputId){
  if (!machinesCache.length) await loadMachines();
  if (!machinesCache.length) { alert("Ni strojev. Dodaj v Nastavitvah."); return; }

  const wrap = document.createElement("div");
  wrap.className = "modalList";
  machinesCache.forEach(m=>{
    const b = document.createElement("button");
    b.className = "modalItem";
    b.textContent = m;
    b.addEventListener("click", ()=>{
      $(targetInputId).value = m;
      closeModal();
      if (targetInputId === "machineProfile") refreshMachineProfile();
    });
    wrap.appendChild(b);
  });
  openModal("Izberi stroj", wrap);
}

$("pickMachineBtn")?.addEventListener("click", ()=>showMachinesPicker("machine"));
$("prevPickBtn")?.addEventListener("click", ()=>showMachinesPicker("prevMachine"));
$("machinePickBtn")?.addEventListener("click", ()=>showMachinesPicker("machineProfile"));

// -------- PHOTOS --------
$("photos")?.addEventListener("change", (e)=>{
  selectedFiles = [...e.target.files];
  renderPhotoPreview(selectedFiles, /*existing=*/null);
});

function resetPhotoUI(existingPhotos = []) {
  selectedFiles = [];
  if ($("photos")) $("photos").value = "";
  if ($("photoHint")) {
    $("photoHint").textContent = existingPhotos.length
      ? `Obstoječe slike: ${existingPhotos.length}. Lahko dodaš nove (dodajo se zraven).`
      : "Slike so vidne samo, če so naložene preko te aplikacije.";
  }
  renderPhotoPreview([], existingPhotos);
}

function renderPhotoPreview(newFiles, existingPhotos){
  const wrap = $("photoPreview");
  if (!wrap) return;

  wrap.innerHTML = "";

  const ex = Array.isArray(existingPhotos) ? existingPhotos : [];
  if (ex.length){
    ex.forEach(p=>{
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = p.url;
      img.title = p.name || "slika";
      wrap.appendChild(img);
    });
  }

  if (newFiles.length){
    newFiles.forEach(f=>{
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = URL.createObjectURL(f);
      img.title = f.name;
      wrap.appendChild(img);
    });
  }

  if (!ex.length && !newFiles.length){
    wrap.innerHTML = `<div class="muted small">Ni izbranih slik.</div>`;
  }
}

async function uploadPhotos(entryId, files){
  if (!files.length) return [];

  const out = [];
  for (const file of files){
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `images/${entryId}/${Date.now()}_${safeName}`;
    const r = ref(storage, path);

    // VAROVALKA: metadata app = vzdrzevanje-ook (Storage rules zahtevajo)
    await uploadBytes(r, file, {
      contentType: file.type || "image/jpeg",
      customMetadata: { app: "vzdrzevanje-ook" }
    });

    const url = await getDownloadURL(r);
    out.push({ path, url, name: file.name, type: file.type || "" });
  }
  return out;
}

// -------- ENTRIES --------
async function setupEntriesListener(){
  if (unsubEntries) unsubEntries();

  const qy = query(collection(db, "entries"), orderBy("createdAt", "desc"));
  unsubEntries = onSnapshot(qy, (snap)=>{
    entriesCache = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderEntries(getFilteredEntries());
    refreshMachineProfile();
  });
}

function getFilteredEntries(){
  const q = ($("search")?.value || "").trim().toLowerCase();

  let list = entriesCache;

  if (listFilter === "OPEN") list = list.filter(e => (e.state||"OPEN") === "OPEN");
  if (listFilter === "CLOSED") list = list.filter(e => (e.state||"OPEN") === "CLOSED");
  if (listFilter === "WAIT") list = list.filter(e => (e.status||"") === "CAKA_DELE");

  if (q) {
    list = list.filter(e=>{
      const blob = [
        e.faultId, e.machine, e.work, e.materials, e.obs, e.think, e.who, e.mode, e.status, e.state
      ].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }

  return list;
}

function renderEntries(list){
  const wrap = $("entryList");
  if (!wrap) return;

  wrap.innerHTML = "";
  if (!list.length) { wrap.innerHTML = `<div class="muted">Ni vnosov.</div>`; return; }

  list.forEach(e=>{
    const div = document.createElement("div");
    div.className = "item";

    const photos = Array.isArray(e.photos) ? e.photos : [];
    const st = e.state || "OPEN";
    const status = e.status || "OK";

    div.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="muted small">
            ${fmtTS(e.createdAt)} •
            <span class="badge ${badgeClassState(st)}">${stateLabel(st)}</span> •
            <span class="badge">${escapeHtml(e.mode||"")}</span> •
            <span class="badge">${escapeHtml(e.who||"")}</span> •
            <span class="badge ${badgeClassStatus(status)}">${escapeHtml(status)}</span>
          </div>
          ${e.faultId ? `<div class="muted small"><b>ID:</b> ${escapeHtml(e.faultId)}</div>` : ""}
          <div><b class="linkMachine" data-machine="${escapeHtml(e.machine||"")}">${escapeHtml(e.machine||"—")}</b></div>
          <div>${escapeHtml(e.work||"")}</div>
          ${e.materials ? `<div class="muted small">Material: ${escapeHtml(e.materials)}</div>` : ""}
        </div>
        <div class="row" style="gap:6px;">
          <button class="btn" data-edit="${e.id}" style="padding:10px 10px;">✏️</button>
        </div>
      </div>

      ${photos.length ? `<div class="photoRow">${photos.slice(0,6).map(p=>`<img class="thumb" src="${p.url}" />`).join("")}</div>` : ""}
      ${(e.obs||e.think) ? `<div class="muted small" style="margin-top:8px;">${escapeHtml((e.obs||"") + (e.think?(" • "+e.think):""))}</div>` : ""}
    `;
    wrap.appendChild(div);
  });

  wrap.querySelectorAll("[data-edit]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.edit;
      const e = entriesCache.find(x=>x.id===id);
      if (!e) return;

      editingId = id;
      if ($("formTitle")) $("formTitle").textContent = "Urejanje vnosa";
      $("cancelEditBtn")?.classList.remove("hidden");

      $("state").value = e.state || "OPEN";
      $("status").value = e.status || "OK";
      $("faultId").value = e.faultId || "";
      $("machine").value = e.machine || "";
      $("work").value = e.work || "";
      $("durationMin").value = (e.durationMin ?? "").toString();
      $("who").value = e.who || "HREN PRIMOŽ";
      $("mode").value = e.mode || "SAM";
      $("materials").value = e.materials || "";
      $("obs").value = e.obs || "";
      $("think").value = e.think || "";

      resetPhotoUI(Array.isArray(e.photos) ? e.photos : []);
      showTab("new");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  wrap.querySelectorAll(".linkMachine").forEach(el=>{
    el.style.cursor = "pointer";
    el.addEventListener("click", ()=>{
      const m = el.dataset.machine || "";
      if (!m) return;
      $("machineProfile").value = m;
      showTab("machine");
      refreshMachineProfile();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function clearForm(){
  editingId = null;
  if ($("formTitle")) $("formTitle").textContent = "Novi vnos";
  $("cancelEditBtn")?.classList.add("hidden");

  $("state").value = "OPEN";
  $("status").value = "OK";
  $("faultId").value = "";
  $("machine").value = "";
  $("work").value = "";
  $("durationMin").value = "";
  $("who").value = "HREN PRIMOŽ";
  $("mode").value = "SAM";
  $("materials").value = "";
  $("obs").value = "";
  $("think").value = "";

  resetPhotoUI([]);
  if ($("saveMsg")) $("saveMsg").textContent = "";
}

$("clearBtn")?.addEventListener("click", clearForm);
$("cancelEditBtn")?.addEventListener("click", clearForm);

// save
$("saveBtn")?.addEventListener("click", async ()=>{
  if ($("saveMsg")) $("saveMsg").textContent = "";

  const machine = $("machine").value.trim();
  const work = $("work").value.trim();
  if (!machine && !work) { if ($("saveMsg")) $("saveMsg").textContent = "Vpiši vsaj stroj ali opis dela."; return; }

  const payload = {
    state: $("state").value,
    status: $("status").value,
    faultId: $("faultId").value.trim(),
    machine,
    work,
    durationMin: Number(($("durationMin").value||"").trim()) || 0,
    who: $("who").value,
    mode: $("mode").value,
    materials: $("materials").value.trim(),
    obs: $("obs").value.trim(),
    think: $("think").value.trim(),
    updatedAt: serverTimestamp(),
  };

  try {
    if (!editingId) {
      payload.createdAt = serverTimestamp();
      const docRef = await addDoc(collection(db, "entries"), payload);

      const photos = await uploadPhotos(docRef.id, selectedFiles);
      if (photos.length) await updateDoc(doc(db, "entries", docRef.id), { photos });

      if ($("saveMsg")) $("saveMsg").textContent = "Shranjeno ✅";
      clearForm();
    } else {
      const entryDoc = doc(db, "entries", editingId);

      const existing = entriesCache.find(x=>x.id===editingId);
      const existingPhotos = Array.isArray(existing?.photos) ? existing.photos : [];

      const newPhotos = await uploadPhotos(editingId, selectedFiles);
      const merged = existingPhotos.concat(newPhotos);

      await updateDoc(entryDoc, { ...payload, photos: merged });

      if ($("saveMsg")) $("saveMsg").textContent = "Posodobljeno ✅";
      clearForm();
    }

    renderEntries(getFilteredEntries());
    await refreshPreventivaList();
    await refreshMachineProfile();

  } catch (e) {
    if ($("saveMsg")) $("saveMsg").textContent = "Napaka pri shranjevanju (preveri povezavo in pravila).";
  }
});

// search
$("search")?.addEventListener("input", ()=> renderEntries(getFilteredEntries()));

// filter chips
document.querySelectorAll(".chip").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    listFilter = btn.dataset.filter;
    renderEntries(getFilteredEntries());
  });
});

// export CSV
function csvEscape(v){
  const s = (v ?? "").toString();
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
$("exportCsvBtn")?.addEventListener("click", ()=>{
  const header = ["createdAt","state","status","faultId","machine","work","durationMin","who","mode","materials","obs","think"].join(",");
  const lines = entriesCache.map(e=>{
    return [
      fmtTS(e.createdAt),
      e.state, e.status, e.faultId,
      e.machine, e.work, e.durationMin, e.who, e.mode,
      e.materials, e.obs, e.think
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
});

// PDF
$("exportPdfBtn")?.addEventListener("click", ()=>window.print());

// -------- PREVENTIVA (global) --------
if ($("prevDate")) $("prevDate").value = fmtDateISO(new Date());

$("prevDoneBtn")?.addEventListener("click", async ()=>{
  if ($("prevMsg")) $("prevMsg").textContent = "";
  const machine = ($("prevMachine")?.value || "").trim();
  const d = parseDateInput($("prevDate")?.value);
  if (!machine) { if ($("prevMsg")) $("prevMsg").textContent = "Izberi stroj."; return; }
  if (!d) { if ($("prevMsg")) $("prevMsg").textContent = "Izberi datum."; return; }

  try{
    await addDoc(collection(db, "services"), {
      type: SERVICE_ANNUAL,
      machine,
      date: d.toISOString(),
      createdAt: serverTimestamp()
    });
    if ($("prevMsg")) $("prevMsg").textContent = "Zabeleženo ✅";
    await refreshPreventivaList();
    await refreshMachineProfile();
  } catch {
    if ($("prevMsg")) $("prevMsg").textContent = "Napaka pri shranjevanju preventive.";
  }
});

async function fetchServicesSnapshotOnce(){
  return await new Promise((resolve)=> {
    const qy = query(collection(db, "services"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(qy, (s)=>{ unsub(); resolve(s); });
  });
}

async function refreshPreventivaList(){
  if (!$("preventivaList")) return;

  if (!machinesCache.length) await loadMachines();

  const servicesSnap = await fetchServicesSnapshotOnce();
  const lastMap = new Map();
  servicesSnap.docs.forEach(d=>{
    const s = d.data();
    if (s.type !== SERVICE_ANNUAL) return;
    const dt = new Date(s.date);
    if (isNaN(dt.getTime())) return;
    const prev = lastMap.get(s.machine);
    if (!prev || dt > prev) lastMap.set(s.machine, dt);
  });

  const wrap = $("preventivaList");
  wrap.innerHTML = "";
  const today = new Date();
  const soonDays = 30;

  machinesCache.forEach(m=>{
    const last = lastMap.get(m) || null;
    const due = last ? addDays(last, 365) : null;

    let status = "ZAMUJENO";
    let cls = "urgent";
    let line = "Ni zabeležene letne preventive.";

    if (due){
      const diffDays = Math.floor((due - today) / (1000*60*60*24));
      if (diffDays >= soonDays) { status="OK"; cls="ok"; }
      else if (diffDays >= 0) { status="KMALU"; cls="wait"; }
      else { status="ZAMUJENO"; cls="urgent"; }
      line = `Zadnja: ${fmtDateISO(last)} • Naslednja: ${fmtDateISO(due)} • (${diffDays} dni)`;
    }

    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div>
          <div><b>${escapeHtml(m)}</b></div>
          <div class="muted small">${escapeHtml(line)}</div>
        </div>
        <div><span class="badge ${cls}">${status}</span></div>
      </div>
    `;
    wrap.appendChild(div);
  });
}

// -------- MACHINE PROFILE --------
$("machineJumpToNew")?.addEventListener("click", ()=> showTab("new"));

if ($("machinePrevDate")) $("machinePrevDate").value = fmtDateISO(new Date());

$("machinePrevDoneBtn")?.addEventListener("click", async ()=>{
  if ($("machinePrevMsg")) $("machinePrevMsg").textContent = "";
  const machine = ($("machineProfile")?.value || "").trim();
  const d = parseDateInput($("machinePrevDate")?.value);
  if (!machine) { if ($("machinePrevMsg")) $("machinePrevMsg").textContent = "Najprej izberi stroj."; return; }
  if (!d) { if ($("machinePrevMsg")) $("machinePrevMsg").textContent = "Izberi datum."; return; }

  try{
    await addDoc(collection(db, "services"), {
      type: SERVICE_ANNUAL,
      machine,
      date: d.toISOString(),
      createdAt: serverTimestamp()
    });
    if ($("machinePrevMsg")) $("machinePrevMsg").textContent = "Zabeleženo ✅";
    await refreshPreventivaList();
    await refreshMachineProfile();
  } catch {
    if ($("machinePrevMsg")) $("machinePrevMsg").textContent = "Napaka pri shranjevanju preventive.";
  }
});

async function getLastAnnualForMachine(machine){
  const qy = query(
    collection(db, "services"),
    where("type","==",SERVICE_ANNUAL),
    where("machine","==",machine),
    orderBy("createdAt","desc"),
    limit(10)
  );
  const snap = await getDocs(qy);
  let last = null;
  snap.docs.forEach(d=>{
    const s = d.data();
    const dt = new Date(s.date);
    if (!isNaN(dt.getTime()) && (!last || dt > last)) last = dt;
  });
  return last;
}

async function refreshMachineProfile(){
  const prevLine = $("machinePrevLine");
  const listWrap = $("machineEntries");
  if (!prevLine || !listWrap) return;

  const machine = ($("machineProfile")?.value || "").trim();

  if (!machine){
    prevLine.textContent = "Izberi stroj.";
    listWrap.innerHTML = `<div class="muted">Ni izbranega stroja.</div>`;
    return;
  }

  const last = await getLastAnnualForMachine(machine);
  if (!last){
    prevLine.textContent = "Ni zabeležene letne preventive.";
  } else {
    const due = addDays(last, 365);
    const today = new Date();
    const diffDays = Math.floor((due - today) / (1000*60*60*24));
    prevLine.textContent = `Zadnja: ${fmtDateISO(last)} • Naslednja: ${fmtDateISO(due)} • (${diffDays} dni)`;
  }

  const entries = entriesCache.filter(e => (e.machine || "").trim() === machine);
  if (!entries.length){
    listWrap.innerHTML = `<div class="muted">Ni vnosov za ta stroj.</div>`;
    return;
  }

  listWrap.innerHTML = "";
  entries.slice(0, 50).forEach(e=>{
    const div = document.createElement("div");
    div.className = "item";
    const photos = Array.isArray(e.photos) ? e.photos : [];
    div.innerHTML = `
      <div class="muted small">
        ${fmtTS(e.createdAt)} •
        <span class="badge ${badgeClassState(e.state||"OPEN")}">${stateLabel(e.state||"OPEN")}</span> •
        <span class="badge ${badgeClassStatus(e.status||"OK")}">${escapeHtml(e.status||"OK")}</span>
        ${e.faultId ? ` • <span class="badge">ID: ${escapeHtml(e.faultId)}</span>` : ""}
      </div>
      <div><b>${escapeHtml(e.work||"")}</b></div>
      ${e.materials ? `<div class="muted small">Material: ${escapeHtml(e.materials)}</div>` : ""}
      ${photos.length ? `<div class="photoRow">${photos.slice(0,4).map(p=>`<img class="thumb" src="${p.url}" />`).join("")}</div>` : ""}
      <div class="row" style="margin-top:8px;">
        <button class="btn" data-edit="${e.id}" style="padding:10px 10px;">Uredi</button>
      </div>
    `;
    listWrap.appendChild(div);
  });

  listWrap.querySelectorAll("[data-edit]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.edit;
      const e = entriesCache.find(x=>x.id===id);
      if (!e) return;

      editingId = id;
      if ($("formTitle")) $("formTitle").textContent = "Urejanje vnosa";
      $("cancelEditBtn")?.classList.remove("hidden");

      $("state").value = e.state || "OPEN";
      $("status").value = e.status || "OK";
      $("faultId").value = e.faultId || "";
      $("machine").value = e.machine || "";
      $("work").value = e.work || "";
      $("durationMin").value = (e.durationMin ?? "").toString();
      $("who").value = e.who || "HREN PRIMOŽ";
      $("mode").value = e.mode || "SAM";
      $("materials").value = e.materials || "";
      $("obs").value = e.obs || "";
      $("think").value = e.think || "";

      resetPhotoUI(Array.isArray(e.photos) ? e.photos : []);
      showTab("new");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}
