(() => {
  'use strict';

  /* ================= KONSTANTA & UTIL ================= */
  const STORAGE_KEY = 'worktrack-data-v1';
  const UI_KEY = 'worktrack-ui-v1';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const PRIORITY = { high: { label: 'High', rank: 0 }, med: { label: 'Medium', rank: 1 }, low: { label: 'Low', rank: 2 } };
  const STATUS = { todo: 'To Do', progress: 'In Progress', done: 'Done' };
  const MSTATUS = { scheduled: 'Scheduled', done: 'Done', cancelled: 'Cancelled' };
  const MTYPE = { offline: 'Offline', online: 'Online', hybrid: 'Hybrid' };
  const CAT_COLORS = ['#4f46e5', '#0b84c6', '#12a37a', '#e09b13', '#e5484d', '#9333ea', '#db2777', '#0d9488', '#64748b'];
  const MEETING_FOLLOWUP_CAT = 'Meeting Follow-up';
  const MEETING_FOLLOWUP_OLD = 'tindak lanjut meeting'; // nama lama (versi Indonesia), tetap dikenali
  const DEFAULT_CHIPS = 3; // dipakai saat layar kecil (kalender bisa di-scroll)
  // Harus sama dengan media query "mode pas satu layar" di style.css
  const FIT_SCREEN = window.matchMedia('(min-width: 1251px) and (min-height: 620px)');
  // Ukuran elemen di kotak tanggal (px), sesuai CSS mode pas layar
  const CELL = { chrome: 40, chip: 20, gap: 3, more: 16 };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => toKey(new Date());
  const nowTime = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
  const daysFromToday = k => Math.round((parseKey(k) - parseKey(todayKey())) / 86400000);
  const monthPrefix = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = k => { const d = parseKey(k); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtShort = k => { const d = parseKey(k); return `${d.getDate()} ${MONTHS_S[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtTime = m => m.start ? `${m.start}${m.end ? '–' + m.end : ''}` : '';
  const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
  const initials = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const isUrl = s => /^https?:\/\//i.test(s || '');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`; // 1 task, 2 tasks
  const groupByDate = arr => arr.reduce((acc, x) => ((acc[x.date] ||= []).push(x), acc), {});

  /* ================= VALIDASI DATA (file import / database / backup) ================= */
  // Semua data dari luar dirapikan dulu: hanya field yang dikenal, tipe & panjang dibatasi,
  // nilai pilihan (status, prioritas, dll.) harus dari daftar yang sah. Ini mencegah data
  // "jahat" (mis. berisi kode HTML/JS) ikut tampil di halaman.
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^\d{2}:\d{2}$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
  const oneOf = (v, obj, def) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(obj, v)) ? v : def;
  const optDate = v => DATE_RE.test(v) ? v : '';
  const optTime = v => TIME_RE.test(v) ? v : '';
  const optId = v => ID_RE.test(v) ? v : null;

  function cleanCategory(c) {
    if (!c || !ID_RE.test(c.id)) return null;
    return { id: c.id, name: str(c.name, 40).trim() || 'Untitled', color: COLOR_RE.test(c.color) ? c.color : '#64748b' };
  }
  function cleanTask(t) {
    if (!t || !ID_RE.test(t.id) || !DATE_RE.test(t.date)) return null;
    const out = {
      id: t.id, title: str(t.title, 150), date: t.date, time: optTime(t.time),
      priority: oneOf(t.priority, PRIORITY, 'med'), status: oneOf(t.status, STATUS, 'todo'),
      categoryId: optId(t.categoryId) || '', desc: str(t.desc, 20000)
    };
    if ('category' in t) out.category = str(t.category, 40); // format lama, diubah oleh migrate()
    return out;
  }
  function cleanActionItem(a) {
    if (!a || typeof a !== 'object') return null;
    return { id: optId(a.id) || uid(), text: str(a.text, 500), pic: str(a.pic, 100), due: optDate(a.due), done: a.done === true, taskId: optId(a.taskId) };
  }
  function cleanMeeting(m) {
    if (!m || !ID_RE.test(m.id) || !DATE_RE.test(m.date)) return null;
    return {
      id: m.id, title: str(m.title, 150), date: m.date, start: optTime(m.start), end: optTime(m.end),
      type: oneOf(m.type, MTYPE, 'offline'), location: str(m.location, 500),
      organizer: str(m.organizer, 100), notetaker: str(m.notetaker, 100),
      status: oneOf(m.status, MSTATUS, 'scheduled'),
      participants: (Array.isArray(m.participants) ? m.participants : []).map(p => str(p, 100).trim()).filter(Boolean).slice(0, 300),
      objective: str(m.objective, 20000), agenda: str(m.agenda, 20000), minutes: str(m.minutes, 100000),
      decisions: str(m.decisions, 20000), nextMeeting: optDate(m.nextMeeting),
      actionItems: (Array.isArray(m.actionItems) ? m.actionItems : []).map(cleanActionItem).filter(Boolean).slice(0, 300)
    };
  }
  const cleanList = (arr, fn) => {
    const seen = new Set();
    return (Array.isArray(arr) ? arr : []).map(fn).filter(x => x && !seen.has(x.id) && seen.add(x.id));
  };
  const cleanState = d => ({
    categories: cleanList(d?.categories, cleanCategory),
    tasks: cleanList(d?.tasks, cleanTask),
    meetings: cleanList(d?.meetings, cleanMeeting)
  });

  /* ================= MODE ONLINE (Supabase) & HAK AKSES ================= */
  // Jika config.js berisi URL & key Supabase, data disimpan online dan bisa dilihat siapa saja
  // yang punya link. Mengubah data butuh login dengan peran editor/admin/super admin.
  // Tombol disembunyikan sesuai peran, tapi pengamanan SEBENARNYA ada di database (RLS).
  const CFG = window.WORKTRACK_CONFIG || {};
  const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase?.createClient);
  const RANK = { anon: 0, viewer: 0, editor: 1, admin: 2, super_admin: 3 };
  const ROLE_LABEL = { anon: 'Guest', viewer: 'Viewer', editor: 'Editor', admin: 'Admin', super_admin: 'Super admin' };
  const auth = { user: null, role: CLOUD ? 'anon' : 'super_admin' }; // mode lokal: pemilik browser boleh semua
  const can = what => RANK[auth.role] >= { edit: 1, admin: 2, super: 3 }[what];
  const ro = () => can('edit') ? '' : ' disabled'; // atribut untuk checkbox/select saat hanya bisa melihat

  /* ================= STATE ================= */
  let freshStart = false; // true jika localStorage kosong (mis. data browser baru dihapus)
  let state = CLOUD ? { categories: [], tasks: [], meetings: [] } : load();
  if (CLOUD) freshStart = true; // sampai data online selesai dimuat (backup tidak boleh menulis data kosong)
  const ui = loadUi();
  const viewDate = new Date(); viewDate.setDate(1);
  let openDayKey = null;

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (d && Array.isArray(d.tasks) && Array.isArray(d.meetings)) return migrate(d);
    } catch (e) { /* data rusak → pakai contoh */ }
    freshStart = true;
    return migrate(seed());
  }

  // Data lama menyimpan kategori sebagai teks bebas (task.category).
  // Sekarang kategori adalah master data (state.categories) dan task menyimpan categoryId.
  function migrate(raw) {
    const d = cleanState(raw);
    const findOrCreate = name => {
      let c = d.categories.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!c) {
        c = { id: uid(), name, color: CAT_COLORS[d.categories.length % CAT_COLORS.length] };
        d.categories.push(c);
      }
      return c;
    };
    for (const t of d.tasks) {
      if ('category' in t) {
        let name = String(t.category || '').trim();
        if (/^Meeting:/i.test(name)) name = MEETING_FOLLOWUP_CAT;
        t.categoryId = name ? findOrCreate(name).id : '';
        delete t.category;
      }
      if (t.categoryId && !d.categories.some(c => c.id === t.categoryId)) t.categoryId = '';
      t.categoryId ||= '';
    }
    return d;
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleBackup();
  }

  function loadUi() {
    const def = { type: 'all', scope: 'active', showDone: false };
    try { return { ...def, ...JSON.parse(localStorage.getItem(UI_KEY)) }; } catch (e) { return def; }
  }
  function saveUi() { localStorage.setItem(UI_KEY, JSON.stringify(ui)); }

  function seed() {
    const now = new Date();
    const k = off => { const d = new Date(now); d.setDate(now.getDate() + off); return toKey(d); };
    return {
      categories: ['Reports', 'Projects', 'Clients', 'Admin'].map((name, i) => ({ id: uid(), name, color: CAT_COLORS[i] })),
      tasks: [
        { id: uid(), title: 'Example: Prepare weekly report', date: k(0), time: '10:00', priority: 'high', status: 'progress', category: 'Reports', desc: 'Collect data from the team, then write a summary.' },
        { id: uid(), title: 'Example: Review project documents', date: k(2), time: '', priority: 'med', status: 'todo', category: 'Projects', desc: '' },
        { id: uid(), title: 'Example: Follow up client email', date: k(-1), time: '', priority: 'low', status: 'todo', category: 'Clients', desc: '' }
      ],
      meetings: [{
        id: uid(), title: 'Example: Team Weekly Sync', date: k(1), start: '09:00', end: '10:00', type: 'online',
        location: 'https://meet.google.com/', organizer: 'Team Manager', notetaker: 'Citra',
        participants: ['Andi', 'Budi', 'Citra'],
        objective: "Align on this week's progress and identify blockers.",
        agenda: 'Progress updates from each member\nBlockers & solutions\nPlan for next week',
        minutes: '', decisions: '',
        actionItems: [{ id: uid(), text: 'Send progress summary to the team', pic: 'Andi', due: k(3), done: false, taskId: null }],
        status: 'scheduled', nextMeeting: ''
      }]
    };
  }

  const getTask = id => state.tasks.find(t => t.id === id);
  const getMeeting = id => state.meetings.find(m => m.id === id);
  const getCat = id => id ? state.categories.find(c => c.id === id) : null;
  const sortedCats = () => [...state.categories].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const catTag = (t, cls = '') => {
    const c = getCat(t.categoryId);
    return c ? `<span class="cat-tag ${cls}" style="--c:${esc(c.color)}"><i></i>${esc(c.name)}</span>` : '';
  };
  const isOverdue = t => t.status !== 'done' && t.date < todayKey();
  const showsTasks = () => ui.type !== 'meeting';
  const showsMeetings = () => ui.type !== 'task';
  const byStart = (a, b) => (a.start || '99').localeCompare(b.start || '99');
  const byDateStart = (a, b) => a.date.localeCompare(b.date) || byStart(a, b);
  const sortTasks = arr => [...arr].sort((a, b) =>
    (a.status === 'done') - (b.status === 'done') ||
    (a.time || '99').localeCompare(b.time || '99') ||
    PRIORITY[a.priority].rank - PRIORITY[b.priority].rank);
  const lateActionItems = m => (m.actionItems || []).filter(a => !a.done && a.due && a.due < todayKey());

  /* ================= SINKRONISASI ACTION ITEM ↔ PEKERJAAN ================= */
  function findActionByTask(taskId) {
    for (const m of state.meetings) {
      const ai = (m.actionItems || []).find(a => a.taskId === taskId);
      if (ai) return ai;
    }
    return null;
  }
  function syncActionFromTask(t) {
    const ai = findActionByTask(t.id);
    if (ai) ai.done = t.status === 'done';
  }
  function setTaskDone(t, done) {
    t.status = done ? 'done' : (t.status === 'done' ? 'todo' : t.status);
    syncActionFromTask(t);
  }
  // Checkbox selesai (kalender, panel kiri, detail hari)
  function toggleTaskDone(id, done) {
    const t = getTask(id);
    if (!t) return;
    commit(() => setTaskDone(t, done), {
      success: done ? `"${t.title}" marked as done.` : `"${t.title}" marked as not done.`,
      error: 'Failed to update task status.'
    });
  }

  /* ================= NOTIFIKASI ================= */
  const NOTIF = {
    success: { icon: '✓', title: 'Success' },
    error: { icon: '✕', title: 'Error' },
    warning: { icon: '!', title: 'Warning' },
    info: { icon: 'i', title: 'Info' }
  };
  const notifBox = $('#notifications');

  // Notifikasi dibuat sebagai popover (top layer) supaya tetap tampil di atas popup/dialog yang terbuka
  function bringNotifsToTop() {
    if (!notifBox.showPopover || !notifBox.children.length) return;
    try {
      if (notifBox.matches(':popover-open')) notifBox.hidePopover();
      notifBox.showPopover();
    } catch (e) { /* browser lama: tetap tampil sebagai elemen fixed biasa */ }
  }
  const nativeShowModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () { nativeShowModal.call(this); bringNotifsToTop(); };

  function notify(type, message, title = NOTIF[type].title) {
    const timeout = type === 'error' ? 6000 : 3500;
    const el = document.createElement('div');
    el.className = `notif ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `
      <span class="notif-icon">${NOTIF[type].icon}</span>
      <div class="notif-body"><b>${esc(title)}</b>${esc(message)}</div>
      <button class="notif-close" title="Close">✕</button>
      <span class="notif-bar" style="animation-duration:${timeout}ms"></span>`;
    notifBox.appendChild(el);
    while (notifBox.children.length > 4) notifBox.firstElementChild.remove();
    bringNotifsToTop();

    let timer;
    const close = () => {
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => {
        el.remove();
        if (!notifBox.children.length && notifBox.hidePopover && notifBox.matches(':popover-open')) notifBox.hidePopover();
      }, 250);
    };
    timer = setTimeout(close, timeout);
    el.querySelector('.notif-close').addEventListener('click', close);
    el.addEventListener('mouseenter', () => { clearTimeout(timer); el.classList.add('paused'); });
    el.addEventListener('mouseleave', () => { el.classList.remove('paused'); timer = setTimeout(close, 2000); });
  }

  const errorDetail = err => err?.name === 'QuotaExceededError'
    ? 'Browser storage is full. Export your data, then delete old data.'
    : (err?.message ? `Details: ${err.message}` : 'Please try again.');

  // Jalankan perubahan data + simpan. Jika gagal, data dikembalikan ke kondisi sebelumnya.
  // Mode online: perubahan dikirim ke database; jika ditolak, data dimuat ulang dari server.
  async function commit(mutate, { success, error = 'Failed to save changes.' } = {}) {
    if (!can('edit')) {
      refreshAfterChange(); // kembalikan checkbox dll. yang sempat berubah di layar
      notify('warning', auth.user
        ? 'Your account can only view. Ask the super admin for editor access.'
        : 'Sign in with an editor account to make changes.', 'View only');
      return false;
    }
    const backup = JSON.stringify(state);
    let ops = null;
    try {
      mutate();
      if (CLOUD) {
        ops = diffState(JSON.parse(backup), state);
        if (ops.deletes && !can('admin')) throw new Error('Only admins can delete items.');
      } else {
        save();
      }
      refreshAfterChange();
    } catch (err) {
      console.error(err);
      state = JSON.parse(backup);
      refreshAfterChange();
      notify('error', `${error} ${errorDetail(err)}`);
      return false;
    }
    if (CLOUD && ops.count) {
      try {
        await cloudSync(ops);
        scheduleBackup();
      } catch (err) {
        console.error(err);
        notify('error', `${error} ${cloudErrorText(err)}`);
        await reloadCloud({ quiet: true }); // tampilkan kembali data yang benar dari server
        return false;
      }
    }
    if (success) notify('success', success);
    return true;
  }

  function refreshAfterChange() {
    fillCategoryFilter();
    if (taskDialog.open) fillTaskCategorySelect($('#t-category').value);
    if (settingsDialog.open) renderDataInfo();
    if (catDialog.open) renderCatList();
    if (aiDialog.open) renderActionItems();
    renderAll();
  }

  /* ================= KONFIRMASI ================= */
  function confirmBox({ title, message, okText = 'Yes, continue', danger = true }) {
    return new Promise(resolve => {
      const dlg = $('#confirmDialog');
      $('#confirmTitle').textContent = title;
      $('#confirmMsg').textContent = message;
      $('#confirmIcon').textContent = danger ? '!' : '?';
      $('#confirmOk').textContent = okText;
      $('#confirmOk').className = `btn ${danger ? 'danger' : 'primary'}`;
      dlg.classList.toggle('is-danger', danger);
      const done = v => { dlg.close(); resolve(v); };
      $('#confirmOk').onclick = () => done(true);
      $('#confirmCancel').onclick = () => done(false);
      dlg.oncancel = e => { e.preventDefault(); done(false); };
      dlg.showModal();
      $('#confirmCancel').focus();
    });
  }

  /* ================= LOADING ================= */
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const loadingDialog = $('#loadingDialog');
  loadingDialog.addEventListener('cancel', e => e.preventDefault()); // tidak bisa ditutup dengan Esc

  // Layar loading untuk proses berat (import/export/hapus semua)
  async function runWithLoading(text, fn) {
    $('#loadingText').textContent = text;
    loadingDialog.showModal();
    const start = performance.now();
    await nextFrame();
    try {
      return await fn();
    } finally {
      const left = 450 - (performance.now() - start); // tampil minimal sebentar agar tidak berkedip
      if (left > 0) await sleep(left);
      loadingDialog.close();
    }
  }

  // Spinner pada tombol selama proses simpan
  async function withButtonLoading(btn, fn) {
    btn.disabled = true;
    btn.classList.add('is-loading');
    await nextFrame();
    try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-loading'); }
  }

  /* ================= VALIDASI FORM ================= */
  function validateRequired(scope) {
    const missing = $$('[required]', scope).filter(el => {
      const empty = !el.value.trim();
      el.classList.toggle('invalid', empty);
      return empty;
    });
    if (missing.length) {
      notify('error', `Required fields are empty: ${missing.map(el => el.dataset.label || el.id).join(', ')}.`, 'Incomplete data');
      missing[0].focus();
      return false;
    }
    return true;
  }
  // Hilangkan tanda merah saat kolom mulai diisi
  document.addEventListener('input', e => {
    if (e.target.classList?.contains('invalid') && e.target.value.trim()) e.target.classList.remove('invalid');
  });
  const clearInvalid = scope => $$('.invalid', scope).forEach(el => el.classList.remove('invalid'));

  /* ================= RENDER UTAMA ================= */
  function renderAll() {
    renderCalendar();
    renderPanel();
    renderStats();
    renderBubbles();
    if (dayDialog.open) renderDay();
    refreshDetailDialog();
  }

  /* ================= FILTER JENIS AGENDA ================= */
  function setType(type) {
    ui.type = type;
    saveUi();
    document.body.dataset.type = type;
    $$('#typeFilter button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    renderAll();
  }
  $('#typeFilter').addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (b) setType(b.dataset.type);
  });

  /* ================= HEADER: BUBBLE RINGKASAN HARI INI ================= */
  function nextMeeting() {
    const tk = todayKey(), nt = nowTime();
    return state.meetings
      .filter(m => m.status === 'scheduled' && (m.date > tk || (m.date === tk && (!m.start || m.start >= nt))))
      .sort(byDateStart)[0];
  }

  function relDay(k) {
    const diff = daysFromToday(k);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff <= 7) return `In ${diff} days`;
    return fmtShort(k);
  }

  function renderBubbles() {
    const tk = todayKey();
    const today = state.tasks.filter(t => t.date === tk);
    const doneToday = today.filter(t => t.status === 'done').length;
    const overdue = state.tasks.filter(isOverdue).length;
    const meetsToday = state.meetings.filter(m => m.date === tk && m.status !== 'cancelled').length;
    const nm = nextMeeting();
    const overdueOn = $('#statusFilter').value === 'overdue';

    $('#todayBubbles').innerHTML = `
      <span class="bubble date">📅 ${fmtDate(tk)}</span>
      <button class="bubble ${today.length && doneToday === today.length ? 'ok' : ''}" data-bubble="today" title="View today's agenda">
        📋 Today's tasks <b>${doneToday}/${today.length}</b>
      </button>
      <button class="bubble" data-bubble="today" title="View today's agenda">👥 Today's meetings <b>${meetsToday}</b></button>
      <button class="bubble ${overdue ? 'warn' : 'ok'} ${overdueOn ? 'active' : ''}" data-bubble="overdue"
        title="${overdueOn ? 'Click to clear the overdue filter' : 'Click to show overdue tasks only'}">
        ⚠️ Overdue <b>${overdue}</b>
      </button>
      ${nm ? `<button class="bubble next" data-bubble="next" data-id="${nm.id}" title="${esc(nm.title)} — ${fmtDate(nm.date)}">
        ⏭️ <span class="txt">${relDay(nm.date)}${nm.start ? ' ' + esc(nm.start) : ''} · ${esc(nm.title)}</span>
      </button>` : ''}`;
  }

  $('#todayBubbles').addEventListener('click', e => {
    const b = e.target.closest('[data-bubble]');
    if (!b) return;
    switch (b.dataset.bubble) {
      case 'today': openDay(todayKey()); break;
      case 'next': openMeetingDetail(b.dataset.id); break;
      case 'overdue': {
        const on = $('#statusFilter').value === 'overdue';
        $('#statusFilter').value = on ? '' : 'overdue';
        if (!on && ui.type === 'meeting') { setType('all'); }
        else renderAll();
        if (!on) notify('info', 'The calendar now shows overdue tasks only. Click the "Overdue" bubble again to turn the filter off.', 'Overdue filter on');
        break;
      }
    }
  });

  // Header: efek ringkas saat di-scroll + simpan tingginya untuk panel sticky
  const appbar = $('#appbar');
  // Hanya mengubah bayangan header (lihat .appbar.scrolled di CSS). Dibatasi 1x per frame.
  let scrollTick = false;
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      appbar.classList.toggle('scrolled', window.scrollY > 0);
      scrollTick = false;
    });
  }, { passive: true });
  let lastHeaderH = 0;
  new ResizeObserver(() => {
    const h = appbar.offsetHeight;
    if (h !== lastHeaderH) { lastHeaderH = h; document.documentElement.style.setProperty('--header-h', h + 'px'); }
  }).observe(appbar);

  /* ================= KALENDER ================= */
  function filteredTasks() {
    if (!showsTasks()) return [];
    const q = $('#search').value.trim().toLowerCase();
    const st = $('#statusFilter').value;
    const pr = $('#priorityFilter').value;
    return state.tasks.filter(t => {
      if (q && !`${t.title} ${t.desc} ${getCat(t.categoryId)?.name || ''}`.toLowerCase().includes(q)) return false;
      if (st === 'overdue') { if (!isOverdue(t)) return false; }
      else if (st && t.status !== st) return false;
      if (pr && t.priority !== pr) return false;
      if (!matchCategory(t)) return false;
      return true;
    });
  }

  // Filter kategori (dipakai di kalender & daftar agenda panel kiri)
  function matchCategory(t) {
    const cf = $('#categoryFilter').value;
    return !cf || t.categoryId === cf;
  }

  function fillCategoryFilter() {
    const sel = $('#categoryFilter');
    const cur = sel.value;
    sel.innerHTML = `<option value="">All categories</option>` +
      sortedCats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  }

  function filteredMeetings() {
    if (!showsMeetings()) return [];
    const q = $('#search').value.trim().toLowerCase();
    const st = $('#meetingStatusFilter').value;
    return state.meetings.filter(m => {
      if (q) {
        const hay = [m.title, m.objective, m.agenda, m.minutes, m.decisions, m.location, m.organizer, m.notetaker,
          (m.participants || []).join(' '), (m.actionItems || []).map(a => `${a.text} ${a.pic}`).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (st && m.status !== st) return false;
      return true;
    });
  }

  function taskChip(t) {
    return `<div class="chip task p-${t.priority} s-${t.status} ${isOverdue(t) ? 'overdue' : ''}" draggable="${can('edit')}" data-task="${t.id}"
        title="${esc(t.title)}${isOverdue(t) ? ' (OVERDUE)' : ''} — ${STATUS[t.status]}, ${PRIORITY[t.priority].label.toLowerCase()} priority">
      <input type="checkbox" data-action="toggle-task" ${t.status === 'done' ? 'checked' : ''}${ro()} title="Mark as done">
      <span class="chip-text" data-action="edit-task">${t.time ? `<b>${esc(t.time)}</b> ` : ''}${esc(t.title)}</span>
      ${getCat(t.categoryId) ? `<i class="chip-cat" style="background:${esc(getCat(t.categoryId).color)}" title="${esc(getCat(t.categoryId).name)}"></i>` : ''}
    </div>`;
  }
  function meetingChip(m) {
    const past = m.date < todayKey() ? 'past' : '';
    return `<div class="chip meeting m-${m.status} ${past}" draggable="${can('edit')}" data-meeting="${m.id}" data-action="open-meeting"
        title="Meeting: ${esc(m.title)} — ${MSTATUS[m.status]}${m.location ? ' · ' + esc(m.location) : ''}">
      <span class="chip-text">👥 ${m.start ? `<b>${esc(m.start)}</b> ` : ''}${esc(m.title)}</span>
    </div>`;
  }

  function renderCalendar() {
    const y = viewDate.getFullYear(), mo = viewDate.getMonth();
    $('#monthLabelText').textContent = `${MONTHS[mo]} ${y}`;
    const tasksBy = groupByDate(filteredTasks());
    const meetsBy = groupByDate(filteredMeetings());

    const offset = (new Date(y, mo, 1).getDay() + 6) % 7; // minggu dimulai Senin
    const total = Math.ceil((offset + new Date(y, mo + 1, 0).getDate()) / 7) * 7;
    const tk = todayKey();

    // Hitung berapa chip yang muat di satu kotak tanggal
    const gridEl = $('#calendarGrid');
    gridEl.style.setProperty('--weeks', total / 7);
    const fit = chipCapacity(gridEl, total / 7);
    lastCapacity = fit.all;
    const addTitle = ui.type === 'task' ? 'Add task' : ui.type === 'meeting' ? 'Schedule meeting' : 'Add agenda';
    let html = '';
    for (let i = 0; i < total; i++) {
      const d = new Date(y, mo, 1 - offset + i);
      const k = toKey(d);
      const items = [
        ...(meetsBy[k] || []).sort(byStart).map(meetingChip),
        ...sortTasks(tasksBy[k] || []).map(taskChip)
      ];
      const shown = items.length <= fit.all ? items.length : fit.withMore;
      const more = items.length - shown;
      const cls = ['day', d.getMonth() !== mo && 'other', k === tk && 'today', (d.getDay() === 0 || d.getDay() === 6) && 'weekend'].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${k}">
        <div class="day-head">
          <button class="day-num" data-action="open-day" title="View details for ${fmtDate(k)}">${d.getDate()}</button>
          <button class="add-btn need-edit" data-action="add" title="${addTitle}">+</button>
        </div>
        ${shown ? `<div class="day-items">${items.slice(0, shown).join('')}</div>` : ''}
        ${more > 0 ? `<button class="more" data-action="open-day">+${more} ${shown ? 'more' : 'items'}</button>` : ''}
      </div>`;
    }
    gridEl.innerHTML = html;
  }

  let lastCapacity = null;
  function chipCapacity(gridEl, weeks) {
    if (!FIT_SCREEN.matches) return { all: DEFAULT_CHIPS, withMore: DEFAULT_CHIPS };
    const cellH = gridEl.clientHeight / weeks;
    const per = CELL.chip + CELL.gap;
    const all = Math.max(0, Math.floor((cellH - CELL.chrome + CELL.gap) / per));
    const withMore = Math.max(0, Math.floor((cellH - CELL.chrome - CELL.more - CELL.gap + CELL.gap) / per));
    return { all, withMore };
  }

  // Render ulang kalender bila ukuran layar berubah & kapasitas kotak ikut berubah
  new ResizeObserver(() => {
    const gridEl = $('#calendarGrid');
    const weeks = +gridEl.style.getPropertyValue('--weeks') || 5;
    if (chipCapacity(gridEl, weeks).all !== lastCapacity) renderCalendar();
  }).observe($('#calendarGrid'));
  FIT_SCREEN.addEventListener('change', renderCalendar);

  function renderStats() {
    const prefix = monthPrefix(viewDate);
    const mName = MONTHS[viewDate.getMonth()];
    const tk = todayKey();
    const tasks = state.tasks.filter(t => t.date.startsWith(prefix));
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const late = tasks.filter(isOverdue).length;
    const meets = state.meetings.filter(m => m.date.startsWith(prefix) && m.status !== 'cancelled');
    const allAi = state.meetings.flatMap(m => m.actionItems || []);
    const openAi = allAi.filter(a => !a.done).length;
    const lateAi = allAi.filter(a => !a.done && a.due && a.due < tk).length;

    const S = {
      tasks: `<div class="stat"><div class="label">${mName} tasks</div><div class="value">${tasks.length}</div>
        <div class="progress"><span style="width:${pct}%"></span></div></div>`,
      done: `<div class="stat green"><div class="label">Done (${pct}%)</div><div class="value">${done}</div></div>`,
      prog: `<div class="stat"><div class="label">In progress</div><div class="value">${tasks.filter(t => t.status === 'progress').length}</div></div>`,
      late: `<div class="stat red"><div class="label">Overdue</div><div class="value">${late}</div></div>`,
      meets: `<div class="stat blue"><div class="label">${mName} meetings</div><div class="value">${meets.length}</div></div>`,
      mdone: `<div class="stat green"><div class="label">Completed meetings</div><div class="value">${meets.filter(m => m.status === 'done').length}</div></div>`,
      openAi: `<button type="button" class="stat clickable" data-ai-scope="open" title="View open action items per meeting">
        <div class="label">Open action items <span class="stat-go">View ›</span></div><div class="value">${openAi}</div></button>`,
      lateAi: `<button type="button" class="stat red clickable" data-ai-scope="late" title="View overdue action items per meeting">
        <div class="label">Overdue action items <span class="stat-go">View ›</span></div><div class="value">${lateAi}</div></button>`
    };
    const order = {
      all: ['tasks', 'done', 'late', 'meets', 'openAi'],
      task: ['tasks', 'done', 'prog', 'late'],
      meeting: ['meets', 'mdone', 'openAi', 'lateAi']
    }[ui.type];
    $('#stats').innerHTML = order.map(k => S[k]).join('');
  }

  /* ---------- Navigasi bulan / tahun ---------- */
  function goMonth(y, m) { viewDate.setFullYear(y, m, 1); renderAll(); }
  $('#prevMonth').addEventListener('click', () => goMonth(viewDate.getFullYear(), viewDate.getMonth() - 1));
  $('#nextMonth').addEventListener('click', () => goMonth(viewDate.getFullYear(), viewDate.getMonth() + 1));
  $('#todayBtn').addEventListener('click', () => { const n = new Date(); goMonth(n.getFullYear(), n.getMonth()); });

  /* ---------- Popup pilih bulan & tahun (klik judul "November 2026") ---------- */
  const monthPicker = $('#monthPicker');
  const monthLabelBtn = $('#monthLabel');
  let pickerYear = viewDate.getFullYear();

  function renderMonthPicker() {
    const y = pickerYear;
    const now = new Date();
    $('#pickerYear').textContent = y;
    // Jumlah per bulan menyesuaikan filter jenis agenda
    $('#monthList').innerHTML = MONTHS_S.map((name, i) => {
      const prefix = `${y}-${pad(i + 1)}`;
      const tasks = showsTasks() ? state.tasks.filter(t => t.date.startsWith(prefix)) : [];
      const meets = showsMeetings() ? state.meetings.filter(m => m.date.startsWith(prefix) && m.status !== 'cancelled') : [];
      const openT = tasks.filter(t => t.status !== 'done').length;
      const lateT = tasks.some(isOverdue);
      const lateAi = meets.some(m => lateActionItems(m).length);
      const n = ui.type === 'meeting' ? meets.length : openT + meets.length;
      const unit = ui.type === 'task' ? (n === 1 ? 'task' : 'tasks') : ui.type === 'meeting' ? (n === 1 ? 'meeting' : 'meetings') : (n === 1 ? 'item' : 'items');
      const title = [showsTasks() && `${openT} unfinished task${openT === 1 ? '' : 's'}`, showsMeetings() && `${meets.length} meeting${meets.length === 1 ? '' : 's'}`,
        lateT && 'has overdue tasks', lateAi && 'has overdue action items'].filter(Boolean).join(', ');
      const active = y === viewDate.getFullYear() && i === viewDate.getMonth();
      const current = y === now.getFullYear() && i === now.getMonth();
      const cls = ['month-btn', active && 'active', current && 'current'].filter(Boolean).join(' ');
      return `<button class="${cls}" data-month="${i}" title="${MONTHS[i]} ${y}: ${title}">
        ${lateT || lateAi ? '<span class="dot"></span>' : ''}${name}<span class="cnt">${tasks.length + meets.length ? `${n} ${unit}` : '–'}</span>
      </button>`;
    }).join('');
  }

  function toggleMonthPicker(open = monthPicker.hidden) {
    monthPicker.hidden = !open;
    monthLabelBtn.setAttribute('aria-expanded', open);
    if (open) { pickerYear = viewDate.getFullYear(); renderMonthPicker(); }
  }
  monthLabelBtn.addEventListener('click', () => toggleMonthPicker());
  $('#prevYear').addEventListener('click', () => { pickerYear--; renderMonthPicker(); });
  $('#nextYear').addEventListener('click', () => { pickerYear++; renderMonthPicker(); });
  $('#monthList').addEventListener('click', e => {
    const b = e.target.closest('[data-month]');
    if (!b) return;
    toggleMonthPicker(false);
    goMonth(pickerYear, +b.dataset.month);
  });
  document.addEventListener('mousedown', e => {
    if (!monthPicker.hidden && !e.target.closest('.month-picker-wrap')) toggleMonthPicker(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !monthPicker.hidden) toggleMonthPicker(false); });

  ['search', 'statusFilter', 'priorityFilter', 'categoryFilter', 'meetingStatusFilter'].forEach(id => $('#' + id).addEventListener('input', renderAll));
  /* ---------- Tombol "+ Tambah" (dropdown Task / Meeting) ---------- */
  const newBtn = $('#newBtn');
  const newMenu = $('#newMenu');
  const newMenuItems = () => $$('[data-new]', newMenu).filter(b => b.offsetParent !== null); // yang terlihat saja
  function toggleNewMenu(open = newMenu.hidden) {
    newMenu.hidden = !open;
    newBtn.setAttribute('aria-expanded', open);
    if (open) newMenuItems()[0]?.focus();
  }
  newBtn.addEventListener('click', () => toggleNewMenu());
  newMenu.addEventListener('click', e => {
    const type = e.target.closest('[data-new]')?.dataset.new;
    if (!type) return;
    toggleNewMenu(false);
    if (type === 'task') openTaskForm(null, todayKey());
    else openMeetingForm(null, todayKey());
  });
  newMenu.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = newMenuItems();
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  document.addEventListener('click', e => {
    if (!newMenu.hidden && !e.target.closest('.new-menu-wrap')) toggleNewMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !newMenu.hidden) { toggleNewMenu(false); newBtn.focus(); }
  });

  /* ---------- Interaksi grid ---------- */
  const grid = $('#calendarGrid');
  grid.addEventListener('click', e => {
    const actEl = e.target.closest('[data-action]');
    if (!actEl) return;
    const day = e.target.closest('.day');
    const taskEl = e.target.closest('[data-task]');
    switch (actEl.dataset.action) {
      case 'toggle-task': toggleTaskDone(taskEl.dataset.task, e.target.checked); break;
      case 'edit-task': openTaskForm(getTask(taskEl.dataset.task)); break;
      case 'open-meeting': openMeetingDetail(actEl.dataset.meeting); break;
      case 'open-day': openDay(day.dataset.date); break;
      case 'add': {
        const r = actEl.getBoundingClientRect();
        addAgenda(day.dataset.date, r.left, r.bottom + 4);
        break;
      }
    }
  });
  grid.addEventListener('dblclick', e => {
    if (e.target.classList.contains('day') || e.target.classList.contains('day-items')) {
      addAgenda(e.target.closest('.day').dataset.date, e.clientX, e.clientY);
    }
  });

  // Drag & drop: pindahkan task / jadwal ulang meeting
  grid.addEventListener('dragstart', e => {
    const chip = e.target.closest('[draggable=true]');
    if (!chip) return;
    e.dataTransfer.setData('text/plain', chip.dataset.task ? `task:${chip.dataset.task}` : `meeting:${chip.dataset.meeting}`);
    e.dataTransfer.effectAllowed = 'move';
  });
  grid.addEventListener('dragover', e => {
    const day = e.target.closest('.day');
    if (!day) return;
    e.preventDefault();
    $$('.day.drag-over', grid).forEach(d => d !== day && d.classList.remove('drag-over'));
    day.classList.add('drag-over');
  });
  grid.addEventListener('dragleave', e => {
    const day = e.target.closest('.day');
    if (day && !day.contains(e.relatedTarget)) day.classList.remove('drag-over');
  });
  grid.addEventListener('drop', e => {
    const day = e.target.closest('.day');
    if (!day) return;
    e.preventDefault();
    day.classList.remove('drag-over');
    const [kind, id] = e.dataTransfer.getData('text/plain').split(':');
    const item = kind === 'task' ? getTask(id) : getMeeting(id);
    const k = day.dataset.date;
    if (!item || item.date === k) return;
    commit(() => { item.date = k; }, {
      success: kind === 'task' ? `"${item.title}" moved to ${fmtDate(k)}.` : `Meeting "${item.title}" rescheduled to ${fmtDate(k)}.`,
      error: kind === 'task' ? 'Failed to move task.' : 'Failed to reschedule meeting.'
    });
  });

  /* ---------- Menu tambah (task / meeting) ---------- */
  const addMenu = $('#addMenu');
  let addMenuDate = null;

  function addAgenda(dateKey, x, y) {
    if (!can('edit')) return;
    if (ui.type === 'task') return openTaskForm(null, dateKey);
    if (ui.type === 'meeting') return openMeetingForm(null, dateKey);
    addMenuDate = dateKey;
    $('#addMenuTitle').textContent = fmtShort(dateKey);
    addMenu.hidden = false;
    const w = addMenu.offsetWidth, h = addMenu.offsetHeight;
    addMenu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    addMenu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
  }
  const closeAddMenu = () => { addMenu.hidden = true; };
  addMenu.addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    closeAddMenu();
    if (b.dataset.add === 'task') openTaskForm(null, addMenuDate);
    else openMeetingForm(null, addMenuDate);
  });
  document.addEventListener('mousedown', e => {
    if (!addMenu.hidden && !addMenu.contains(e.target) && !e.target.closest('[data-action="add"]')) closeAddMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAddMenu(); });
  window.addEventListener('scroll', closeAddMenu, { passive: true });
  window.addEventListener('resize', closeAddMenu);

  /* ================= PANEL KIRI ================= */
  function taskRelLabel(t) {
    const diff = daysFromToday(t.date);
    if (t.status === 'done') return { text: fmtShort(t.date), cls: '' };
    if (diff < 0) return { text: `${-diff} day${diff === -1 ? '' : 's'} overdue`, cls: 'late' };
    if (diff === 0) return { text: 'Today', cls: 'today' };
    if (diff === 1) return { text: 'Tomorrow', cls: 'soon' };
    if (diff <= 7) return { text: `In ${diff} days`, cls: diff <= 3 ? 'soon' : '' };
    return { text: fmtShort(t.date), cls: '' };
  }
  function meetingRelLabel(m) {
    const diff = daysFromToday(m.date);
    if (diff === 0) return { text: 'Today', cls: 'today' };
    if (diff === 1) return { text: 'Tomorrow', cls: 'soon' };
    if (diff > 1 && diff <= 7) return { text: `In ${diff} days`, cls: diff <= 3 ? 'soon' : '' };
    if (diff < 0 && diff >= -7) return { text: `${-diff} day${diff === -1 ? '' : 's'} ago`, cls: '' };
    return { text: DAYS[parseKey(m.date).getDay()], cls: '' };
  }

  function renderPanel() {
    const y = viewDate.getFullYear(), mo = viewDate.getMonth();
    const tk = todayKey();

    // Daftar agenda
    $('#listTitle').textContent = { all: 'Agenda List', task: 'Task List', meeting: 'Meeting List' }[ui.type];
    const prefix = monthPrefix(viewDate);
    const inScope = x => ui.scope === 'active' || x.date.startsWith(prefix);
    let html = '', count = 0;

    if (showsMeetings()) {
      const meets = state.meetings
        .filter(m => inScope(m) && (ui.scope === 'month' || (m.date >= tk && m.status !== 'cancelled')))
        .sort(byDateStart);
      count += meets.length;
      if (meets.length) {
        html += `<div class="side-group meeting">${ui.scope === 'active' ? 'Upcoming meetings' : 'Meetings'}</div>`;
        html += meets.map(m => {
          const d = parseKey(m.date);
          const rel = meetingRelLabel(m);
          const ais = m.actionItems || [];
          return `<div class="side-item meeting m-${m.status}" data-meeting="${m.id}" title="${esc(fmtDate(m.date))}">
            <div class="mini-date"><b>${d.getDate()}</b><span>${MONTHS_S[d.getMonth()]}</span></div>
            <div class="st-info">
              <div class="st-title">${esc(m.title)}</div>
              <div class="st-meta">
                <span class="rel ${rel.cls}">${rel.text}</span>
                ${m.start ? `<span>🕘 ${esc(fmtTime(m))}</span>` : ''}
                ${m.status !== 'scheduled' ? `<span class="badge ${m.status}">${MSTATUS[m.status]}</span>` : ''}
                ${ais.length ? `<span>✔ ${ais.filter(a => a.done).length}/${ais.length}</span>` : ''}
              </div>
            </div>
          </div>`;
        }).join('');
      }
    }

    if (showsTasks()) {
      // Urut prioritas, lalu tanggal terdekat
      const tasks = state.tasks
        .filter(t => inScope(t) && (ui.showDone || t.status !== 'done') && matchCategory(t))
        .sort((a, b) =>
          PRIORITY[a.priority].rank - PRIORITY[b.priority].rank ||
          (a.status === 'done') - (b.status === 'done') ||
          a.date.localeCompare(b.date) ||
          (a.time || '99').localeCompare(b.time || '99'));
      count += tasks.length;
      let group = null;
      for (const t of tasks) {
        if (t.priority !== group) {
          group = t.priority;
          html += `<div class="side-group ${group}">${PRIORITY[group].label} priority</div>`;
        }
        const rel = taskRelLabel(t);
        html += `<div class="side-item p-${t.priority} s-${t.status}" data-task="${t.id}" title="${esc(fmtDate(t.date))} — ${STATUS[t.status]}">
          <input type="checkbox" data-action="toggle" ${t.status === 'done' ? 'checked' : ''}${ro()} title="Mark as done">
          <div class="st-info">
            <div class="st-title">${esc(t.title)}</div>
            <div class="st-meta">
              <span class="rel ${rel.cls}">${rel.text}</span>
              ${t.time ? `<span>🕘 ${esc(t.time)}</span>` : ''}
              ${t.status === 'progress' ? '<span>◐ In progress</span>' : ''}
              ${catTag(t)}
            </div>
          </div>
        </div>`;
      }
    }

    $('#listCount').textContent = count;
    $('#sideList').innerHTML = html || `<div class="empty">${ui.scope === 'month'
      ? `No agenda in ${MONTHS[mo]} ${y}.` : 'No active agenda. 🎉'}</div>`;
  }

  $('#listScope').addEventListener('click', e => {
    const b = e.target.closest('[data-scope]');
    if (!b) return;
    ui.scope = b.dataset.scope;
    saveUi();
    $$('#listScope button').forEach(x => x.classList.toggle('active', x === b));
    renderPanel();
  });
  $('#showDone').addEventListener('change', e => { ui.showDone = e.target.checked; saveUi(); renderPanel(); });

  $('#sideList').addEventListener('click', e => {
    const row = e.target.closest('[data-task],[data-meeting]');
    if (!row) return;
    if (row.dataset.meeting) {
      const m = getMeeting(row.dataset.meeting);
      const d = parseKey(m.date);
      goMonth(d.getFullYear(), d.getMonth());
      openMeetingDetail(m.id);
      return;
    }
    const t = getTask(row.dataset.task);
    if (e.target.dataset.action === 'toggle') { toggleTaskDone(t.id, e.target.checked); return; }
    const d = parseKey(t.date);
    goMonth(d.getFullYear(), d.getMonth());
    openTaskForm(t);
  });

  /* ================= DIALOG UMUM ================= */
  $$('dialog:not([data-static])').forEach(dlg => {
    dlg.addEventListener('click', e => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  });

  /* ================= FORM PEKERJAAN ================= */
  const taskDialog = $('#taskDialog');
  function openTaskForm(task, dateKey) {
    $('#taskForm').reset();
    $('#taskDialogTitle').textContent = task ? 'Edit Task' : 'Add Task';
    $('#t-id').value = task?.id || '';
    $('#t-title').value = task?.title || '';
    $('#t-date').value = task?.date || dateKey || todayKey();
    $('#t-time').value = task?.time || '';
    $('#t-priority').value = task?.priority || 'med';
    $('#t-status').value = task?.status || 'todo';
    // Task baru: kalau filter kategori sedang aktif, langsung pakai kategori itu
    const cf = $('#categoryFilter').value;
    fillTaskCategorySelect(task ? task.categoryId : (getCat(cf) ? cf : ''));
    $('#t-desc').value = task?.desc || '';
    $('#deleteTaskBtn').hidden = !task;
    // Hanya bisa melihat: form tampil sebagai detail (tidak bisa diubah)
    const readOnly = !can('edit');
    $$('#taskForm input, #taskForm select, #taskForm textarea').forEach(el => { el.disabled = readOnly; });
    if (readOnly) $('#taskDialogTitle').textContent = 'Task Details';
    $('#taskCancelBtn').textContent = readOnly ? 'Close' : 'Cancel';
    clearInvalid(taskDialog);
    taskDialog.showModal();
    if (!readOnly) $('#t-title').focus();
  }

  function fillTaskCategorySelect(selectedId) {
    const sel = $('#t-category');
    // Placeholder tidak bisa dipilih: proyek wajib diisi
    sel.innerHTML = `<option value="" disabled hidden>Choose a project...</option>` +
      sortedCats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    sel.value = getCat(selectedId) ? selectedId : '';
  }

  $('#taskForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.categories.length) {
      notify('error', 'There are no projects yet. Add one first via ⚙️ Settings → Manage Categories.', 'No projects available');
      return;
    }
    if (!validateRequired($('#taskForm'))) return;
    const data = {
      title: $('#t-title').value.trim(),
      date: $('#t-date').value,
      time: $('#t-time').value,
      priority: $('#t-priority').value,
      status: $('#t-status').value,
      categoryId: $('#t-category').value,
      desc: $('#t-desc').value.trim()
    };
    const id = $('#t-id').value;
    const hiddenNote = ui.type === 'meeting' ? ' (The filter is showing meetings only — choose "All Agenda" to see it.)' : '';

    const ok = await withButtonLoading($('#taskSubmitBtn'), () => commit(() => {
      if (id) {
        const t = getTask(id);
        if (!t) throw new Error('Task not found — it may have been deleted.');
        Object.assign(t, data);
        syncActionFromTask(t);
      } else {
        state.tasks.push({ id: uid(), ...data });
      }
    }, {
      success: id ? `Changes to "${data.title}" saved.` : `Task "${data.title}" added.${hiddenNote}`,
      error: id ? 'Failed to save task changes.' : 'Failed to add task.'
    }));
    if (ok) taskDialog.close();
  });

  $('#deleteTaskBtn').addEventListener('click', async () => {
    const id = $('#t-id').value;
    const t = getTask(id);
    if (!t) return;
    const linked = findActionByTask(id);
    const yes = await confirmBox({
      title: 'Delete task?',
      message: `"${t.title}" will be permanently deleted.${linked ? '\nThe related meeting action item stays — only its link to the calendar is removed.' : ''}`,
      okText: 'Delete'
    });
    if (!yes) return;
    const ok = await withButtonLoading($('#deleteTaskBtn'), () => commit(() => {
      state.tasks = state.tasks.filter(x => x.id !== id);
      const ai = findActionByTask(id);
      if (ai) ai.taskId = null;
    }, { success: `Task "${t.title}" deleted.`, error: 'Failed to delete task.' }));
    if (ok) taskDialog.close();
  });

  /* ================= DIALOG DETAIL HARI ================= */
  const dayDialog = $('#dayDialog');
  function openDay(k) { openDayKey = k; renderDay(); if (!dayDialog.open) dayDialog.showModal(); }

  function renderDay() {
    const k = openDayKey;
    $('#dayTitle').textContent = fmtDate(k);
    const tasks = sortTasks(state.tasks.filter(t => t.date === k));
    const meets = state.meetings.filter(m => m.date === k).sort(byStart);
    let html = '';
    if (meets.length) {
      html += `<div><div class="day-section-title">Meetings (${meets.length})</div>` + meets.map(m => `
        <div class="day-row meeting" data-meeting="${m.id}">
          <div class="info">
            <div class="title">👥 ${esc(m.title)}</div>
            <div class="desc">${esc([fmtTime(m), m.location].filter(Boolean).join(' · '))}</div>
            <div class="meta"><span class="badge ${m.status}">${MSTATUS[m.status]}</span></div>
          </div>
        </div>`).join('') + '</div>';
    }
    html += `<div><div class="day-section-title">Tasks (${tasks.length})</div>`;
    html += tasks.length ? tasks.map(t => `
      <div class="day-row p-${t.priority} s-${t.status}" data-task="${t.id}">
        <input type="checkbox" data-action="toggle" ${t.status === 'done' ? 'checked' : ''}${ro()} title="Mark as done">
        <div class="info">
          <div class="title" data-action="edit">${esc(t.title)}</div>
          ${t.desc ? `<div class="desc">${esc(t.desc)}</div>` : ''}
          <div class="meta">
            ${isOverdue(t) ? '<span class="badge overdue">Overdue</span>' : ''}
            <span class="badge ${t.priority}">${PRIORITY[t.priority].label} priority</span>
            ${t.time ? `<span class="badge gray">🕘 ${esc(t.time)}</span>` : ''}
            ${catTag(t, 'pill')}
          </div>
        </div>
        <select data-action="status" title="Change status"${ro()}>
          ${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`).join('') : '<div class="empty">No tasks on this date yet.</div>';
    html += '</div>';
    $('#dayBody').innerHTML = html;
  }

  $('#dayBody').addEventListener('click', e => {
    const m = e.target.closest('[data-meeting]');
    if (m) { openMeetingDetail(m.dataset.meeting); return; }
    const row = e.target.closest('[data-task]');
    const act = e.target.dataset.action;
    if (!row || !act) return;
    const t = getTask(row.dataset.task);
    if (act === 'toggle') toggleTaskDone(t.id, e.target.checked);
    if (act === 'edit') openTaskForm(t);
  });
  $('#dayBody').addEventListener('change', e => {
    if (e.target.dataset.action !== 'status') return;
    const t = getTask(e.target.closest('[data-task]').dataset.task);
    const status = e.target.value;
    commit(() => { t.status = status; syncActionFromTask(t); }, {
      success: `"${t.title}" status changed to ${STATUS[status]}.`,
      error: 'Failed to update task status.'
    });
  });
  $('#dayAddTask').addEventListener('click', () => openTaskForm(null, openDayKey));
  $('#dayAddMeeting').addEventListener('click', () => openMeetingForm(null, openDayKey));

  /* ================= DETAIL MEETING ================= */
  function section(title, body, emptyText) {
    return `<div class="d-section"><h3>${title}</h3>${body || `<div class="placeholder">${emptyText}</div>`}</div>`;
  }
  const listHtml = (s, tag = 'ul') => { const l = lines(s); return l.length ? `<${tag}>${l.map(x => `<li>${esc(x)}</li>`).join('')}</${tag}>` : ''; };

  function meetingDetailHtml(m) {
    const tk = todayKey();
    const time = m.start ? `${m.start}${m.end ? ' – ' + m.end : ''} WIB` : '-';
    const loc = m.location ? (isUrl(m.location) ? `<a href="${esc(m.location)}" target="_blank" rel="noopener">${esc(m.location)}</a>` : esc(m.location)) : '-';
    const people = (m.participants || []).length
      ? `<div class="people">${m.participants.map(p => `<span class="person"><span class="avatar">${esc(initials(p))}</span>${esc(p)}</span>`).join('')}</div>` : '';
    const ais = m.actionItems || [];
    const aiTable = ais.length ? `<table class="ai-table">
        <thead><tr><th style="width:34px"></th><th>Follow-up</th><th>PIC</th><th>Deadline</th><th class="no-print">Calendar</th></tr></thead>
        <tbody>${ais.map(a => {
          const late = !a.done && a.due && a.due < tk;
          const linked = a.taskId && getTask(a.taskId);
          return `<tr class="${a.done ? 'done' : ''}" data-ai="${a.id}">
            <td><input type="checkbox" data-action="toggle-ai" ${a.done ? 'checked' : ''}${ro()}></td>
            <td class="ai-text">${esc(a.text)}</td>
            <td>${esc(a.pic) || '-'}</td>
            <td>${a.due ? fmtShort(a.due) : '-'} ${late ? '<span class="badge overdue">Overdue</span>' : ''}</td>
            <td class="no-print">${linked
              ? '<button class="link-btn" data-action="goto-task">✓ View in calendar</button>'
              : '<button class="link-btn need-edit" data-action="send-ai">+ Make it a task</button>'}</td>
          </tr>`;
        }).join('')}</tbody></table>` : '';

    return `
      <div class="detail-head">
        <div>
          <h2>${esc(m.title)}</h2>
          <span class="badge ${m.status}">${MSTATUS[m.status]}</span>
          <span class="badge gray">${MTYPE[m.type] || 'Offline'}</span>
        </div>
        <div class="detail-actions">
          ${m.status === 'scheduled' ? '<button class="btn ghost small need-edit" data-action="mark-done">✔ Mark as Done</button>' : ''}
          <button class="btn ghost small need-edit" data-action="duplicate" title="Create a new meeting with the same details (e.g. a recurring meeting)">⧉ Duplicate</button>
          <button class="btn ghost small" data-action="print">🖨 Print Minutes</button>
          <button class="btn primary small need-edit" data-action="edit">✎ Edit / Write Minutes</button>
        </div>
      </div>

      <div class="meta-grid">
        <div><div class="k">Date</div><div class="v">${fmtDate(m.date)}</div></div>
        <div><div class="k">Time</div><div class="v">${time}</div></div>
        <div><div class="k">Location / Link</div><div class="v">${loc}</div></div>
        <div><div class="k">Organizer</div><div class="v">${esc(m.organizer) || '-'}</div></div>
        <div><div class="k">Note-taker</div><div class="v">${esc(m.notetaker) || '-'}</div></div>
        ${m.nextMeeting ? `<div><div class="k">Next meeting</div><div class="v">${fmtDate(m.nextMeeting)}</div></div>` : ''}
      </div>

      ${section(`Attendees (${(m.participants || []).length})`, people, 'No attendees yet.')}
      ${section('🎯 Meeting Objective', m.objective ? `<div class="content">${esc(m.objective)}</div>` : '', 'No objective yet.')}
      ${section('📋 Agenda', listHtml(m.agenda, 'ol'), 'No agenda yet.')}
      ${section('📝 Minutes', m.minutes ? `<div class="content">${esc(m.minutes)}</div>` : '', 'No minutes yet. Click “Edit / Write Minutes” to start writing.')}
      ${section('✅ Decisions / Conclusions', listHtml(m.decisions), 'No decisions yet.')}
      ${section(`📌 Action Items (${ais.filter(a => a.done).length}/${ais.length})`, aiTable, 'No action items yet.')}
    `;
  }

  const detailDialog = $('#meetingDetailDialog');
  const mdBody = $('#mdBody');

  function openMeetingDetail(id) {
    const m = getMeeting(id);
    if (!m) return;
    mdBody.dataset.mid = id;
    mdBody.innerHTML = meetingDetailHtml(m);
    if (!detailDialog.open) detailDialog.showModal();
    mdBody.scrollTop = 0;
  }
  function refreshDetailDialog() {
    if (!detailDialog.open) return;
    const m = getMeeting(mdBody.dataset.mid);
    if (!m) { detailDialog.close(); return; }
    mdBody.innerHTML = meetingDetailHtml(m);
  }

  function printMeeting(m) {
    $('#printArea').innerHTML = meetingDetailHtml(m);
    document.body.classList.add('printing');
    window.print();
  }
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'));

  mdBody.addEventListener('click', e => {
    const actEl = e.target.closest('[data-action]');
    if (!actEl) return;
    const m = getMeeting(mdBody.dataset.mid);
    if (!m) return;
    const row = e.target.closest('[data-ai]');
    const ai = row && m.actionItems.find(a => a.id === row.dataset.ai);
    switch (actEl.dataset.action) {
      case 'edit': openMeetingForm(m); break;
      case 'print': printMeeting(m); break;
      case 'mark-done':
        commit(() => { m.status = 'done'; }, { success: `Meeting "${m.title}" marked as done.`, error: 'Failed to update meeting status.' });
        break;
      case 'duplicate': {
        const copy = {
          ...structuredClone(m), status: 'scheduled', minutes: '', decisions: '', actionItems: [],
          date: m.nextMeeting || m.date, nextMeeting: ''
        };
        openMeetingForm(copy, null, true);
        break;
      }
      case 'toggle-ai': setActionDone(ai, e.target.checked); break;
      case 'send-ai': {
        const date = ai.due || m.date;
        commit(() => {
          const t = {
            id: uid(), title: ai.text + (ai.pic ? ` (PIC: ${ai.pic})` : ''), date, time: '',
            priority: 'med', status: ai.done ? 'done' : 'todo', categoryId: followUpCategory().id,
            desc: `Action item from meeting "${m.title}" (${fmtShort(m.date)}).`
          };
          state.tasks.push(t);
          ai.taskId = t.id;
        }, {
          success: `"${ai.text}" added as a task on ${fmtDate(date)}.`,
          error: 'Failed to turn the action item into a task.'
        });
        break;
      }
      case 'goto-task': gotoTask(ai.taskId); break;
    }
  });

  // Ubah status action item (+ task kalender yang terhubung ikut menyesuaikan)
  function setActionDone(ai, done) {
    commit(() => {
      ai.done = done;
      const t = ai.taskId && getTask(ai.taskId);
      if (t) t.status = done ? 'done' : 'todo';
    }, {
      success: done ? `Action item "${ai.text}" marked as done.` : `Action item "${ai.text}" reopened.`,
      error: 'Failed to update action item status.'
    });
  }

  /* ================= DAFTAR ACTION ITEM PER MEETING ================= */
  const aiDialog = $('#aiDialog');
  let aiScope = 'open';

  function openActionItems(scope = 'open') {
    aiScope = scope;
    renderActionItems();
    if (!aiDialog.open) aiDialog.showModal();
  }

  function renderActionItems() {
    const tk = todayKey();
    const isLate = a => a.due && a.due < tk;
    $$('#aiScope button').forEach(b => b.classList.toggle('active', b.dataset.scope === aiScope));
    // Meeting yang punya action item terbuka (atau lewat deadline), urut tanggal meeting
    const groups = state.meetings
      .map(m => ({ m, items: (m.actionItems || []).filter(a => !a.done && (aiScope === 'open' || isLate(a))) }))
      .filter(g => g.items.length)
      .sort((a, b) => byDateStart(a.m, b.m));
    const total = groups.reduce((n, g) => n + g.items.length, 0);

    $('#aiList').innerHTML = groups.length ? `
      <p class="ai-summary">${plural(total, 'action item')} from ${plural(groups.length, 'meeting')}</p>` +
      groups.map(({ m, items }) => `
        <div class="ai-group">
          <button type="button" class="ai-group-head" data-meeting="${m.id}" title="Open meeting details">
            <span class="ai-group-title">👥 ${esc(m.title)}</span>
            <span class="ai-group-meta">${fmtShort(m.date)} · ${plural(items.length, aiScope === 'open' ? 'open item' : 'overdue item')}</span>
            <span class="ai-group-go">Open meeting ›</span>
          </button>
          ${items.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).map(a => `
            <div class="ai-item ${isLate(a) ? 'late' : ''}" data-mid="${m.id}" data-ai="${a.id}">
              <input type="checkbox" data-action="toggle" title="Mark as done"${ro()}>
              <div class="ai-item-text">${esc(a.text)}</div>
              <div class="ai-item-meta">
                ${a.pic ? `<span>👤 ${esc(a.pic)}</span>` : ''}
                ${a.due ? `<span>📅 ${fmtShort(a.due)}</span>` : '<span class="muted">No deadline</span>'}
                ${isLate(a) ? '<span class="badge overdue">Overdue</span>' : ''}
                ${a.taskId && getTask(a.taskId) ? '<span class="badge gray" title="Also on the calendar as a task">📋 Task</span>' : ''}
              </div>
            </div>`).join('')}
        </div>`).join('')
      : `<div class="empty">${aiScope === 'open' ? 'No open action items. 🎉' : 'No overdue action items. 🎉'}</div>`;
  }

  $('#stats').addEventListener('click', e => {
    const card = e.target.closest('[data-ai-scope]');
    if (card) openActionItems(card.dataset.aiScope);
  });
  $('#aiScope').addEventListener('click', e => {
    const b = e.target.closest('[data-scope]');
    if (!b) return;
    aiScope = b.dataset.scope;
    renderActionItems();
  });
  $('#aiList').addEventListener('click', e => {
    const head = e.target.closest('.ai-group-head');
    if (head) { openMeetingDetail(head.dataset.meeting); return; }
    if (e.target.dataset.action !== 'toggle') return;
    const row = e.target.closest('.ai-item');
    const ai = getMeeting(row.dataset.mid)?.actionItems.find(a => a.id === row.dataset.ai);
    if (ai) setActionDone(ai, e.target.checked);
  });

  function gotoTask(taskId) {
    const t = getTask(taskId);
    if (!t) return;
    $$('dialog[open]').forEach(d => d.close());
    ['search', 'statusFilter', 'priorityFilter', 'categoryFilter'].forEach(id => { $('#' + id).value = ''; });
    const d = parseKey(t.date);
    viewDate.setFullYear(d.getFullYear(), d.getMonth(), 1);
    if (ui.type === 'meeting') setType('all'); else renderAll();
    const chip = $(`#calendarGrid .chip[data-task="${t.id}"]`);
    if (chip) { chip.classList.add('flash'); chip.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else openDay(t.date); // tersembunyi di "+N lainnya"
  }

  /* ================= FORM MEETING ================= */
  const meetingDialog = $('#meetingDialog');

  function actionRow(a = {}) {
    return `<div class="ai-row" data-id="${esc(a.id || '')}" data-done="${a.done ? 1 : 0}" data-task="${esc(a.taskId || '')}">
      <input class="ai-text" placeholder="Task / follow-up" value="${esc(a.text)}">
      <input class="ai-pic" placeholder="PIC" value="${esc(a.pic)}">
      <input class="ai-due" type="date" value="${esc(a.due || '')}" title="Deadline">
      <button type="button" class="icon-btn danger" data-action="remove-ai" title="Remove">✕</button>
    </div>`;
  }

  // isNew=true dipakai untuk duplikat: data terisi tapi disimpan sebagai meeting baru
  function openMeetingForm(m, dateKey, isNew = false) {
    $('#meetingForm').reset();
    const editing = m && !isNew;
    $('#meetingDialogTitle').textContent = editing ? 'Edit Meeting & Minutes' : (isNew ? 'Duplicate Meeting' : 'Schedule Meeting');
    $('#m-id').value = editing ? m.id : '';
    $('#m-title').value = m?.title || '';
    $('#m-date').value = m?.date || dateKey || todayKey();
    $('#m-start').value = m?.start || '';
    $('#m-end').value = m?.end || '';
    $('#m-type').value = m?.type || 'offline';
    $('#m-location').value = m?.location || '';
    $('#m-organizer').value = m?.organizer || '';
    $('#m-notetaker').value = m?.notetaker || '';
    $('#m-status').value = m?.status || 'scheduled';
    $('#m-participants').value = (m?.participants || []).join(', ');
    $('#m-objective').value = m?.objective || '';
    $('#m-agenda').value = m?.agenda || '';
    $('#m-minutes').value = m?.minutes || '';
    $('#m-decisions').value = m?.decisions || '';
    $('#m-next').value = m?.nextMeeting || '';
    const ais = m?.actionItems || [];
    $('#actionRows').innerHTML = (ais.length ? ais : [{}]).map(actionRow).join('');
    $('#deleteMeetingBtn').hidden = !editing;
    clearInvalid(meetingDialog);
    meetingDialog.showModal();
    meetingDialog.querySelector('.dialog-body').scrollTop = 0;
    $('#m-title').focus();
  }

  $('#addActionRow').addEventListener('click', () => {
    $('#actionRows').insertAdjacentHTML('beforeend', actionRow());
    $('#actionRows .ai-row:last-child .ai-text').focus();
  });
  $('#actionRows').addEventListener('click', e => {
    if (e.target.closest('[data-action="remove-ai"]')) e.target.closest('.ai-row').remove();
  });

  $('#meetingForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateRequired($('#meetingForm'))) return;
    const data = {
      title: $('#m-title').value.trim(),
      date: $('#m-date').value,
      start: $('#m-start').value,
      end: $('#m-end').value,
      type: $('#m-type').value,
      location: $('#m-location').value.trim(),
      organizer: $('#m-organizer').value.trim(),
      notetaker: $('#m-notetaker').value.trim(),
      status: $('#m-status').value,
      participants: $('#m-participants').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
      objective: $('#m-objective').value.trim(),
      agenda: $('#m-agenda').value.trim(),
      minutes: $('#m-minutes').value.trim(),
      decisions: $('#m-decisions').value.trim(),
      nextMeeting: $('#m-next').value,
      actionItems: $$('#actionRows .ai-row').map(r => ({
        id: r.dataset.id || uid(),
        text: $('.ai-text', r).value.trim(),
        pic: $('.ai-pic', r).value.trim(),
        due: $('.ai-due', r).value,
        done: r.dataset.done === '1',
        taskId: r.dataset.task || null
      })).filter(a => a.text)
    };
    if (data.start && data.end && data.end < data.start) {
      $('#m-end').classList.add('invalid');
      $('#m-end').focus();
      notify('error', 'End time cannot be earlier than start time.', 'Invalid meeting time');
      return;
    }
    const editId = $('#m-id').value;
    const id = editId || uid();
    const hiddenNote = ui.type === 'task' ? ' (The filter is showing tasks only — choose "All Agenda" to see it.)' : '';

    const ok = await withButtonLoading($('#meetingSubmitBtn'), () => commit(() => {
      if (editId) {
        const m = getMeeting(editId);
        if (!m) throw new Error('Meeting not found — it may have been deleted.');
        Object.assign(m, data);
      } else {
        state.meetings.push({ id, ...data });
      }
    }, {
      success: editId ? `Changes to meeting "${data.title}" saved.` : `Meeting "${data.title}" scheduled for ${fmtDate(data.date)}.${hiddenNote}`,
      error: editId ? 'Failed to save meeting changes.' : 'Failed to add meeting.'
    }));
    if (!ok) return;
    meetingDialog.close();
    if (detailDialog.open) { mdBody.dataset.mid = id; refreshDetailDialog(); }
  });

  $('#deleteMeetingBtn').addEventListener('click', async () => {
    const m = getMeeting($('#m-id').value);
    if (!m) return;
    const yes = await confirmBox({
      title: 'Delete meeting?',
      message: `Meeting "${m.title}" and its minutes and action items will be permanently deleted.\nCalendar tasks created from its action items will not be deleted.`,
      okText: 'Delete'
    });
    if (!yes) return;
    const ok = await withButtonLoading($('#deleteMeetingBtn'), () => commit(() => {
      state.meetings = state.meetings.filter(x => x.id !== m.id);
    }, { success: `Meeting "${m.title}" deleted.`, error: 'Failed to delete meeting.' }));
    if (ok) meetingDialog.close();
  });

  /* ================= PENGATURAN: EXPORT / IMPORT / RESET ================= */
  const settingsDialog = $('#settingsDialog');
  function renderDataInfo() {
    const openAi = state.meetings.flatMap(m => m.actionItems || []).filter(a => !a.done).length;
    $('#dataInfo').innerHTML = `
      <div><b>${state.tasks.length}</b>tasks</div>
      <div><b>${state.meetings.length}</b>meetings</div>
      <div><b>${openAi}</b>open action items</div>
      <div><b>${state.categories.length}</b>categories</div>`;
    $('#catSummary').innerHTML = state.categories.length
      ? sortedCats().map(c => `<span class="cat-tag pill" style="--c:${esc(c.color)}"><i></i>${esc(c.name)}</span>`).join('')
      : '<span class="placeholder">No categories yet</span>';
  }
  const openSettings = () => { renderDataInfo(); renderBackupStatus(); renderServerBackup(); loadServerBackup(); settingsDialog.showModal(); };
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#manageCatBtn').addEventListener('click', () => openCategoryManager());

  /* ================= MASTER DATA KATEGORI ================= */
  const catDialog = $('#categoryDialog');
  const nextCatColor = () => CAT_COLORS[state.categories.length % CAT_COLORS.length];
  const catNameTaken = (name, exceptId) =>
    state.categories.some(c => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
  const catUsage = id => state.tasks.filter(t => t.categoryId === id).length;

  function openCategoryManager() {
    renderCatList();
    $('#catName').value = '';
    $('#catColor').value = nextCatColor();
    catDialog.showModal();
    $('#catName').focus();
  }

  function renderCatList() {
    $('#catCount').textContent = state.categories.length;
    $('#catList').innerHTML = sortedCats().map(c => `
      <div class="cat-row" data-id="${c.id}">
        <input type="color" class="cat-color" value="${esc(c.color)}" title="Change color">
        <input class="cat-name" value="${esc(c.name)}" maxlength="40" title="Click to rename">
        <span class="cat-usage">${catUsage(c.id)} task${catUsage(c.id) === 1 ? '' : 's'}</span>
        <button type="button" class="icon-btn sm danger need-admin" data-action="del-cat" title="Delete category">✕</button>
      </div>`).join('') || '<div class="empty">No categories yet. Add one above.</div>';
  }

  // Kategori otomatis untuk task yang dibuat dari action item meeting
  function followUpCategory() {
    let c = state.categories.find(x => [MEETING_FOLLOWUP_CAT.toLowerCase(), MEETING_FOLLOWUP_OLD].includes(x.name.toLowerCase()));
    if (!c) {
      c = { id: uid(), name: MEETING_FOLLOWUP_CAT, color: '#0b84c6' };
      state.categories.push(c);
      fillCategoryFilter();
    }
    return c;
  }

  $('#catAddForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateRequired($('#catAddForm'))) return;
    const name = $('#catName').value.trim();
    if (catNameTaken(name)) {
      $('#catName').classList.add('invalid');
      $('#catName').select();
      notify('error', `Category "${name}" already exists. Use a different name.`, 'Duplicate category name');
      return;
    }
    const color = $('#catColor').value;
    const ok = await withButtonLoading($('#catAddBtn'), () => commit(() => {
      state.categories.push({ id: uid(), name, color });
    }, { success: `Category "${name}" added.`, error: 'Failed to add category.' }));
    if (!ok) return;
    $('#catName').value = '';
    $('#catColor').value = nextCatColor();
    $('#catName').focus();
  });

  $('#catList').addEventListener('change', e => {
    const row = e.target.closest('.cat-row');
    const c = row && getCat(row.dataset.id);
    if (!c) return;
    if (e.target.classList.contains('cat-color')) {
      const color = e.target.value;
      commit(() => { c.color = color; }, { success: `Color of category "${c.name}" updated.`, error: 'Failed to change category color.' });
    }
    if (e.target.classList.contains('cat-name')) {
      const name = e.target.value.trim();
      if (!name || catNameTaken(name, c.id)) {
        notify('error', name ? `Category "${name}" already exists. Use a different name.` : 'Category name is required.', 'Invalid category name');
        e.target.value = c.name;
        return;
      }
      if (name === c.name) return;
      const old = c.name;
      commit(() => { c.name = name; }, { success: `Category "${old}" renamed to "${name}".`, error: 'Failed to rename category.' });
    }
  });
  $('#catList').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('cat-name')) { e.preventDefault(); e.target.blur(); }
  });
  $('#catList').addEventListener('click', async e => {
    if (!e.target.closest('[data-action="del-cat"]')) return;
    const c = getCat(e.target.closest('.cat-row').dataset.id);
    if (!c) return;
    const n = catUsage(c.id);
    const yes = await confirmBox({
      title: 'Delete category?',
      message: n
        ? `Category "${c.name}" is used by ${plural(n, 'task')}.\nThose tasks won't be deleted, but you'll need to choose a project again when editing them.`
        : `Category "${c.name}" will be removed from the master data.`,
      okText: 'Delete'
    });
    if (!yes) return;
    commit(() => {
      state.categories = state.categories.filter(x => x.id !== c.id);
      state.tasks.forEach(t => { if (t.categoryId === c.id) t.categoryId = ''; });
    }, { success: `Category "${c.name}" deleted.`, error: 'Failed to delete category.' });
  });

  /* ---------- Export / Import / Reset ---------- */
  $('#exportBtn').addEventListener('click', async () => {
    try {
      await runWithLoading('Preparing export file...', () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `worktrack-backup-${todayKey()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      notify('success', `Exported ${plural(state.tasks.length, 'task')}, ${plural(state.meetings.length, 'meeting')}, and ${state.categories.length} ${state.categories.length === 1 ? 'category' : 'categories'}.`, 'Export complete');
    } catch (err) {
      console.error(err);
      notify('error', `Failed to create the export file. ${errorDetail(err)}`, 'Export failed');
    }
  });

  const readFileText = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
    reader.readAsText(file);
  });

  $('#importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    let data;
    try {
      data = await runWithLoading('Reading file...', async () => {
        const parsed = JSON.parse(await readFileText(file));
        if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.meetings)) {
          throw new Error('Unrecognized file format.');
        }
        return parsed;
      });
    } catch (err) {
      console.error(err);
      notify('error', `"${file.name}" is not a valid file. Make sure it comes from WorkTrack's Export feature.`, 'Import failed');
      return;
    }

    const yes = await confirmBox({
      title: 'Import data?',
      message: `The file contains ${plural(data.tasks.length, 'task')} and ${plural(data.meetings.length, 'meeting')}.\nAll current data will be REPLACED${CLOUD ? ' — for EVERYONE who uses this link' : ''}.`,
      okText: 'Import & replace'
    });
    if (!yes) return;

    freshStart = false;
    await runWithLoading('Importing data...', () => commit(() => { state = migrate(data); }, {
      success: `Imported ${plural(data.tasks.length, 'task')} and ${plural(data.meetings.length, 'meeting')}.`,
      error: 'Import failed — your existing data was kept.'
    }));
  });

  $('#resetBtn').addEventListener('click', async () => {
    const yes = await confirmBox({
      title: 'Delete all data?',
      message: `${plural(state.tasks.length, 'task')} and ${plural(state.meetings.length, 'meeting')} will be permanently deleted${CLOUD ? ' for everyone' : ''}. This cannot be undone.\nCategories are kept. Export your data first if you need a backup.`,
      okText: 'Delete all'
    });
    if (!yes) return;
    await runWithLoading('Deleting data...', () => commit(() => {
      state = { categories: state.categories, tasks: [], meetings: [] };
    }, { success: 'All tasks and meetings deleted.', error: 'Failed to delete data.' }));
  });

  /* ================= BACKUP OTOMATIS KE FILE ================= */
  // Setiap perubahan data juga ditulis ke file JSON pilihan pengguna (File System Access API,
  // Chrome/Edge). File ini tetap ada walau data browser dihapus, lalu bisa dipulihkan lewat Import.
  const BACKUP_META_KEY = 'worktrack-backup-v1';
  const FS_SUPPORTED = 'showSaveFilePicker' in window && 'indexedDB' in window;
  const backup = {
    handle: null,   // FileSystemFileHandle
    perm: 'none',   // none | granted | prompt | denied
    timer: null,
    writing: false,
    dirty: false,   // ada perubahan yang belum tertulis ke file
    error: null,
    meta: (() => { try { return JSON.parse(localStorage.getItem(BACKUP_META_KEY)) || {}; } catch (e) { return {}; } })()
  };
  const saveBackupMeta = () => { try { localStorage.setItem(BACKUP_META_KEY, JSON.stringify(backup.meta)); } catch (e) { /* abaikan */ } };

  // Handle file hanya bisa disimpan di IndexedDB, tidak bisa di localStorage
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('worktrack-fs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('handles', mode);
        const r = fn(tx.objectStore('handles'));
        tx.oncomplete = () => { db.close(); resolve(r.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }
  const getStoredHandle = () => idb('readonly', s => s.get('backup'));
  const storeHandle = h => idb('readwrite', s => h ? s.put(h, 'backup') : s.delete('backup'));

  const fmtStamp = ms => {
    const d = new Date(ms);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return toKey(d) === todayKey() ? time : `${fmtShort(toKey(d))} ${time}`;
  };

  function backupState() {
    if (!FS_SUPPORTED) return 'unsupported';
    if (!backup.handle) return 'off';
    if (backup.perm !== 'granted') return 'paused';
    if (backup.error) return 'error';
    if (backup.writing || backup.dirty) return 'saving';
    return 'ok';
  }

  function renderBackupStatus() {
    const st = backupState();
    const name = esc(backup.handle?.name || backup.meta.fileName || '');
    const last = backup.meta.lastWrite ? fmtStamp(backup.meta.lastWrite) : '';

    // Indikator di header
    const pill = $('#backupPill');
    const PILL = {
      off: ['warn', '💾 File backup off', 'Click to turn on automatic backup to a file'],
      paused: ['warn', '💾 Click to resume backup', `The browser needs permission again to write to "${backup.handle?.name}"`],
      error: ['error', '💾 Backup failed — click to retry', backup.error?.message || ''],
      saving: ['', '💾 Saving...', ''],
      ok: ['ok', `💾 File ✓ ${last}`, `Backup file saved: ${backup.handle?.name}`]
    };
    // Mode online: backup utama = backup harian di server, jadi tanda di header hanya muncul jika perlu tindakan
    pill.hidden = st === 'unsupported' || (CLOUD && st !== 'paused' && st !== 'error');
    if (PILL[st]) {
      const [cls, text, title] = PILL[st];
      pill.className = `backup-pill ${cls}`;
      pill.textContent = text;
      pill.title = title;
      pill.dataset.state = st;
    }

    // Bagian di Pengaturan
    const DESC = {
      unsupported: 'This browser does not support automatic backup to a file. Use <b>Chrome</b> or <b>Edge</b>, or export regularly.',
      off: 'Off. Pick a file (e.g. in Documents) and every change you make in this browser is saved to it.',
      paused: `File: <b>${name}</b><br>The browser asks for permission again after it is reopened. Click <b>Resume</b> to allow it.`,
      error: `File: <b>${name}</b><br><span class="txt-danger">Could not write the file. It may have been moved or deleted — click Retry or choose another file.</span>`,
      saving: `File: <b>${name}</b><br>Saving...`,
      ok: `File: <b>${name}</b><br>Last saved: ${last}`
    };
    const ACTIONS = {
      unsupported: '',
      off: '<button class="btn primary" data-backup="choose">📁 Choose backup file</button>',
      paused: '<button class="btn primary" data-backup="resume">▶ Resume</button><button class="btn ghost" data-backup="choose">Change file</button>',
      error: '<button class="btn primary" data-backup="resume">↻ Retry</button><button class="btn ghost" data-backup="choose">Change file</button>',
      saving: '<button class="btn ghost" data-backup="choose">Change file</button><button class="btn danger-ghost" data-backup="disable">Turn off</button>',
      ok: '<button class="btn ghost" data-backup="choose">Change file</button><button class="btn danger-ghost" data-backup="disable">Turn off</button>'
    };
    $('#backupDesc').innerHTML = DESC[st];
    $('#backupActions').innerHTML = ACTIONS[st];
  }

  async function writeBackup() {
    clearTimeout(backup.timer);
    backup.timer = null;
    if (!backup.handle || backup.perm !== 'granted') return false;
    if (backup.writing) { scheduleBackup(); return false; } // tunggu penulisan sebelumnya selesai
    const hadError = !!backup.error;
    backup.writing = true;
    backup.dirty = false;
    renderBackupStatus();
    try {
      const w = await backup.handle.createWritable();
      await w.write(JSON.stringify(state, null, 2));
      await w.close();
      backup.error = null;
      backup.meta.lastWrite = Date.now();
      saveBackupMeta();
      return true;
    } catch (err) {
      console.error(err);
      backup.dirty = true;
      if (err.name === 'NotAllowedError') backup.perm = 'prompt';
      else {
        backup.error = err;
        if (!hadError) notify('error', `Your data is still safe in the browser, but the backup file could not be written. ${errorDetail(err)}`, 'File backup failed');
      }
      return false;
    } finally {
      backup.writing = false;
      renderBackupStatus();
    }
  }

  function scheduleBackup() {
    if (!backup.handle) return;
    backup.dirty = true;
    if (backup.perm === 'granted') {
      clearTimeout(backup.timer);
      backup.timer = setTimeout(writeBackup, 800); // tunggu sebentar supaya tidak menulis berkali-kali
    }
    renderBackupStatus();
  }

  async function chooseBackupFile() {
    let h;
    try {
      h = await window.showSaveFilePicker({
        suggestedName: 'worktrack-backup.json',
        startIn: 'documents',
        types: [{ description: 'WorkTrack backup file', accept: { 'application/json': ['.json'] } }]
      });
    } catch (err) {
      if (err.name !== 'AbortError') notify('error', `Could not select the file. ${errorDetail(err)}`, 'Failed to turn on backup');
      return;
    }
    backup.handle = h;
    backup.perm = 'granted';
    backup.error = null;
    freshStart = false; // file dipilih sendiri oleh pengguna → boleh ditulis
    backup.meta.fileName = h.name;
    saveBackupMeta();
    try { await storeHandle(h); } catch (err) { console.error(err); }
    if (await writeBackup()) {
      notify('success', `Every change will now be saved to "${h.name}" automatically.`, 'Automatic backup on');
    }
  }

  // requestPermission wajib dipanggil dari klik pengguna
  async function resumeBackup() {
    if (!backup.handle) return chooseBackupFile();
    try { backup.perm = await backup.handle.requestPermission({ mode: 'readwrite' }); } catch (e) { backup.perm = 'prompt'; }
    if (backup.perm !== 'granted') {
      renderBackupStatus();
      notify('warning', 'Permission to write the file was not granted. Automatic backup is paused.', 'Backup paused');
      return;
    }
    backup.error = null;
    if (freshStart) return restoreFromBackupFile();
    if (await writeBackup()) notify('success', `Latest data saved to "${backup.handle.name}".`, 'Backup resumed');
  }

  async function restoreFromBackupFile() {
    let data;
    try {
      data = JSON.parse(await (await backup.handle.getFile()).text());
      if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.meetings)) throw new Error('Unrecognized file format.');
    } catch (err) {
      console.error(err);
      backup.perm = 'prompt';
      renderBackupStatus();
      notify('error', `"${backup.handle.name}" could not be read. Choose another file in Settings. ${errorDetail(err)}`, 'Restore failed');
      return;
    }
    const yes = await confirmBox({
      title: 'Restore from backup file?',
      message: `This browser has no data. "${backup.handle.name}" contains ${plural(data.tasks.length, 'task')} and ${plural(data.meetings.length, 'meeting')}.\nRestore your data from that file?`,
      okText: 'Restore data',
      danger: false
    });
    if (!yes) {
      backup.perm = 'prompt'; // tetap dijeda supaya file backup tidak tertimpa data kosong
      renderBackupStatus();
      notify('warning', 'Backup stays paused so the file is not overwritten. Choose "Change file" if you want to use a new file.', 'Backup paused');
      return;
    }
    freshStart = false;
    commit(() => { state = migrate(data); }, {
      success: `Restored ${plural(data.tasks.length, 'task')} and ${plural(data.meetings.length, 'meeting')} from "${backup.handle.name}".`,
      error: 'Restore failed.'
    });
  }

  async function disableBackup() {
    const yes = await confirmBox({
      title: 'Turn off automatic backup?',
      message: `Future changes will no longer be saved to "${backup.handle?.name}". The existing file will not be deleted.`,
      okText: 'Turn off'
    });
    if (!yes) return;
    clearTimeout(backup.timer);
    backup.handle = null;
    backup.perm = 'none';
    backup.error = null;
    backup.dirty = false;
    delete backup.meta.fileName;
    saveBackupMeta();
    try { await storeHandle(null); } catch (err) { console.error(err); }
    renderBackupStatus();
    notify('info', 'Automatic backup turned off.');
  }

  $('#backupActions').addEventListener('click', e => {
    const act = e.target.closest('[data-backup]')?.dataset.backup;
    if (act === 'choose') chooseBackupFile();
    if (act === 'resume') resumeBackup();
    if (act === 'disable') disableBackup();
  });
  $('#backupPill').addEventListener('click', e => {
    const st = e.currentTarget.dataset.state;
    if (st === 'paused' || st === 'error') resumeBackup();
    else openSettings();
  });
  // Tulis perubahan yang tertunda saat tab ditutup/disembunyikan
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (backup.timer) writeBackup();
  });

  async function initBackup() {
    // Minta browser tidak menghapus data situs ini secara otomatis saat disk penuh
    if (navigator.storage?.persist) {
      navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
    }
    if (FS_SUPPORTED) {
      try {
        const h = await getStoredHandle();
        if (h) {
          backup.handle = h;
          // Data browser kosong tapi file backup masih terhubung: JANGAN tulis (file berisi data asli).
          // Pengguna diminta klik dulu, lalu ditawari pemulihan dari file tersebut.
          backup.perm = freshStart ? 'prompt' : await h.queryPermission({ mode: 'readwrite' });
          if (backup.perm === 'granted') await writeBackup();
        }
      } catch (err) { console.error(err); }
    }
    renderBackupStatus();

    if (freshStart && backup.handle) {
      notify('info', `Backup file "${backup.handle.name}" is still connected. Click the backup button at the top right to restore your data.`, 'Browser data is empty');
    } else if (freshStart) {
      notify('info', 'There is no data in this browser yet. If you have a backup file, restore it via ⚙️ Settings → Import.', 'No data');
    }
  }

  /* ================= DATA ONLINE (Supabase) ================= */
  const sb = CLOUD ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  const TABLES = ['categories', 'tasks', 'meetings'];
  const cloud = { loaded: false, sync: 'loading', reloadTimer: null, queue: Promise.resolve() };

  // Bandingkan data sebelum & sesudah perubahan → baris yang perlu disimpan / dihapus
  function diffState(before, after) {
    const ops = { upserts: {}, removes: {}, count: 0, deletes: 0 };
    for (const t of TABLES) {
      const old = new Map(before[t].map(x => [x.id, JSON.stringify(x)]));
      const now = new Set();
      ops.upserts[t] = [];
      ops.removes[t] = [];
      for (const x of after[t]) {
        now.add(x.id);
        if (old.get(x.id) !== JSON.stringify(x)) ops.upserts[t].push({ id: x.id, data: x });
      }
      for (const id of old.keys()) if (!now.has(id)) ops.removes[t].push(id);
      ops.count += ops.upserts[t].length + ops.removes[t].length;
      ops.deletes += ops.removes[t].length;
    }
    return ops;
  }

  // Perubahan dikirim berurutan (antrian), supaya tidak saling menimpa
  function cloudSync(ops) {
    const run = cloud.queue.catch(() => {}).then(() => pushOps(ops));
    cloud.queue = run;
    return run;
  }

  async function pushOps(ops) {
    setSync('saving');
    try {
      for (const t of TABLES) {
        const rows = ops.upserts[t];
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await sb.from(t).upsert(rows.slice(i, i + 200));
          if (error) throw error;
        }
      }
      for (const t of [...TABLES].reverse()) {
        const ids = ops.removes[t];
        for (let i = 0; i < ids.length; i += 200) {
          const part = ids.slice(i, i + 200);
          const { data, error } = await sb.from(t).delete().in('id', part).select('id');
          if (error) throw error;
          // Database tidak error saat hapus ditolak, hanya 0 baris terhapus → cek manual
          if ((data || []).length < part.length) throw Object.assign(new Error('Delete was not allowed.'), { code: '42501' });
        }
      }
      setSync('ok');
    } catch (err) {
      setSync('error');
      throw err;
    }
  }

  function cloudErrorText(err) {
    if (err?.code === '42501') return 'You do not have permission for this change (your access may have changed). Refresh the page and try again.';
    if (!navigator.onLine || /fetch|network/i.test(err?.message || '')) return 'Could not reach the server. Check your internet connection.';
    return err?.message ? `Details: ${err.message}` : 'Please try again.';
  }

  async function fetchTable(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('id,data').order('id').range(from, from + 999);
      if (error) throw error;
      out.push(...data.map(r => ({ ...r.data, id: r.id })));
      if (data.length < 1000) return out;
    }
  }

  async function reloadCloud({ quiet = false } = {}) {
    try {
      const [categories, tasks, meetings] = await Promise.all(TABLES.map(fetchTable));
      state = migrate({ categories, tasks, meetings });
      cloud.loaded = true;
      freshStart = false;
      setSync('ok');
      refreshAfterChange();
      return true;
    } catch (err) {
      console.error(err);
      setSync('error');
      if (!quiet) notify('error', `Could not load data from the server. ${cloudErrorText(err)}`, 'Load failed');
      return false;
    }
  }

  // Perubahan dari orang lain masuk otomatis (realtime). Ditunda sebentar & menunggu antrian simpan.
  function scheduleReload() {
    clearTimeout(cloud.reloadTimer);
    cloud.reloadTimer = setTimeout(() => cloud.queue.catch(() => {}).then(() => reloadCloud({ quiet: true })), 600);
  }

  function setSync(st) { cloud.sync = st; renderSyncPill(); }
  function renderSyncPill() {
    const pill = $('#syncPill');
    pill.hidden = !CLOUD;
    if (!CLOUD) return;
    const [cls, text, title] =
      cloud.sync === 'error' ? ['error', '☁ Not synced', 'Could not reach the server. Your last change may not be saved.']
      : !can('edit') ? ['view', '👁 View only', auth.user ? 'Your account can view only. Ask the super admin for editor access.' : 'Sign in to add or edit']
      : cloud.sync === 'saving' ? ['', '☁ Saving...', '']
      : cloud.sync === 'loading' ? ['', '☁ Loading...', '']
      : ['', '☁ Saved', 'All changes are saved online'];
    pill.className = `sync-pill ${cls}`;
    pill.textContent = text;
    pill.title = title;
  }

  // Data lama di browser ini (sebelum online) bisa diunggah sekali oleh admin
  let localOffered = false;
  async function offerLocalUpload() {
    const ASKED_KEY = 'worktrack-local-upload-asked';
    if (!CLOUD || localOffered || !cloud.loaded || !can('admin') || localStorage.getItem(ASKED_KEY)) return;
    if (state.tasks.length || state.meetings.length) return;
    let local;
    try { local = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { return; }
    if (!local.tasks.length && !local.meetings.length) return;
    localOffered = true;
    try { localStorage.setItem(ASKED_KEY, '1'); } catch (e) { /* abaikan */ }
    const yes = await confirmBox({
      title: 'Upload data from this browser?',
      message: `The online database is empty, but this browser still has ${plural(local.tasks.length, 'task')} and ${plural(local.meetings.length, 'meeting')} from before.\nUpload them so everyone with the link can see them?`,
      okText: 'Upload',
      danger: false
    });
    if (!yes) return;
    await runWithLoading('Uploading data...', () => commit(() => { state = local; }, {
      success: `Uploaded ${plural(local.tasks.length, 'task')} and ${plural(local.meetings.length, 'meeting')}.`,
      error: 'Upload failed.'
    }));
  }

  /* ================= LOGIN & AKUN ================= */
  function applyAccess() {
    const b = document.body.classList;
    b.toggle('cloud', CLOUD);
    b.toggle('can-edit', can('edit'));
    b.toggle('can-admin', can('admin'));
    b.toggle('can-super', can('super'));
  }

  function renderAccount() {
    if (!CLOUD) return;
    $('#signInBtn').hidden = !!auth.user;
    $('#accountBtn').hidden = !auth.user;
    if (auth.user) {
      $('#accountBtn').innerHTML = `<span class="acc-mail">${esc(auth.user.email)}</span><span class="role-badge ${auth.role}">${ROLE_LABEL[auth.role]}</span>`;
    }
  }

  async function refreshRole() {
    let role = 'anon';
    if (auth.user) {
      const { data, error } = await sb.rpc('my_role');
      role = !error && Object.prototype.hasOwnProperty.call(RANK, data) ? data : 'viewer';
    }
    const changed = role !== auth.role;
    auth.role = role;
    applyAccess();
    renderAccount();
    renderSyncPill();
    if (changed) {
      if (!can('edit')) [taskDialog, meetingDialog, catDialog].forEach(d => d.open && d.close());
      refreshAfterChange();
      offerLocalUpload();
      loadServerBackup();
    }
  }

  const loginDialog = $('#loginDialog');
  let loginMode = 'signin';
  function setLoginMode(mode) {
    loginMode = mode;
    $('#loginTitle').textContent = { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password' }[mode];
    $('#loginSubmitBtn').textContent = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link' }[mode];
    $('#loginNote').textContent = {
      signin: 'Anyone with the link can view. Sign in to add or edit (if the super admin has given you access).',
      signup: 'New accounts can view only. The super admin decides who becomes an editor or admin. Use at least 8 characters for the password.',
      forgot: 'Enter your account email. We will send a link to set a new password.'
    }[mode];
    $('#loginPassField').hidden = mode === 'forgot';
    $('#loginPass').required = mode !== 'forgot';
    $('#loginPass').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('#loginModeBtn').textContent = mode === 'signin' ? 'No account yet? Create one' : 'Back to sign in';
    $('#forgotBtn').hidden = mode !== 'signin';
    clearInvalid(loginDialog);
  }
  function openLogin(mode = 'signin') {
    $('#loginForm').reset();
    setLoginMode(mode);
    loginDialog.showModal();
    $('#loginEmail').focus();
  }
  $('#signInBtn').addEventListener('click', () => openLogin());
  $('#loginModeBtn').addEventListener('click', () => setLoginMode(loginMode === 'signin' ? 'signup' : 'signin'));
  $('#forgotBtn').addEventListener('click', () => setLoginMode('forgot'));

  const redirectUrl = () => location.origin + location.pathname;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateRequired($('#loginForm'))) return;
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPass').value;
    if (loginMode !== 'forgot' && password.length < 8) {
      $('#loginPass').classList.add('invalid');
      notify('error', 'The password must be at least 8 characters.', 'Password too short');
      return;
    }
    await withButtonLoading($('#loginSubmitBtn'), async () => {
      if (loginMode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return notify('error', error.message, 'Sign-in failed');
        loginDialog.close();
        notify('success', `Signed in as ${email}.`, 'Welcome');
      } else if (loginMode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
        if (error) return notify('error', error.message, 'Could not create account');
        loginDialog.close();
        notify('info', data.session
          ? 'Account created. You can view for now — ask the super admin for editor access.'
          : `Open the email sent to ${email} and click the confirmation link, then sign in. You can view only until the super admin gives you access.`,
          'Account created');
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
        if (error) return notify('error', error.message, 'Could not send the link');
        loginDialog.close();
        notify('info', `If ${email} has an account, a link to set a new password has been sent.`, 'Check your email');
      }
    });
  });

  const accountDialog = $('#accountDialog');
  const ROLE_NOTE = {
    viewer: 'You can view everything. Ask the super admin if you need to add or edit.',
    editor: 'You can add and edit tasks, meetings and categories. Deleting needs an admin.',
    admin: 'You can add, edit and delete, import data and set up backups.',
    super_admin: 'You can do everything, including giving other people access via 👥 Users.'
  };
  function openAccount() {
    $('#passwordForm').reset();
    $('#accEmail').textContent = auth.user?.email || '';
    $('#accRole').innerHTML = `<span class="role-badge ${auth.role}">${ROLE_LABEL[auth.role]}</span>`;
    $('#accRoleNote').textContent = ROLE_NOTE[auth.role] || '';
    clearInvalid(accountDialog);
    accountDialog.showModal();
  }
  $('#accountBtn').addEventListener('click', openAccount);
  $('#signOutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    accountDialog.close();
    notify('info', 'You are signed out. You can still view the data.', 'Signed out');
  });
  $('#passwordForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateRequired($('#passwordForm'))) return;
    const p1 = $('#newPass').value, p2 = $('#newPass2').value;
    if (p1.length < 8) { $('#newPass').classList.add('invalid'); return notify('error', 'The password must be at least 8 characters.', 'Password too short'); }
    if (p1 !== p2) { $('#newPass2').classList.add('invalid'); return notify('error', 'The two passwords are not the same.', 'Passwords do not match'); }
    await withButtonLoading($('#passSaveBtn'), async () => {
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) return notify('error', error.message, 'Could not change password');
      $('#passwordForm').reset();
      accountDialog.close();
      notify('success', 'Your new password is saved.', 'Password changed');
    });
  });

  /* ================= KELOLA USER (khusus super admin) ================= */
  const usersDialog = $('#usersDialog');
  const fmtWhen = v => v ? fmtShort(toKey(new Date(v))) : 'never';
  let usersCache = [];

  async function loadUsers() {
    $('#userList').innerHTML = '<div class="empty">Loading...</div>';
    const { data, error } = await sb.rpc('list_users');
    if (error) {
      $('#userList').innerHTML = `<div class="empty txt-danger">${esc(error.message)}</div>`;
      return;
    }
    usersCache = data || [];
    $('#userCount').textContent = usersCache.length;
    $('#userList').innerHTML = usersCache.map(u => {
      const me = u.id === auth.user?.id;
      const control = u.role === 'super_admin'
        ? `<span class="role-badge super_admin">${ROLE_LABEL.super_admin}</span>`
        : `<select data-uid="${esc(u.id)}" title="Access level">
             ${['viewer', 'editor', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
           </select>
           <button type="button" class="icon-btn sm danger" data-remove="${esc(u.id)}" title="Remove this account">✕</button>`;
      return `<div class="user-row ${me ? 'me' : ''}">
        <div class="u-info">
          <div class="u-mail">${esc(u.email)}${me ? ' (you)' : ''}</div>
          <div class="u-meta">Joined ${fmtWhen(u.created_at)} · Last sign-in ${fmtWhen(u.last_sign_in_at)}</div>
        </div>
        ${control}
      </div>`;
    }).join('') || '<div class="empty">No accounts yet.</div>';
  }

  $('#usersBtn').addEventListener('click', () => { usersDialog.showModal(); loadUsers(); });
  $('#usersRefreshBtn').addEventListener('click', loadUsers);
  $('#userList').addEventListener('change', async e => {
    const sel = e.target.closest('select[data-uid]');
    if (!sel) return;
    const u = usersCache.find(x => x.id === sel.dataset.uid);
    sel.disabled = true;
    const { error } = await sb.rpc('set_user_role', { target: sel.dataset.uid, new_role: sel.value });
    sel.disabled = false;
    if (error) {
      notify('error', error.message, 'Could not change access');
      if (u) sel.value = u.role;
      return;
    }
    if (u) u.role = sel.value;
    notify('success', `${u?.email || 'User'} is now ${ROLE_LABEL[sel.value]}.`, 'Access updated');
  });
  $('#userList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const u = usersCache.find(x => x.id === btn.dataset.remove);
    const yes = await confirmBox({
      title: 'Remove account?',
      message: `${u?.email || 'This account'} will be deleted and can no longer sign in.\nThe data they created stays.`,
      okText: 'Remove'
    });
    if (!yes) return;
    const { error } = await sb.rpc('remove_user', { target: btn.dataset.remove });
    if (error) return notify('error', error.message, 'Could not remove account');
    notify('success', `${u?.email || 'Account'} removed.`, 'Account removed');
    loadUsers();
  });

  /* ================= STATUS BACKUP HARIAN (Google Apps Script → Drive) ================= */
  // Script backup melapor ke tabel backup_log setelah setiap backup. Hanya admin yang bisa membacanya.
  const LATE_MS = 26 * 3600e3; // lebih dari ± 1 hari tanpa backup = terlambat
  const srv = { state: 'loading', last: null, lastOk: null, busy: false };

  async function loadServerBackup() {
    if (!CLOUD || !can('admin') || srv.busy) return;
    srv.busy = true;
    try {
      const { data, error } = await sb.from('backup_log')
        .select('ran_at,ok,tasks,meetings,categories,message')
        .order('ran_at', { ascending: false }).limit(20);
      if (error) throw error;
      srv.last = data[0] || null;
      srv.lastOk = data.find(r => r.ok) || null;
      srv.state = !srv.last ? 'none'
        : !srv.last.ok ? 'error'
        : Date.now() - new Date(srv.last.ran_at).getTime() > LATE_MS ? 'late' : 'ok';
    } catch (err) {
      console.error(err);
      srv.state = err?.code === 'PGRST205' ? 'nodb' : 'unknown'; // PGRST205 = tabel belum dibuat
    } finally {
      srv.busy = false;
      renderServerBackup();
    }
  }

  function renderServerBackup() {
    if (!CLOUD) return;
    const ago = r => {
      const days = Math.floor((Date.now() - new Date(r.ran_at).getTime()) / 86400000);
      return days <= 0 ? '' : ` (${plural(days, 'day')} ago)`;
    };
    const counts = r => `${plural(r.tasks ?? 0, 'task')}, ${plural(r.meetings ?? 0, 'meeting')}, ${r.categories ?? 0} ${r.categories === 1 ? 'category' : 'categories'}`;
    const when = r => fmtStamp(new Date(r.ran_at).getTime());
    const lastOkLine = srv.lastOk ? `<br>Last successful backup: <b>${when(srv.lastOk)}</b>${ago(srv.lastOk)}.` : '';
    const SETUP = `<ol class="bc-steps">
        <li>Click <b>🔑 Create backup key</b> and copy the key.</li>
        <li>In the Apps Script (<b>supabase-drive-backup.gs</b>), paste it into <b>BACKUP_TOKEN</b> and fill in <b>FOLDER_ID</b>.</li>
        <li>Run <b>pasangJadwal</b> once. The status appears here after the first backup.</li>
      </ol>`;

    const V = {
      loading: ['', 'Checking...', 'Checking the latest backup...', '', ''],
      ok: ['ok', '● Active', `Last backup: <b>${srv.last && when(srv.last)}</b> · ${srv.last && counts(srv.last)}.<br>Runs every night around 23:00.`,
        'ok', `🛡 Backup ✓ ${srv.last && when(srv.last)}`],
      late: ['warn', 'Late', `<span class="txt-warn">No backup in over a day.</span>${lastOkLine}<br>The schedule may have stopped — open the Apps Script and run <b>pasangJadwal</b> again.`,
        'warn', '🛡 Backup late'],
      error: ['error', 'Failed', `<span class="txt-danger">The last backup (${srv.last && when(srv.last)}) failed: ${esc(srv.last?.message || 'unknown error')}</span>${lastOkLine}`,
        'error', '🛡 Backup failed'],
      none: ['warn', 'Not set up', `No backup has been reported yet.${SETUP}`, 'warn', '🛡 Backup not set up'],
      nodb: ['warn', 'Not set up', 'The database is not ready for backup status yet. Run the latest <b>supabase/schema.sql</b> in Supabase → SQL Editor.', 'warn', '🛡 Backup not set up'],
      unknown: ['', 'Unknown', 'Could not check the backup status right now. Try <b>↻ Check status</b> later.', '', '']
    };
    const [cls, label, detail, pillCls, pillText] = V[srv.state] || V.unknown;
    $('#srvStatus').className = `bc-status ${cls}`;
    $('#srvStatus').textContent = label;
    $('#srvDetail').innerHTML = detail;

    const pill = $('#srvPill');
    pill.hidden = !pillText;
    pill.className = `backup-pill need-admin cloud-only ${pillCls}`;
    pill.textContent = pillText;
    pill.title = 'Daily backup to Google Drive — click for details';
  }

  $('#srvPill').addEventListener('click', () => openSettings());
  $('#srvRefreshBtn').addEventListener('click', loadServerBackup);
  $('#srvKeyBtn').addEventListener('click', async () => {
    const yes = await confirmBox({
      title: 'Create a new backup key?',
      message: 'The backup script uses this key to report each backup here.\nA new key replaces the old one, so the script must be updated with the new key.',
      okText: 'Create key',
      danger: false
    });
    if (!yes) return;
    const { data, error } = await sb.rpc('new_backup_token');
    if (error) {
      notify('error', error.code === 'PGRST202' ? 'Run the latest supabase/schema.sql in Supabase first.' : error.message, 'Could not create key');
      return;
    }
    $('#srvKey').value = data;
    $('#srvKeyBox').hidden = false;
    $('#srvKey').select();
    try {
      await navigator.clipboard.writeText(data);
      notify('success', 'Backup key copied. Paste it into BACKUP_TOKEN in the Apps Script.', 'Key created');
    } catch (e) {
      notify('info', 'Copy the key from the box, then paste it into BACKUP_TOKEN in the Apps Script.', 'Key created');
    }
  });
  $('#srvKeyCopy').addEventListener('click', async () => {
    $('#srvKey').select();
    try { await navigator.clipboard.writeText($('#srvKey').value); notify('success', 'Backup key copied.'); }
    catch (e) { notify('info', 'Press Ctrl+C to copy the selected key.'); }
  });
  settingsDialog.addEventListener('close', () => { $('#srvKeyBox').hidden = true; $('#srvKey').value = ''; });

  async function initCloud() {
    $('#storageNote').textContent = 'Data is stored online and anyone with the link can view it. Only signed-in editors and admins can change it.';
    renderSyncPill();
    sb.auth.onAuthStateChange((event, session) => {
      auth.user = session?.user || null;
      // Jangan memanggil Supabase langsung di dalam callback ini (bisa macet) → jalankan setelahnya
      setTimeout(() => {
        refreshRole();
        if (event === 'PASSWORD_RECOVERY') {
          openAccount();
          notify('info', 'Enter a new password for your account.', 'Set a new password');
        }
      }, 0);
    });
    // Cek ulang peran saat kembali ke tab (mis. baru diberi akses oleh super admin)
    window.addEventListener('focus', () => { if (auth.user) refreshRole(); });
    const ok = await runWithLoading('Loading data...', () => reloadCloud());
    sb.channel('worktrack-data')
      .on('postgres_changes', { event: '*', schema: 'public' }, scheduleReload)
      .subscribe();
    if (ok) {
      initBackup();
      offerLocalUpload();
    }
    setInterval(loadServerBackup, 30 * 60000); // cek status backup harian tiap 30 menit
  }

  /* ================= INIT ================= */
  applyAccess();
  document.body.dataset.type = ui.type;
  $$('#typeFilter button').forEach(b => b.classList.toggle('active', b.dataset.type === ui.type));
  $$('#listScope button').forEach(b => b.classList.toggle('active', b.dataset.scope === ui.scope));
  $('#showDone').checked = ui.showDone;
  fillCategoryFilter();
  renderAll();
  if (CLOUD) initCloud(); else initBackup();

  // Perbarui bubble tiap menit (meeting berikutnya), dan semua tampilan saat hari berganti
  let lastDay = todayKey();
  setInterval(() => {
    if (todayKey() !== lastDay) { lastDay = todayKey(); renderAll(); }
    else renderBubbles();
  }, 60000);
})();
