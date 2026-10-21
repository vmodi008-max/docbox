"use strict";
/* DocBox web app: client uploads + office review + Tally XML export. */
const CFG = window.DOCBOX_CONFIG || {};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c instanceof Node ? c : String(c)); }
  return e;
}
const nowISO = () => new Date().toISOString();
const thisMonth = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtPeriod = p => { if (!p) return "No month"; const [y, m] = p.split("-"); return MONTHS[+m - 1] + " " + y; };
const fmtDate = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? iso : d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };
const inr = n => (n == null || n === "" || isNaN(+n)) ? "" : "₹" + (+n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round((+n || 0) * 100) / 100;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
function toast(msg) { const t = h("div", { class: "toast", role: "status", text: msg }); $("#toastRoot").replaceChildren(t); setTimeout(() => t.remove(), 3500); }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
const main = () => $("#main");
function setMain(wide, ...kids) { const m = main(); m.className = wide ? "stack" : "narrow stack"; m.replaceChildren(...kids); }

const TYPES = {
  purchase: { label: "Purchase bill", short: "Purchase" },
  sales: { label: "Sales bill", short: "Sales" },
  expense: { label: "Expense / voucher", short: "Expense" },
  bank: { label: "Bank statement", short: "Bank" },
  other: { label: "Other document", short: "Other" },
};
const STATUS = { new: "New", read: "Read by AI", checked: "Checked", exported: "In Tally" };
const CLIENT_STATUS = { new: "Received", read: "Being processed", checked: "Processed", exported: "Posted to books" };
const STATES = {"01":"Jammu & Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","26":"Dadra & Nagar Haveli and Daman & Diu","27":"Maharashtra","29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman & Nicobar Islands","36":"Telangana","37":"Andhra Pradesh","38":"Ladakh"};
const DEFAULT_SETTINGS = {
  purchaseLedger: "Purchase @{rate}%", salesLedger: "Sales @{rate}%", expenseLedger: "Expenses @{rate}%",
  inCgst: "Input CGST @{half}%", inSgst: "Input SGST @{half}%", inIgst: "Input IGST @{rate}%",
  outCgst: "Output CGST @{half}%", outSgst: "Output SGST @{half}%", outIgst: "Output IGST @{rate}%",
  roundOff: "Round Off", suspense: "Suspense A/c",
  vtPurchase: "Purchase", vtSales: "Sales", vtPayment: "Payment", vtReceipt: "Receipt",
  createParties: true,
};
const DEFAULT_MODEL = "claude-sonnet-5-5";
const fmtRate = r => String(r2(r)).replace(/\.0+$/, "");
const pat = (p, rate) => String(p || "").replace(/\{rate\}/g, fmtRate(rate)).replace(/\{half\}/g, fmtRate((+rate || 0) / 2));

const S = { sb: null, uid: null, office: false, me: null, myDocs: [], clients: [], sel: null, docs: [],
  filter: { month: "", type: "all" }, settings: { ...DEFAULT_SETTINGS }, batch: null,
  inApp: /DocBoxApp/.test(navigator.userAgent) };

const rowClient = r => ({ id: r.id, userId: r.user_id, name: r.name, gstin: r.gstin, phone: r.phone, approved: r.approved, offline: r.offline,
  tallyCompany: r.tally_company, tallyBank: r.tally_bank, createdAt: r.created_at, lastUploadAt: r.last_upload_at, seenAt: r.seen_at });
const rowDoc = r => ({ id: r.id, clientId: r.client_id, type: r.type, period: r.period, note: r.note, path: r.path, fileName: r.file_name,
  mime: r.mime, size: r.size, uploadedAt: r.uploaded_at, by: r.uploaded_by, status: r.status, ext: r.ext, readAt: r.read_at, exportedAt: r.exported_at });

/* ---------- boot & login ---------- */
$("#firm").textContent = (CFG.firmName || "") + (CFG.firmCity ? ", " + CFG.firmCity : "");
$("#signout").onclick = async () => { await S.sb.auth.signOut(); location.reload(); };

(async function boot() {
  if (!CFG.supabaseUrl || /^PASTE/.test(CFG.supabaseUrl)) {
    $("#role").textContent = "Setup";
    setMain(false, h("div", { class: "panel stack" }, h("h1", { text: "Setup isn't finished" }),
      h("p", { class: "muted", text: "Add your Supabase Project URL and anon public key to web/config.js in the GitHub project. The setup guide, step 5, shows where." })));
    return;
  }
  if (!window.supabase) {
    $("#role").textContent = "Offline";
    setMain(false, h("div", { class: "panel stack" }, h("h1", { text: "No internet connection" }),
      h("p", { class: "muted", text: "DocBox needs the internet to send and show documents." }),
      h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Try again")));
    return;
  }
  S.sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await S.sb.auth.getSession();
  if (data.session) afterLogin(data.session.user.id); else renderLogin();
})();

function loginEmail(input) {
  const v = input.trim();
  if (v.includes("@")) return v.toLowerCase();
  const d = v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (d.length !== 10) return null;
  return d + "@" + CFG.clientDomain;
}
const AUTH_ERR = m => /invalid login/i.test(m) ? "Mobile number or password is wrong." :
  /already registered|already been registered/i.test(m) ? "This mobile number already has an account. Use Sign in instead." :
  /password/i.test(m) && /6|short|weak/i.test(m) ? "Password must be at least 6 characters." :
  /email not confirmed/i.test(m) ? "Your account isn't active yet. Ask the office to switch off email confirmation in Supabase (setup guide, step 3)." :
  /fetch|network/i.test(m) ? "No internet connection. Try again." : m;

function renderLogin(tab = "in") {
  $("#role").textContent = "Welcome";
  const msg = h("div", { "aria-live": "polite" });
  const tabs = h("div", { class: "tabs", role: "tablist" },
    h("button", { type: "button", role: "tab", "aria-selected": String(tab === "in"), onclick: () => renderLogin("in") }, "Sign in"),
    h("button", { type: "button", role: "tab", "aria-selected": String(tab === "up"), onclick: () => renderLogin("up") }, "New client"));
  const mob = h("input", { id: "lg-mob", inputmode: tab === "up" ? "tel" : "email", autocomplete: "username", placeholder: "98250 12345" });
  const pw = h("input", { id: "lg-pw", type: "password", autocomplete: tab === "up" ? "new-password" : "current-password", placeholder: "At least 6 characters" });
  const nm = h("input", { id: "lg-name", placeholder: "Shree Ganesh Traders" });
  const gs = h("input", { id: "lg-gstin", class: "mono", placeholder: "24ABCDE1234F1Z5", oninput: e => e.target.value = e.target.value.toUpperCase() });
  const btn = h("button", { class: "btn primary big", type: "submit" }, tab === "up" ? "Create account" : "Sign in");
  const form = h("form", { class: "stack" },
    h("label", { class: "field", for: "lg-mob" }, h("span", { class: "label", text: tab === "up" ? "Mobile number" : "Mobile number (office: email)" }), mob),
    h("label", { class: "field", for: "lg-pw" }, h("span", { class: "label", text: "Password" }), pw),
    tab === "up" ? [h("label", { class: "field", for: "lg-name" }, h("span", { class: "label", text: "Business name" }), nm),
      h("label", { class: "field", for: "lg-gstin" }, h("span", { class: "label", text: "GSTIN (if registered)" }), gs)] : null,
    msg, h("div", { class: "row" }, btn));
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email = loginEmail(mob.value);
    const bad = t => { msg.className = "notice bad"; msg.textContent = t; };
    if (!email) return bad("Enter your 10-digit mobile number.");
    if (pw.value.length < 6) return bad("Password must be at least 6 characters.");
    if (tab === "up") {
      if (!nm.value.trim()) return bad("Enter your business name.");
      if (gs.value.trim() && !GSTIN_RE.test(gs.value.trim())) return bad("That GSTIN doesn't look right. It has 15 characters, like 24ABCDE1234F1Z5.");
    }
    btn.disabled = true; msg.className = "muted small"; msg.textContent = "Please wait…";
    try {
      if (tab === "up") {
        const { data, error } = await S.sb.auth.signUp({ email, password: pw.value });
        if (error) throw error;
        if (!data.session) throw new Error("Email not confirmed");
        const { error: e2 } = await S.sb.from("clients").insert({ user_id: data.user.id, name: nm.value.trim(), gstin: gs.value.trim(), phone: email.split("@")[0] });
        if (e2) throw e2;
        afterLogin(data.user.id);
      } else {
        const { data, error } = await S.sb.auth.signInWithPassword({ email, password: pw.value });
        if (error) throw error;
        afterLogin(data.user.id);
      }
    } catch (err) { bad(AUTH_ERR(err.message || String(err))); btn.disabled = false; }
  });
  setMain(false, h("div", { class: "panel stack" },
    h("h1", { text: tab === "up" ? "Create your DocBox account" : "Send your bills to " + (CFG.firmName || "your accountant") }),
    h("p", { class: "muted", text: tab === "up" ? "Use your own mobile number. After you sign up, the office approves your account and you can start sending documents." : "Purchase and sales bills, vouchers and bank statements, sorted by month for your books." }),
    tabs, form,
    tab === "in" ? h("p", { class: "small muted", text: "Forgot your password? Call the office and they will reset it." }) : null));
}

async function afterLogin(uid) {
  S.uid = uid;
  $("#signout").hidden = false;
  const { data } = await S.sb.from("staff").select("user_id").eq("user_id", uid).maybeSingle();
  S.office = !!data;
  if (S.office) startOffice(); else startClient();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
}
function refresh() { if (S.office) { loadClients(); if (S.sel) loadDocs(); } else loadMine(); }

/* ---------- upload (shared) ---------- */
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return file; }
  const max = 2200, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 1.6e6) return file;
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", 0.84));
}
function fileKind(f) {
  if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return f.type;
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "application/pdf";
  if (/\.csv$/i.test(f.name) || /csv/.test(f.type)) return "text/csv";
  if (/\.jpe?g$/i.test(f.name)) return "image/jpeg";
  if (/\.png$/i.test(f.name)) return "image/png";
  return null;
}
const EXT_OF = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf", "text/csv": "csv" };

function uploader(clientId, by, onDone) {
  const st = { type: lsGet("dbx-type") || "purchase", period: thisMonth() };
  const prog = h("div", { class: "prog", "aria-live": "polite" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Document type" });
  const drawChips = () => chips.replaceChildren(...Object.entries(TYPES).map(([k, t]) =>
    h("button", { class: "chip", type: "button", "aria-pressed": String(st.type === k), onclick: () => { st.type = k; lsSet("dbx-type", k); drawChips(); } }, t.label)));
  drawChips();
  const month = h("input", { type: "month", id: "up-month-" + by, value: st.period, onchange: e => st.period = e.target.value });
  const note = h("input", { type: "text", id: "up-note-" + by, placeholder: "e.g. Diesel bills for truck GJ06" });
  const pickFiles = h("input", { type: "file", id: "up-files-" + by, multiple: true, accept: "image/*,application/pdf,.pdf,.csv,text/csv", hidden: true });
  const pickCam = h("input", { type: "file", id: "up-cam-" + by, accept: "image/*", capture: "environment", hidden: true });
  async function run(files) {
    files = [...files]; if (!files.length) return;
    prog.replaceChildren(); let ok = 0;
    for (const f of files) {
      const line = h("div", { class: "muted small", text: "Sending " + f.name + "…" }); prog.append(line);
      const kind = fileKind(f);
      if (!kind) { line.className = "notice bad"; line.textContent = f.name + " is not a photo, PDF or CSV. Save Excel statements as PDF or CSV first."; continue; }
      try {
        const blob = await shrink(f);
        const mime = blob !== f ? "image/jpeg" : kind;
        if (blob.size > 20 * 1024 * 1024) throw new Error("too_large");
        const path = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT_OF[mime] || "bin"}`;
        const up = await S.sb.storage.from("docs").upload(path, blob, { contentType: mime, upsert: false });
        if (up.error) throw up.error;
        const ins = await S.sb.from("docs").insert({ client_id: clientId, type: st.type, period: st.period || thisMonth(), note: note.value.trim(),
          path, file_name: f.name, mime, size: blob.size, uploaded_by: by });
        if (ins.error) { S.sb.storage.from("docs").remove([path]); throw ins.error; }
        line.className = "notice ok"; line.textContent = f.name + " sent"; ok++;
      } catch (e) {
        line.className = "notice bad";
        const m = String(e.message || e);
        line.textContent = f.name + (m === "too_large" ? " is larger than 20 MB." : /row-level|policy|Unauthorized/i.test(m) ? " wasn't accepted. Your account may not be approved yet." : " could not be sent. Check your internet and try again.");
      }
    }
    if (ok) { note.value = ""; await S.sb.from("clients").update({ last_upload_at: nowISO() }).eq("id", clientId); toast(ok + (ok > 1 ? " documents" : " document") + " sent"); onDone && onDone(); }
    pickFiles.value = ""; pickCam.value = "";
  }
  pickFiles.onchange = e => run(e.target.files);
  pickCam.onchange = e => run(e.target.files);
  const drop = h("div", { class: "drop" },
    h("div", { class: "row" },
      h("button", { class: "btn primary big", type: "button", onclick: () => pickCam.click() }, "Take photo of bill"),
      h("button", { class: "btn big", type: "button", onclick: () => pickFiles.click() }, "Choose photos / PDF")),
    h("div", { class: "small muted", text: "Photos, PDF or CSV. You can pick many files at once." }), pickFiles, pickCam, prog);
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); run(e.dataTransfer.files); });
  return h("div", { class: "stack" },
    h("div", { class: "field" }, h("span", { class: "label", text: "What are you sending?" }), chips),
    h("div", { class: "grid2" },
      h("label", { class: "field", for: month.id }, h("span", { class: "label", text: "Month of the bills" }), month),
      h("label", { class: "field", for: note.id }, h("span", { class: "label", text: "Note (optional)" }), note)),
    drop);
}

/* ---------- client side ---------- */
async function startClient() {
  $("#role").textContent = "Client";
  await loadMine(true);
}
async function loadMine(first) {
  const { data, error } = await S.sb.from("clients").select("*").eq("user_id", S.uid).maybeSingle();
  if (error) { if (first) setMain(false, h("div", { class: "notice bad", text: "Couldn't load your account. Check your internet and reopen the app." })); return; }
  const prevApproved = S.me?.approved;
  S.me = data ? rowClient(data) : null;
  if (S.me) {
    const d = await S.sb.from("docs").select("*").eq("client_id", S.me.id).order("uploaded_at", { ascending: false }).limit(300);
    S.myDocs = (d.data || []).map(rowDoc);
  }
  if (first || prevApproved !== S.me?.approved || !$("#mylist")) renderClient(); else renderMyList();
}
function profileForm(onDone) {
  const p = S.me || {};
  const nm = h("input", { id: "pf-name", value: p.name || "" });
  const gs = h("input", { id: "pf-gstin", value: p.gstin || "", class: "mono", oninput: e => e.target.value = e.target.value.toUpperCase() });
  const msg = h("div");
  const f = h("form", { class: "stack" },
    h("label", { class: "field", for: "pf-name" }, h("span", { class: "label", text: "Business name" }), nm),
    h("label", { class: "field", for: "pf-gstin" }, h("span", { class: "label", text: "GSTIN" }), gs),
    msg, h("button", { class: "btn primary", type: "submit" }, S.me ? "Save details" : "Continue"));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const g = gs.value.trim();
    if (!nm.value.trim()) { msg.className = "notice bad"; msg.textContent = "Enter your business name."; return; }
    if (g && !GSTIN_RE.test(g)) { msg.className = "notice bad"; msg.textContent = "GSTIN should be 15 characters, like 24ABCDE1234F1Z5."; return; }
    const r = S.me ? await S.sb.from("clients").update({ name: nm.value.trim(), gstin: g }).eq("id", S.me.id)
      : await S.sb.from("clients").insert({ user_id: S.uid, name: nm.value.trim(), gstin: g, phone: "" });
    if (r.error) { msg.className = "notice bad"; msg.textContent = "Couldn't save. Try again."; return; }
    onDone && onDone(); loadMine(true);
  });
  return f;
}
function renderClient() {
  if (!S.me) { setMain(false, h("div", { class: "panel stack" }, h("h1", { text: "Your business details" }), profileForm())); return; }
  const editBox = h("details", {}, h("summary", { class: "small", text: "Edit my details" }), h("div", { style: "margin-top:12px" }, profileForm(() => toast("Details saved"))));
  setMain(false,
    h("div", {}, h("div", { class: "label", text: "Sending as" }), h("h1", { text: S.me.name }), S.me.gstin ? h("div", { class: "mono muted", text: S.me.gstin }) : null),
    S.me.approved ? h("div", { class: "panel" }, uploader(S.me.id, "client", () => loadMine()))
      : h("div", { class: "panel stack" }, h("h2", { text: "Waiting for approval" }),
        h("p", { class: "muted", text: (CFG.firmName || "Your accountant") + " will approve your account shortly. You can send documents once it's approved." }),
        h("button", { class: "btn", type: "button", onclick: () => loadMine(true) }, "Check again")),
    h("div", { class: "panel stack" }, h("h2", { text: "Sent so far" }), h("div", { id: "mylist" })),
    editBox);
  renderMyList();
}
function renderMyList() {
  const box = $("#mylist"); if (!box) return;
  if (!S.myDocs.length) { box.replaceChildren(h("p", { class: "muted", text: "Nothing sent yet. Each upload shows here with its status, from Received to Posted to books." })); return; }
  const groups = {};
  for (const it of S.myDocs) (groups[it.period] ||= []).push(it);
  box.replaceChildren(...Object.keys(groups).sort().reverse().map(k => h("div", {},
    h("div", { class: "monthhead", text: fmtPeriod(k) + " · " + groups[k].length }),
    h("div", {}, groups[k].map(it => {
      const confirm = h("span");
      const rm = it.status === "new" ? h("button", { class: "btn ghost small danger", type: "button", onclick: () => confirm.replaceChildren(
        h("button", { class: "btn small danger", type: "button", onclick: async () => {
          const r = await S.sb.from("docs").delete().eq("id", it.id);
          if (r.error) { toast("Couldn't remove it"); return; }
          S.sb.storage.from("docs").remove([it.path]); toast("Removed"); loadMine();
        } }, "Yes, remove")) }, "Remove") : null;
      return h("div", { class: "li" },
        h("div", { class: "t", text: it.fileName }),
        h("div", { class: "s", text: (TYPES[it.type]?.short || it.type) + " · sent " + fmtDate(it.uploadedAt) + (it.note ? " · " + it.note : "") }),
        h("div", { class: "r" }, h("span", { class: "pill " + it.status, text: CLIENT_STATUS[it.status] || it.status }), rm, confirm));
    })))));
}

/* ---------- office side ---------- */
async function startOffice() {
  $("#role").textContent = "Office";
  setMain(true, h("div", { class: "office", id: "office" }, h("aside", { class: "rail panel stack", id: "rail" }), h("div", { class: "detail stack", id: "detail" })));
  const s = await S.sb.from("settings").select("data").eq("id", 1).maybeSingle();
  S.settings = { ...DEFAULT_SETTINGS, ...(s.data?.data || {}) };
  await loadClients();
  renderDetail();
}
async function loadClients() {
  const { data, error } = await S.sb.from("clients").select("*");
  if (error) { toast("Couldn't load clients. Check your internet."); return; }
  S.clients = data.map(rowClient).sort((a, b) => (+!a.approved - +!b.approved) * -1 || (b.lastUploadAt || b.createdAt || "").localeCompare(a.lastUploadAt || a.createdAt || ""));
  renderRail(); if (S.sel) renderDetail();
}
async function loadDocs() {
  const id = S.sel;
  const { data, error } = await S.sb.from("docs").select("*").eq("client_id", id).order("uploaded_at", { ascending: false }).limit(1000);
  if (error || id !== S.sel) return;
  S.docs = data.map(rowDoc); renderDetail();
}
const isNew = c => c.lastUploadAt && (!c.seenAt || c.lastUploadAt > c.seenAt);
const client = () => S.clients.find(c => c.id === S.sel);
async function updClient(id, fields) { const r = await S.sb.from("clients").update(fields).eq("id", id); if (r.error) { toast("Couldn't save. " + r.error.message); return false; } await loadClients(); return true; }
async function updDoc(id, fields) { const r = await S.sb.from("docs").update(fields).eq("id", id); if (r.error) throw r.error; const d = S.docs.find(x => x.id === id); if (d) Object.assign(d, rowDoc({ ...toRow(d), ...fields })); return true; }
const toRow = d => ({ id: d.id, client_id: d.clientId, type: d.type, period: d.period, note: d.note, path: d.path, file_name: d.fileName, mime: d.mime, size: d.size,
  uploaded_at: d.uploadedAt, uploaded_by: d.by, status: d.status, ext: d.ext, read_at: d.readAt, exported_at: d.exportedAt });

function renderRail() {
  const rail = $("#rail"); if (!rail) return;
  const waiting = S.clients.filter(c => !c.approved).length;
  rail.replaceChildren(
    h("div", { class: "row" }, h("h2", { text: "Clients" }), h("span", { class: "spacer" }), h("button", { class: "btn ghost small", type: "button", onclick: () => { loadClients(); if (S.sel) loadDocs(); } }, "Refresh")),
    waiting ? h("div", { class: "notice warn small", text: waiting + " new sign-up" + (waiting > 1 ? "s" : "") + " waiting for approval" }) : null,
    S.clients.length ? h("div", { class: "clist", role: "list" }, S.clients.map(c => h("button", {
      class: "cbtn", role: "listitem", "aria-current": String(S.sel === c.id), type: "button", onclick: () => selectClient(c.id) },
      h("span", { class: "nm", text: c.name || "Unnamed client" }),
      isNew(c) || !c.approved ? h("span", { class: "dot", title: c.approved ? "New uploads" : "Waiting for approval" }) : h("span"),
      h("span", { class: "gs", text: !c.approved ? "Waiting for approval" : (c.gstin || "No GSTIN") + (c.offline ? " · office" : "") }))))
      : h("p", { class: "small muted", text: "No clients yet. Send clients the app link; they sign up with their mobile number and appear here for approval." }),
    h("details", {}, h("summary", { class: "small", text: "Add a client yourself" }), h("div", { class: "stack", style: "margin-top:10px" }, addClientForm())),
    h("button", { class: "btn small", type: "button", onclick: openSettings }, "Tally ledgers & AI settings"));
}
function addClientForm() {
  const nm = h("input", { id: "ac-name", placeholder: "Business name" });
  const gs = h("input", { id: "ac-gstin", placeholder: "GSTIN", class: "mono", oninput: e => e.target.value = e.target.value.toUpperCase() });
  const msg = h("div", { class: "small muted", text: "For clients who keep using WhatsApp. You upload their files here." });
  const f = h("form", { class: "stack" },
    h("label", { class: "field", for: "ac-name" }, h("span", { class: "label", text: "Name" }), nm),
    h("label", { class: "field", for: "ac-gstin" }, h("span", { class: "label", text: "GSTIN" }), gs), msg,
    h("button", { class: "btn", type: "submit" }, "Add client"));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    if (!nm.value.trim()) { msg.className = "notice bad"; msg.textContent = "Enter a name."; return; }
    if (gs.value && !GSTIN_RE.test(gs.value.trim())) { msg.className = "notice bad"; msg.textContent = "GSTIN should be 15 characters, like 24ABCDE1234F1Z5."; return; }
    const r = await S.sb.from("clients").insert({ name: nm.value.trim(), gstin: gs.value.trim(), offline: true, approved: true }).select().single();
    if (r.error) { msg.className = "notice bad"; msg.textContent = "Couldn't add the client. " + r.error.message; return; }
    await loadClients(); selectClient(r.data.id);
  });
  return f;
}
function selectClient(id) {
  S.sel = id; S.docs = []; S.filter = { month: "", type: "all" };
  const c = client();
  if (c && isNew(c)) S.sb.from("clients").update({ seen_at: nowISO() }).eq("id", id).then(() => { c.seenAt = nowISO(); renderRail(); });
  $("#office").classList.add("has-sel");
  renderRail(); renderDetail(); loadDocs();
}
function filtered() { return S.docs.filter(i => (!S.filter.month || i.period === S.filter.month) && (S.filter.type === "all" || i.type === S.filter.type)); }
function itemAmount(it) {
  const x = it.ext; if (!x) return "";
  if (it.type === "bank") { const t = x.transactions || []; return t.length ? t.length + " entries" : ""; }
  return x.total ? inr(x.total) : (x.amount ? inr(x.amount) : "");
}
function renderDetail() {
  const d = $("#detail"); if (!d) return;
  const c = client();
  if (!c) {
    d.replaceChildren(h("div", { class: "panel stack" }, h("h1", { text: "Pick a client" }),
      h("p", { class: "muted", text: "Each client's bills, vouchers and statements arrive here sorted by month." }),
      h("ol", { class: "muted small" },
        h("li", { text: "Client sends from the DocBox app (or you upload their WhatsApp files)." }),
        h("li", { text: "Open a document and choose Read with AI to fill party, GSTIN, invoice number and rate-wise amounts." }),
        h("li", { text: "Correct anything wrong and mark it Checked." }),
        h("li", { text: "Export to Tally on your computer, then import in Gateway of Tally → Import Data." }))));
    return;
  }
  const months = [...new Set(S.docs.map(i => i.period))].sort().reverse();
  const inMonth = i => !S.filter.month || i.period === S.filter.month;
  const counts = { all: S.docs.filter(inMonth).length };
  for (const k of Object.keys(TYPES)) counts[k] = S.docs.filter(i => i.type === k && inMonth(i)).length;
  const list = filtered();
  const unread = list.filter(i => i.status === "new" && i.type !== "other");
  const ready = list.filter(i => i.status === "checked" && i.type !== "other" && i.ext);
  const monthSel = h("select", { id: "f-month", class: "cell", style: "width:auto;min-height:38px", onchange: e => { S.filter.month = e.target.value; renderDetail(); } },
    h("option", { value: "", text: "All months" }), months.map(m => h("option", { value: m, text: fmtPeriod(m), selected: S.filter.month === m })));
  const rows = list.map(it => h("tr", { class: "click", tabindex: "0", onclick: () => openItem(it.id), onkeydown: e => { if (e.key === "Enter") openItem(it.id); } },
    h("td", {}, h("span", { class: "tag", text: TYPES[it.type]?.short || it.type })),
    h("td", { class: "fn" }, h("div", { text: it.fileName, title: it.fileName }), it.ext?.partyName ? h("div", { class: "small muted", text: it.ext.partyName }) : (it.note ? h("div", { class: "small muted", text: it.note }) : null)),
    h("td", { class: "small", text: fmtPeriod(it.period) }),
    h("td", { class: "r num small", text: itemAmount(it) }),
    h("td", {}, h("span", { class: "pill " + it.status, text: STATUS[it.status] || it.status })),
    h("td", { class: "small muted", text: (it.by === "office" ? "Office · " : "") + fmtDate(it.uploadedAt) })));
  const hasKey = !!lsGet("dbx-akey");
  const batchBtn = S.batch
    ? h("button", { class: "btn", type: "button", onclick: () => S.batch.ctl.abort() }, "Stop reading (" + S.batch.done + "/" + S.batch.total + ")")
    : h("button", { class: "btn", type: "button", disabled: !unread.length || !hasKey, onclick: () => readMany(unread) }, "Read " + unread.length + " new with AI");
  d.replaceChildren(
    h("div", { class: "row" },
      h("button", { class: "btn ghost back", type: "button", onclick: () => { S.sel = null; $("#office").classList.remove("has-sel"); renderRail(); } }, "← Clients"),
      h("div", { style: "min-width:0" }, h("h1", { text: c.name || "Unnamed client" }),
        h("div", { class: "mono muted small", text: (c.gstin || "No GSTIN") + (c.gstin && STATES[c.gstin.slice(0, 2)] ? " · " + STATES[c.gstin.slice(0, 2)] : "") + (c.phone ? " · " + c.phone : "") }))),
    !c.approved ? h("div", { class: "notice warn row" }, h("span", { text: "This client signed up and is waiting for approval. Check the name and mobile number before approving." }), h("span", { class: "spacer" }),
      h("button", { class: "btn primary", type: "button", onclick: () => updClient(c.id, { approved: true }).then(ok => ok && toast("Approved")) }, "Approve")) : null,
    h("div", { class: "panel stack" },
      h("details", {}, h("summary", { class: "small", text: "Tally company & bank ledger for this client" }), tallyForm(c)),
      c.approved ? h("details", {}, h("summary", { class: "small", text: "Upload files for this client (from WhatsApp or email)" }), h("div", { style: "margin-top:12px" }, uploader(c.id, "office", loadDocs))) : null,
      c.approved && !c.offline ? h("button", { class: "btn ghost danger small", type: "button", style: "align-self:flex-start", onclick: () => updClient(c.id, { approved: false }).then(ok => ok && toast("Uploads blocked for this client")) }, "Block uploads from this client") : null),
    h("div", { class: "row" }, monthSel,
      h("div", { class: "chips" }, ["all", ...Object.keys(TYPES)].map(k => h("button", { class: "chip", type: "button", "aria-pressed": String(S.filter.type === k),
        onclick: () => { S.filter.type = k; renderDetail(); } }, k === "all" ? "All" : TYPES[k].short, h("span", { class: "n", text: String(counts[k]) }))))),
    list.length ? h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Type", "Document", "Month", "Amount", "Status", "Received"].map((t, i) => h("th", { class: i === 3 ? "r" : "", text: t })))),
      h("tbody", {}, rows)))
      : h("div", { class: "panel muted", text: S.docs.length ? "No documents match this month and type." : "No documents from this client yet." }),
    h("div", { class: "exportbar" },
      h("div", { class: "stack", style: "gap:2px" },
        h("strong", { text: ready.length + " checked document" + (ready.length === 1 ? "" : "s") + " ready for Tally" }),
        h("span", { class: "small muted", text: "Only documents marked Checked go into the export, so nothing is posted twice." })),
      h("span", { class: "spacer" }), batchBtn,
      h("button", { class: "btn primary", type: "button", disabled: !ready.length, onclick: () => exportTally(c, ready) }, "Export to Tally")),
    !hasKey ? h("div", { class: "notice warn", text: "To read bills with AI, add your Anthropic API key in Tally ledgers & AI settings. You can still type figures in by hand." }) : null,
    S.inApp ? h("div", { class: "notice info", text: "Tally export downloads files, so do it from your computer's browser." }) : null);
}
function tallyForm(c) {
  const co = h("input", { id: "tf-co", value: c.tallyCompany || "", placeholder: c.name || "" });
  const bk = h("input", { id: "tf-bank", value: c.tallyBank || "", placeholder: "HDFC Bank A/c 1234" });
  const f = h("form", { class: "grid2", style: "margin-top:12px;align-items:end" },
    h("label", { class: "field", for: "tf-co" }, h("span", { class: "label", text: "Company name in Tally" }), co),
    h("label", { class: "field", for: "tf-bank" }, h("span", { class: "label", text: "Bank ledger in Tally" }), bk),
    h("button", { class: "btn", type: "submit" }, "Save"));
  f.addEventListener("submit", async e => { e.preventDefault(); if (await updClient(c.id, { tally_company: co.value.trim(), tally_bank: bk.value.trim() })) toast("Saved"); });
  return f;
}
function openSettings() {
  const st = { ...S.settings };
  const fields = [["purchaseLedger", "Purchase ledger"], ["salesLedger", "Sales ledger"], ["expenseLedger", "Expense ledger"],
    ["inCgst", "Input CGST"], ["inSgst", "Input SGST"], ["inIgst", "Input IGST"], ["outCgst", "Output CGST"], ["outSgst", "Output SGST"], ["outIgst", "Output IGST"],
    ["roundOff", "Round off"], ["suspense", "Unknown party / unmapped bank entries"],
    ["vtPurchase", "Purchase voucher type"], ["vtSales", "Sales voucher type"], ["vtPayment", "Payment voucher type"], ["vtReceipt", "Receipt voucher type"]];
  const cp = h("input", { type: "checkbox", id: "st-cp", checked: !!st.createParties });
  const key = h("input", { id: "st-key", type: "password", value: lsGet("dbx-akey") || "", placeholder: "sk-ant-…", autocomplete: "off" });
  const model = h("input", { id: "st-model", value: lsGet("dbx-model") || DEFAULT_MODEL });
  const body = h("form", { class: "stack", style: "padding:18px;max-width:760px" },
    h("h2", { text: "Tally ledger names" }),
    h("p", { class: "muted small", text: "Write ledger names exactly as they appear in Tally. {rate} becomes the GST rate (18), {half} becomes half of it (9). Rate 18 with “Input CGST @{half}%” gives “Input CGST @9%”." }),
    h("div", { class: "grid2" }, fields.map(([k, l]) => h("label", { class: "field", for: "st-" + k }, h("span", { class: "label", text: l }),
      h("input", { id: "st-" + k, value: st[k], oninput: e => st[k] = e.target.value })))),
    h("label", { class: "row", for: "st-cp" }, cp, h("span", { text: "Also export a ledgers file that creates missing party ledgers (with GSTIN and state)" })),
    h("h2", { text: "AI reading" }),
    h("p", { class: "muted small", text: "Reading bills uses your own Anthropic API key, billed by Anthropic per document. The key is saved only in this browser on this computer, never in the database." }),
    h("div", { class: "grid2" },
      h("label", { class: "field", for: "st-key" }, h("span", { class: "label", text: "Anthropic API key" }), key),
      h("label", { class: "field", for: "st-model" }, h("span", { class: "label", text: "Model" }), model)),
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, "Save settings"),
      h("button", { class: "btn ghost", type: "button", onclick: () => { for (const k of Object.keys(DEFAULT_SETTINGS)) { const el = document.getElementById("st-" + k); if (el) { el.value = DEFAULT_SETTINGS[k]; st[k] = DEFAULT_SETTINGS[k]; } } cp.checked = true; } }, "Reset ledger names")));
  body.addEventListener("submit", async e => {
    e.preventDefault(); st.createParties = cp.checked;
    lsSet("dbx-akey", key.value.trim()); lsSet("dbx-model", model.value.trim() || DEFAULT_MODEL);
    const r = await S.sb.from("settings").upsert({ id: 1, data: st });
    if (r.error) { toast("Couldn't save ledger names. " + r.error.message); return; }
    S.settings = { ...st }; toast("Settings saved"); closeSheet(); renderDetail();
  });
  showSheet("Settings", [], body);
}

/* ---------- sheet ---------- */
function showSheet(title, actions, body) {
  const veil = h("div", { class: "veil", onclick: e => { if (e.target === veil) closeSheet(); } },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "sheethead" }, h("button", { class: "btn ghost", type: "button", onclick: closeSheet }, "← Back"), h("h2", { text: title, style: "min-width:0;overflow-wrap:anywhere" }), h("span", { class: "spacer" }), actions),
      body));
  $("#sheetRoot").replaceChildren(veil);
  document.addEventListener("keydown", escClose);
}
function escClose(e) { if (e.key === "Escape") closeSheet(); }
function closeSheet() { $("#sheetRoot").replaceChildren(); document.removeEventListener("keydown", escClose); renderDetail(); }

async function renderPreview(it, box) {
  const { data, error } = await S.sb.storage.from("docs").createSignedUrl(it.path, 3600);
  if (error) { box.replaceChildren(h("p", { class: "muted small", text: "Preview isn't available for this file." })); return null; }
  const url = data.signedUrl;
  if (it.mime === "application/pdf") box.replaceChildren(S.inApp ? h("p", { class: "muted small", text: "PDF preview opens outside the app." }) : h("iframe", { src: url, title: it.fileName }));
  else if (it.mime === "text/csv") { try { const t = await (await fetch(url)).text(); box.replaceChildren(h("pre", { class: "mono", text: t.split(/\r?\n/).slice(0, 40).join("\n") })); } catch { box.replaceChildren(h("p", { class: "muted small", text: "Preview isn't available." })); } }
  else box.replaceChildren(h("img", { src: url, alt: it.fileName }));
  return url;
}
function openItem(id) {
  const it = S.docs.find(i => i.id === id); if (!it) return;
  const c = client();
  const prev = h("div", { class: "preview" }, h("p", { class: "muted small", text: "Loading preview…" }));
  const openLink = h("a", { class: "small", target: "_blank", rel: "noopener", text: "Open original file" });
  renderPreview(it, prev).then(u => { if (u) openLink.href = u; });
  const work = h("div", { class: "stack" });
  const statusSel = h("select", { id: "it-status", class: "cell", style: "width:auto;min-height:38px", onchange: async e => {
    try { await updDoc(it.id, { status: e.target.value }); toast("Status changed"); } catch { toast("Couldn't change status"); } } },
    Object.entries(STATUS).map(([k, l]) => h("option", { value: k, text: l, selected: it.status === k })));
  const confirm = h("span");
  const del = h("button", { class: "btn ghost danger", type: "button", onclick: () => confirm.replaceChildren(
    h("button", { class: "btn danger", type: "button", onclick: async () => {
      const r = await S.sb.from("docs").delete().eq("id", it.id);
      if (r.error) { toast("Couldn't delete"); return; }
      await S.sb.storage.from("docs").remove([it.path]);
      S.docs = S.docs.filter(x => x.id !== it.id); closeSheet(); toast("Document deleted");
    } }, "Delete for good")) }, "Delete");
  const drawWork = () => work.replaceChildren(workArea(it, c));
  showSheet(it.fileName, [statusSel, del, confirm], h("div", { class: "sheetbody" },
    h("div", { class: "stack" },
      h("div", { class: "row small muted" }, h("span", { class: "tag", text: TYPES[it.type]?.label }), h("span", { text: fmtPeriod(it.period) }), h("span", { text: "received " + fmtDate(it.uploadedAt) })),
      it.note ? h("div", { class: "notice info", text: "Client's note: " + it.note }) : null,
      h("label", { class: "field", for: "it-type" }, h("span", { class: "label", text: "Document type" }),
        h("select", { id: "it-type", onchange: async e => { try { await updDoc(it.id, { type: e.target.value }); drawWork(); } catch { toast("Couldn't change type"); } } },
          Object.entries(TYPES).map(([k, t]) => h("option", { value: k, text: t.label, selected: it.type === k })))),
      prev, openLink),
    work));
  drawWork();
}

/* ---------- AI reading (Anthropic API, office only) ---------- */
function blobToB64(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); }); }
function parseJSON(t) {
  t = String(t || "").trim();
  try { return JSON.parse(t); } catch {}
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}
function buildPrompt(it, c, text) {
  const who = `The business that sent this document is "${c.name || "unknown"}"${c.gstin ? " with GSTIN " + c.gstin : ""}.`;
  const head = `You are helping an Indian chartered accountant post entries in Tally. ${who} The client labelled this document as: ${TYPES[it.type].label}.${it.note ? " Client's note: " + it.note : ""}\n`;
  const src = text ? `\nFile contents:\n<<<\n${text}\n>>>\n` : "";
  if (it.type === "bank") return head + src + `
Read every transaction in this bank statement. Reply with only JSON in this shape:
{"bankName":"","accountLast4":"","from":"YYYY-MM-DD","to":"YYYY-MM-DD","transactions":[{"date":"YYYY-MM-DD","narration":"","ref":"","debit":0,"credit":0}],"notes":""}
Rules: debit = money going out (withdrawal), credit = money coming in (deposit). Amounts are plain numbers in rupees, no commas. Skip opening/closing balance rows. Give only the last 4 digits of the account number. Put anything doubtful (unreadable rows, pages missing) in notes.`;
  if (it.type === "other") return head + src + `
Describe this document for the accountant. Reply with only JSON: {"kind":"","summary":"","date":"YYYY-MM-DD or empty","amount":0,"notes":""}. summary is one or two plain sentences on what it is and what action it may need in the books.`;
  const party = it.type === "sales" ? "the customer (buyer) the bill is issued to" : "the supplier (seller) who issued the bill";
  return head + src + `
Extract the tax invoice or voucher details. The party is ${party}, never the client business itself.
Reply with only JSON in this shape:
{"partyName":"","partyGstin":"","invoiceNo":"","invoiceDate":"YYYY-MM-DD","placeOfSupply":"","lines":[{"rate":18,"taxable":0,"cgst":0,"sgst":0,"igst":0}],"roundOff":0,"total":0,"notes":""}
Rules: group all items by GST rate, one line per rate, with the summed taxable value and tax amounts for that rate. Use cgst+sgst for intra-state bills and igst for inter-state. Exempt or nil-rated items go on a line with rate 0. roundOff is the round-off shown on the bill (negative if deducted). total is the final invoice amount. Amounts are plain numbers in rupees, no commas. Use "" or 0 when a value isn't on the document. In notes mention anything doubtful: unclear digits, not a tax invoice, more than one invoice in the file, or totals that don't add up.`;
}
function normBill(x) {
  x = x && typeof x === "object" ? x : {};
  const lines = Array.isArray(x.lines) && x.lines.length ? x.lines : [{}];
  return { partyName: String(x.partyName || ""), partyGstin: String(x.partyGstin || "").toUpperCase().replace(/\s/g, ""), invoiceNo: String(x.invoiceNo || ""),
    invoiceDate: String(x.invoiceDate || ""), placeOfSupply: String(x.placeOfSupply || ""), notes: String(x.notes || ""),
    lines: lines.map(l => ({ rate: +l.rate || 0, taxable: r2(l.taxable), cgst: r2(l.cgst), sgst: r2(l.sgst), igst: r2(l.igst), ledger: String(l.ledger || "") })),
    roundOff: r2(x.roundOff), total: r2(x.total) };
}
function normBank(x) {
  x = x && typeof x === "object" ? x : {};
  return { bankName: String(x.bankName || ""), accountLast4: String(x.accountLast4 || "").slice(-4), from: String(x.from || ""), to: String(x.to || ""), notes: String(x.notes || ""),
    transactions: (Array.isArray(x.transactions) ? x.transactions : []).map(t => ({ date: String(t.date || ""), narration: String(t.narration || ""), ref: String(t.ref || ""), debit: r2(t.debit), credit: r2(t.credit), ledger: String(t.ledger || "") })) };
}
function normOther(x) { x = x && typeof x === "object" ? x : {}; return { kind: String(x.kind || ""), summary: String(x.summary || ""), date: String(x.date || ""), amount: r2(x.amount), notes: String(x.notes || "") }; }
const norm = (type, x) => type === "bank" ? normBank(x) : type === "other" ? normOther(x) : normBill(x);

const AI_ERR = { nokey: "Add your Anthropic API key in Settings first.", fetch: "The file couldn't be loaded. Check your internet.", invalid_json: "The reply couldn't be understood. Try again.",
  401: "The Anthropic API key is wrong. Check it in Settings.", 403: "This API key isn't allowed to do this. Check it in your Anthropic account.",
  429: "Too many requests or your API credit has run out. Wait a minute, or add credit in your Anthropic account.",
  529: "The AI service is busy. Try again in a few minutes.", 404: "The model name in Settings isn't valid.", cancelled: "Stopped." };
function aiErrText(e) { return AI_ERR[e?.status] || AI_ERR[e?.code] || (e?.message ? "Reading failed: " + e.message : "Reading failed. Try again, or type the figures in."); }

async function readOne(it, c, signal, onStage) {
  const key = lsGet("dbx-akey"); if (!key) throw { code: "nokey" };
  onStage && onStage("Loading the file…");
  const { data: blob, error } = await S.sb.storage.from("docs").download(it.path);
  if (error || !blob) throw { code: "fetch" };
  const content = []; let text = "";
  if (it.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: await blobToB64(blob) } });
  else if (it.mime === "text/csv") text = (await blob.text()).slice(0, 150000);
  else content.push({ type: "image", source: { type: "base64", media_type: it.mime, data: await blobToB64(blob) } });
  content.push({ type: "text", text: buildPrompt(it, c, text) + "\nReply with the JSON only, no other text." });
  onStage && onStage("Reading the document… this takes 15–60 seconds.");
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: lsGet("dbx-model") || DEFAULT_MODEL, max_tokens: 16000, messages: [{ role: "user", content }] }) });
  } catch (e) { if (e?.name === "AbortError") throw { code: "cancelled" }; throw { code: "fetch" }; }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw { status: r.status, message: j?.error?.message }; }
  const j = await r.json();
  const out = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const data = parseJSON(out); if (!data) throw { code: "invalid_json" };
  const ext = norm(it.type, data);
  if (j.stop_reason === "max_tokens") ext.notes = ((ext.notes || "") + " The reply was cut short: some entries may be missing.").trim();
  await updDoc(it.id, { ext, read_at: nowISO(), status: it.status === "new" ? "read" : it.status });
  return ext;
}
async function readMany(list) {
  const c = client(); if (!c || S.batch) return;
  S.batch = { ctl: new AbortController(), done: 0, total: list.length }; renderDetail();
  let failed = 0, msg = "";
  for (const it of list) {
    if (S.batch.ctl.signal.aborted) break;
    try { await readOne(it, c, S.batch.ctl.signal); }
    catch (e) { if (e?.code === "cancelled") break; failed++; msg = aiErrText(e); if ([401, 403, 429, 404].includes(e?.status) || e?.code === "nokey") break; }
    S.batch.done++; renderDetail();
  }
  const done = S.batch.done; S.batch = null; renderDetail();
  toast(failed ? `Read ${done - failed}, ${failed} failed. ${msg}` : `Read ${done} document${done === 1 ? "" : "s"}. Check each one before export.`);
}

/* ---------- review forms ---------- */
function workArea(it, c) {
  const status = h("div", { "aria-live": "polite" });
  let ctl = null;
  const form = h("div", {}, formFor(it, c));
  const readBtn = h("button", { class: "btn primary", type: "button", onclick: async () => {
    if (ctl) { ctl.abort(); return; }
    ctl = new AbortController(); readBtn.textContent = "Stop";
    status.className = "notice info";
    try {
      await readOne(it, c, ctl.signal, t => status.textContent = t);
      status.className = "notice ok"; status.textContent = "Read. Check every figure against the bill before marking it Checked.";
      form.replaceChildren(formFor(it, c));
    } catch (e) { status.className = "notice bad"; status.textContent = aiErrText(e); }
    ctl = null; readBtn.textContent = it.ext ? "Read again with AI" : "Read with AI";
  } }, it.ext ? "Read again with AI" : "Read with AI");
  return h("div", { class: "stack" }, h("div", { class: "row" }, readBtn, it.readAt ? h("span", { class: "small muted", text: "Last read " + fmtDate(it.readAt) }) : null), status, form);
}
function formFor(it, c) { return it.type === "bank" ? bankForm(it, c) : it.type === "other" ? otherForm(it) : billForm(it, c); }
function numIn(id, val, on, cls = "cell n") { return h("input", { id, class: cls, inputmode: "decimal", value: val ? String(val) : "", oninput: e => on(r2(e.target.value.replace(/,/g, ""))) }); }
async function saveExt(it, x, mark) {
  const upd = { ext: x }; if (mark) upd.status = "checked";
  try { await updDoc(it.id, upd); if (mark) { const sel = $("#it-status"); if (sel) sel.value = "checked"; } toast(mark ? "Saved and marked Checked" : "Saved"); }
  catch { toast("Couldn't save. Check your internet."); }
}
function defaultLedger(type, rate) { const s = S.settings; return pat(type === "sales" ? s.salesLedger : type === "expense" ? s.expenseLedger : s.purchaseLedger, rate); }

function billForm(it, c) {
  const x = normBill(it.ext);
  const checks = h("div", { class: "stack", style: "gap:6px" });
  const tbody = h("tbody");
  const totals = h("div", { class: "row small" });
  function runChecks() {
    const sum = x.lines.reduce((a, l) => a + l.taxable + l.cgst + l.sgst + l.igst, 0);
    const calc = r2(sum + x.roundOff);
    totals.replaceChildren(h("span", { class: "muted", text: "Lines + round off" }), h("span", { class: "num", text: inr(calc) }), h("span", { class: "spacer" }),
      h("span", { class: "muted", text: "Bill total" }), h("strong", { class: "num", text: inr(x.total) }));
    const out = [];
    if (!x.partyName) out.push(["bad", "Party name is missing. Unknown parties post to " + S.settings.suspense + "."]);
    if (x.partyGstin && !GSTIN_RE.test(x.partyGstin)) out.push(["bad", "Party GSTIN isn't in the right format."]);
    if (x.partyGstin && c.gstin && x.partyGstin === c.gstin) out.push(["bad", "Party GSTIN is the client's own GSTIN. The party should be the other side of the bill."]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.invoiceDate)) out.push(["bad", "Invoice date is missing. Tally needs it."]);
    else if (it.period && x.invoiceDate.slice(0, 7) !== it.period) out.push(["warn", "Invoice date is outside " + fmtPeriod(it.period) + ", the month the client chose."]);
    if (x.total && Math.abs(calc - x.total) > 1) out.push(["warn", "Lines don't add up to the bill total (difference " + inr(r2(x.total - calc)) + ")."]);
    for (const l of x.lines) {
      const exp = l.taxable * l.rate / 100, got = l.cgst + l.sgst + l.igst;
      if (l.rate && Math.abs(exp - got) > Math.max(1, exp * 0.01)) out.push(["warn", `Tax on the ${fmtRate(l.rate)}% line is ${inr(got)}, expected about ${inr(r2(exp))}.`]);
      if (l.igst && (l.cgst || l.sgst)) out.push(["warn", `The ${fmtRate(l.rate)}% line has both IGST and CGST/SGST.`]);
    }
    if (x.partyGstin && c.gstin) {
      const inter = x.partyGstin.slice(0, 2) !== c.gstin.slice(0, 2), anyI = x.lines.some(l => l.igst), anyC = x.lines.some(l => l.cgst || l.sgst);
      if (inter && anyC) out.push(["warn", "Party is in another state but the bill has CGST/SGST."]);
      if (!inter && anyI) out.push(["warn", "Party is in the same state but the bill has IGST."]);
    }
    const dup = S.docs.find(o => o.id !== it.id && o.ext && o.type === it.type && x.invoiceNo && String(o.ext.invoiceNo || "").trim().toLowerCase() === x.invoiceNo.trim().toLowerCase()
      && (o.ext.partyGstin || o.ext.partyName) === (x.partyGstin || x.partyName));
    if (dup) out.push(["bad", `Possible duplicate: ${dup.fileName} has the same invoice number (${STATUS[dup.status]}).`]);
    if (x.notes) out.push(["info", "AI note: " + x.notes]);
    checks.replaceChildren(...(out.length ? out : [["ok", "Figures add up."]]).map(([k, t]) => h("div", { class: "notice " + k, text: t })));
  }
  function drawLines() {
    tbody.replaceChildren(...x.lines.map((l, i) => h("tr", {},
      h("td", {}, numIn(`ln-r-${i}`, l.rate, v => { l.rate = v; runChecks(); const el = document.getElementById(`ln-l-${i}`); if (el) el.placeholder = defaultLedger(it.type, v); }, "cell n rate")),
      h("td", {}, numIn(`ln-t-${i}`, l.taxable, v => { l.taxable = v; runChecks(); })),
      h("td", {}, numIn(`ln-c-${i}`, l.cgst, v => { l.cgst = v; runChecks(); })),
      h("td", {}, numIn(`ln-s-${i}`, l.sgst, v => { l.sgst = v; runChecks(); })),
      h("td", {}, numIn(`ln-i-${i}`, l.igst, v => { l.igst = v; runChecks(); })),
      h("td", {}, h("input", { id: `ln-l-${i}`, class: "cell", style: "min-width:150px", value: l.ledger, placeholder: defaultLedger(it.type, l.rate), oninput: e => l.ledger = e.target.value })),
      h("td", {}, x.lines.length > 1 ? h("button", { class: "btn ghost danger small", type: "button", "aria-label": "Remove line", onclick: () => { x.lines.splice(i, 1); drawLines(); runChecks(); } }, "×") : null))));
  }
  drawLines();
  const fld = (id, label, key, attrs = {}) => h("label", { class: "field", for: id }, h("span", { class: "label", text: label }),
    h("input", { id, value: x[key], class: attrs.class, type: attrs.type, oninput: e => { x[key] = attrs.upper ? e.target.value.toUpperCase().replace(/\s/g, "") : e.target.value; if (attrs.upper) e.target.value = x[key]; runChecks(); } }));
  const pane = h("div", { class: "stack" },
    h("div", { class: "grid2" },
      fld("b-party", it.type === "sales" ? "Customer" : "Supplier", "partyName"),
      fld("b-gstin", "Party GSTIN", "partyGstin", { class: "mono", upper: true }),
      fld("b-inv", "Invoice no.", "invoiceNo", { class: "mono" }),
      fld("b-date", "Invoice date", "invoiceDate", { type: "date" })),
    h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Rate %", "Taxable", "CGST", "SGST", "IGST", "Ledger (blank = default)", ""].map((t, i) => h("th", { class: i > 0 && i < 5 ? "r" : "", text: t })))), tbody)),
    h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => { x.lines.push({ rate: 18, taxable: 0, cgst: 0, sgst: 0, igst: 0, ledger: "" }); drawLines(); runChecks(); } }, "Add rate line"),
      h("span", { class: "spacer" }),
      h("label", { class: "row", for: "b-ro" }, h("span", { class: "label", text: "Round off" }), numIn("b-ro", x.roundOff, v => { x.roundOff = v; runChecks(); })),
      h("label", { class: "row", for: "b-tot" }, h("span", { class: "label", text: "Bill total" }), numIn("b-tot", x.total, v => { x.total = v; runChecks(); }))),
    totals, checks,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: () => saveExt(it, normBill(x), false) }, "Save"),
      h("button", { class: "btn primary", type: "button", onclick: () => saveExt(it, normBill(x), true) }, "Save & mark Checked")));
  runChecks();
  return pane;
}
function bankForm(it, c) {
  const x = normBank(it.ext);
  const tbody = h("tbody"), sumBox = h("div", { class: "row small" });
  function sums() {
    const dr = x.transactions.reduce((a, t) => a + t.debit, 0), cr = x.transactions.reduce((a, t) => a + t.credit, 0), un = x.transactions.filter(t => !t.ledger).length;
    sumBox.replaceChildren(h("span", { class: "muted", text: x.transactions.length + " entries" }), h("span", { class: "spacer" }),
      h("span", { class: "muted", text: "Withdrawals" }), h("span", { class: "num", text: inr(dr) }), h("span", { class: "muted", text: "Deposits" }), h("span", { class: "num", text: inr(cr) }),
      un ? h("span", { class: "pill read", text: un + " go to " + S.settings.suspense }) : h("span", { class: "pill exported", text: "All mapped" }));
  }
  function draw() {
    tbody.replaceChildren(...x.transactions.map((t, i) => h("tr", {},
      h("td", { class: "num small", style: "white-space:nowrap", text: t.date }),
      h("td", { class: "small", style: "min-width:200px", text: t.narration + (t.ref ? " · " + t.ref : "") }),
      h("td", { class: "r num small", text: t.debit ? inr(t.debit) : "" }),
      h("td", { class: "r num small", text: t.credit ? inr(t.credit) : "" }),
      h("td", {}, h("input", { id: `bk-l-${i}`, class: "cell", style: "min-width:150px", value: t.ledger, placeholder: S.settings.suspense, oninput: e => { t.ledger = e.target.value; sums(); } })))));
    sums();
  }
  draw();
  const mText = h("input", { id: "bk-m-t", class: "cell", placeholder: "Narration contains, e.g. RENT" });
  const mLed = h("input", { id: "bk-m-l", class: "cell", placeholder: "Ledger, e.g. Rent A/c" });
  return h("div", { class: "stack" },
    h("div", { class: "row small muted" }, h("span", { text: (x.bankName || "Bank") + (x.accountLast4 ? " ··" + x.accountLast4 : "") }), x.from ? h("span", { text: x.from + " to " + x.to }) : null,
      h("span", { text: "Posts against: " + (c.tallyBank || "(set the client's bank ledger)") })),
    !c.tallyBank ? h("div", { class: "notice warn", text: "Set this client's bank ledger name (Tally company & bank ledger, on the client page) before exporting." }) : null,
    h("div", { class: "panel stack", style: "padding:12px" }, h("span", { class: "label", text: "Map many entries at once" }),
      h("div", { class: "row" }, mText, mLed, h("button", { class: "btn", type: "button", onclick: () => {
        const q = mText.value.trim().toLowerCase(); if (!q || !mLed.value.trim()) return;
        let n = 0; for (const t of x.transactions) if ((t.narration + " " + t.ref).toLowerCase().includes(q)) { t.ledger = mLed.value.trim(); n++; }
        draw(); toast(n + " entries mapped"); } }, "Apply"))),
    sumBox,
    x.transactions.length ? h("div", { class: "tablewrap", style: "max-height:55vh;overflow:auto" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Date", "Narration", "Withdrawal", "Deposit", "Ledger"].map((t, i) => h("th", { class: i === 2 || i === 3 ? "r" : "", text: t })))), tbody))
      : h("p", { class: "muted", text: "No entries yet. Choose Read with AI to pull them from the statement." }),
    x.notes ? h("div", { class: "notice info", text: "AI note: " + x.notes }) : null,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: () => saveExt(it, x, false) }, "Save"),
      h("button", { class: "btn primary", type: "button", disabled: !x.transactions.length, onclick: () => saveExt(it, x, true) }, "Save & mark Checked")));
}
function otherForm(it) {
  if (!it.ext) return h("p", { class: "muted", text: "Other documents aren't posted to Tally. Read with AI for a short summary, or change the document type if it's actually a bill or statement." });
  const x = normOther(it.ext);
  return h("div", { class: "stack" },
    h("div", {}, h("div", { class: "label", text: x.kind || "Document" }), h("p", { text: x.summary })),
    h("div", { class: "row small" }, x.date ? h("span", { text: "Date " + x.date }) : null, x.amount ? h("span", { class: "num", text: inr(x.amount) }) : null),
    x.notes ? h("div", { class: "notice info", text: x.notes }) : null,
    h("p", { class: "small muted", text: "Not included in Tally exports." }));
}

/* ---------- Tally XML ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
const amt = n => r2(n).toFixed(2);
const ymd = d => String(d || "").replace(/-/g, "");
function le(ledger, isDebit, amount, inner = "", party = false) {
  const a = isDebit ? -Math.abs(amount) : Math.abs(amount);
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>${party ? "<ISPARTYLEDGER>Yes</ISPARTYLEDGER>" : ""}<AMOUNT>${amt(a)}</AMOUNT>${inner}</ALLLEDGERENTRIES.LIST>`;
}
function vch(type, date, fields, entries, narration) {
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${esc(type)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${ymd(date)}</DATE><EFFECTIVEDATE>${ymd(date)}</EFFECTIVEDATE><VOUCHERTYPENAME>${esc(type)}</VOUCHERTYPENAME>${fields}<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE><NARRATION>${esc(narration)}</NARRATION>\n${entries.join("\n")}\n</VOUCHER></TALLYMESSAGE>`;
}
function billVoucher(it, st) {
  const x = normBill(it.ext), isSale = it.type === "sales";
  const party = x.partyName.trim() || st.suspense;
  const map = new Map();
  const add = (led, v) => { if (!v) return; map.set(led, r2((map.get(led) || 0) + v)); };
  for (const l of x.lines) {
    add(l.ledger.trim() || defaultLedger(it.type, l.rate), l.taxable);
    add(pat(isSale ? st.outCgst : st.inCgst, l.rate), l.cgst); add(pat(isSale ? st.outSgst : st.inSgst, l.rate), l.sgst); add(pat(isSale ? st.outIgst : st.inIgst, l.rate), l.igst);
  }
  const sum = r2([...map.values()].reduce((a, b) => a + b, 0));
  const total = x.total || r2(sum + x.roundOff);
  const diff = r2(total - sum);
  const bill = x.invoiceNo ? `<BILLALLOCATIONS.LIST><NAME>${esc(x.invoiceNo)}</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>${amt(isSale ? -total : total)}</AMOUNT></BILLALLOCATIONS.LIST>` : "";
  const entries = [le(party, isSale, total, bill, true)];
  for (const [led, v] of map) entries.push(le(led, !isSale, v));
  if (Math.abs(diff) >= 0.01) entries.push(le(st.roundOff, isSale ? diff < 0 : diff > 0, Math.abs(diff)));
  const fields = (isSale ? `<VOUCHERNUMBER>${esc(x.invoiceNo)}</VOUCHERNUMBER>` : "") +
    `<REFERENCE>${esc(x.invoiceNo)}</REFERENCE><REFERENCEDATE>${ymd(x.invoiceDate)}</REFERENCEDATE><PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>${x.partyGstin ? `<PARTYGSTIN>${esc(x.partyGstin)}</PARTYGSTIN>` : ""}`;
  const narr = `${isSale ? "Sales" : "Purchase"} bill ${x.invoiceNo} dt ${x.invoiceDate}${x.partyGstin ? " GSTIN " + x.partyGstin : ""}. DocBox: ${it.fileName}`;
  return vch(isSale ? st.vtSales : st.vtPurchase, x.invoiceDate, fields, entries, narr);
}
function bankVouchers(it, c, st) {
  const x = normBank(it.ext), bank = c.tallyBank || "Bank";
  return x.transactions.filter(t => t.debit || t.credit).map(t => {
    const led = t.ledger.trim() || st.suspense, out = t.debit > 0, v = out ? t.debit : t.credit;
    const entries = out ? [le(led, true, v), le(bank, false, v)] : [le(bank, true, v), le(led, false, v)];
    return vch(out ? st.vtPayment : st.vtReceipt, t.date, `<PARTYLEDGERNAME>${esc(led)}</PARTYLEDGERNAME>`, entries, (t.narration + (t.ref ? " Ref " + t.ref : "")).trim());
  });
}
function partyMasters(items) {
  const seen = new Map();
  for (const it of items) {
    if (it.type === "bank" || it.type === "other") continue;
    const x = normBill(it.ext), n = x.partyName.trim(); if (!n || seen.has(n)) continue;
    seen.set(n, { gstin: x.partyGstin, parent: it.type === "sales" ? "Sundry Debtors" : "Sundry Creditors" });
  }
  return [...seen].map(([n, p]) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(n)}" ACTION="Create"><NAME.LIST><NAME>${esc(n)}</NAME></NAME.LIST><PARENT>${p.parent}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>` +
    (p.gstin ? `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PARTYGSTIN>${esc(p.gstin)}</PARTYGSTIN>${STATES[p.gstin.slice(0, 2)] ? `<LEDSTATENAME>${esc(STATES[p.gstin.slice(0, 2)])}</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME>` : ""}` : "<GSTREGISTRATIONTYPE>Unregistered</GSTREGISTRATIONTYPE>") +
    `</LEDGER></TALLYMESSAGE>`);
}
const envelope = (report, msgs, company) => `<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>${report}</REPORTNAME>${company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ""}</REQUESTDESC><REQUESTDATA>\n${msgs.join("\n")}\n</REQUESTDATA></IMPORTDATA></BODY>\n</ENVELOPE>\n`;
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/xml" })); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function exportTally(c, items) {
  const st = S.settings, blockers = [];
  for (const it of items) {
    if (it.type === "bank") {
      if (!c.tallyBank) blockers.push(it.fileName + ": set the client's bank ledger first");
      if (normBank(it.ext).transactions.some(t => !/^\d{4}-\d{2}-\d{2}$/.test(t.date))) blockers.push(it.fileName + ": some entries have no date");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(normBill(it.ext).invoiceDate)) blockers.push(it.fileName + ": invoice date missing");
  }
  if (blockers.length) { showSheet("Fix these before exporting", [], h("div", { class: "stack", style: "padding:18px" }, blockers.map(b => h("div", { class: "notice bad", text: b })))); return; }
  const vouchers = items.flatMap(it => it.type === "bank" ? bankVouchers(it, c, st) : [billVoucher(it, st)]);
  const masters = st.createParties ? partyMasters(items) : [];
  const company = c.tallyCompany || "";
  const slug = (c.name || "client").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  const tag = S.filter.month || thisMonth();
  const files = [];
  if (masters.length) files.push([`1_${slug}_party_ledgers.xml`, envelope("All Masters", masters, company)]);
  files.push([`${masters.length ? 2 : 1}_${slug}_vouchers_${tag}.xml`, envelope("Vouchers", vouchers, company)]);
  files.forEach(([n, t], i) => setTimeout(() => download(n, t), i * 600));
  showSheet("Import into Tally", [], h("div", { class: "stack", style: "padding:18px;max-width:720px" },
    h("div", { class: "notice ok", text: `${files.length} file${files.length > 1 ? "s" : ""} downloaded: ${vouchers.length} vouchers from ${items.length} documents.` }),
    h("ol", { class: "stack", style: "padding-left:20px" },
      h("li", { text: `Open ${company ? "the company “" + company + "”" : "this client's company"} in Tally ERP 9.` }),
      masters.length ? h("li", { text: "Gateway of Tally → Import Data → Masters. Choose the file starting with 1_ (party ledgers)." }) : null,
      h("li", { text: "Gateway of Tally → Import Data → Vouchers. Choose the vouchers file." }),
      h("li", { text: "Check the import log. A voucher is skipped if a ledger named in it doesn't exist in Tally (purchase/sales, tax, round off, bank, suspense)." })),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: () => files.forEach(([n, t], i) => setTimeout(() => download(n, t), i * 600)) }, "Download again"),
      h("button", { class: "btn primary", type: "button", onclick: async () => {
        let bad = 0;
        for (const it of items) { try { await updDoc(it.id, { status: "exported", exported_at: nowISO() }); } catch { bad++; } }
        closeSheet(); toast(bad ? `${bad} couldn't be marked. Try again.` : `${items.length} documents marked In Tally`);
      } }, "Imported fine: mark In Tally"))));
}
