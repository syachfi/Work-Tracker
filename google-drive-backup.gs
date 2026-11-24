/**
 * WorkTrack → Google Drive backup (Google Apps Script)
 *
 * Cara kerja (setiap ada perubahan di WorkTrack, ± 10 detik kemudian):
 *  - worktrack-backup.json      : file utama, selalu berisi data terbaru.
 *  - worktrack-YYYY-MM-DD.json  : salinan harian, berisi data terakhir di hari tersebut.
 *                                 Disimpan KEEP_DAYS hari.
 *
 * CARA PASANG (sekali saja, ± 10 menit):
 *  1. Buat folder di Google Drive, mis. "WorkTrack Backup". Buka foldernya, lalu salin ID dari URL:
 *       https://drive.google.com/drive/folders/<<INI_ID_FOLDERNYA>>
 *  2. Buka https://script.google.com → "New project". Hapus isi editor, tempel SELURUH file ini.
 *  3. Isi FOLDER_ID dan TOKEN di bawah. TOKEN = kode rahasia bebas (bisa pakai tombol
 *     "Buat token" di Pengaturan WorkTrack), harus SAMA PERSIS dengan yang diisi di WorkTrack.
 *  4. Klik 💾 Save. Pilih fungsi "tesIzin" di toolbar → Run → izinkan akses (Review permissions →
 *     pilih akun → Advanced → Go to project (unsafe) → Allow). Ini wajar untuk script buatan sendiri.
 *  5. Deploy → New deployment → ⚙️ pilih "Web app":
 *       - Execute as : Me
 *       - Who has access : Anyone
 *     Klik Deploy, salin "Web app URL" (berakhiran /exec).
 *  6. Di WorkTrack: ⚙️ Pengaturan → Backup ke Google Drive → tempel URL & token → "Simpan & tes".
 *
 * Jika script ini diubah nanti: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy
 * (URL tetap sama).
 */

const FOLDER_ID = 'GANTI_DENGAN_ID_FOLDER';
const TOKEN = 'GANTI_DENGAN_KODE_RAHASIA';
const TIMEZONE = 'Asia/Jakarta';            // WIB, untuk nama file harian
const KEEP_DAYS = 30;                       // file harian lebih lama dari ini dipindah ke Trash
const MAIN_FILE = 'worktrack-backup.json';  // file utama, selalu berisi data terbaru

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) return reply({ ok: false, error: 'Token salah.' });
    const data = body.data;
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.meetings)) {
      return reply({ ok: false, error: 'Format data tidak dikenali.' });
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const content = JSON.stringify(data, null, 2);
    const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    upsert(folder, MAIN_FILE, content);
    upsert(folder, 'worktrack-' + today + '.json', content);
    cleanup(folder);

    return reply({ ok: true, savedAt: new Date().toISOString(), tasks: data.tasks.length, meetings: data.meetings.length });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e) { /* abaikan */ }
  }
}

// Dipakai tombol "Simpan & tes" untuk mengecek token & folder tanpa mengubah file apa pun
function doGet(e) {
  try {
    if ((e.parameter || {}).token !== TOKEN) return reply({ ok: false, error: 'Token salah.' });
    return reply({ ok: true, folder: DriveApp.getFolderById(FOLDER_ID).getName() });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function upsert(folder, name, content) {
  const files = folder.getFilesByName(name);
  if (files.hasNext()) files.next().setContent(content);
  else folder.createFile(name, content, 'application/json');
}

function cleanup(folder) {
  const limit = new Date();
  limit.setDate(limit.getDate() - KEEP_DAYS);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const m = f.getName().match(/^worktrack-(\d{4})-(\d{2})-(\d{2})\.json$/);
    if (m && new Date(+m[1], +m[2] - 1, +m[3]) < limit) f.setTrashed(true);
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Jalankan sekali dari editor untuk memberi izin akses Drive
function tesIzin() {
  Logger.log('Folder OK: ' + DriveApp.getFolderById(FOLDER_ID).getName());
}
