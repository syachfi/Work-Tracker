/**
 * WorkTrack → Backup HARIAN otomatis dari Supabase ke Google Drive (Google Apps Script)
 *
 * Setiap hari (default ± pukul 23.00 WIB) script ini mengambil SEMUA data WorkTrack langsung
 * dari database Supabase dan menyimpannya ke folder Google Drive Anda:
 *  - worktrack-backup.json      : file utama, selalu berisi data terbaru.
 *  - worktrack-YYYY-MM-DD.json  : salinan harian, disimpan KEEP_DAYS hari.
 * Berjalan di server Google — tidak perlu ada yang membuka website.
 * Format file sama dengan Export, jadi bisa dipulihkan lewat ⚙️ Settings → Import.
 *
 * CARA PASANG (sekali saja, ± 5 menit):
 *  1. Buat folder di Google Drive, mis. "WorkTrack Backup". Buka foldernya, salin ID dari URL:
 *       https://drive.google.com/drive/folders/<<INI_ID_FOLDERNYA>>
 *  2. Buka https://script.google.com → "New project". Hapus isi editor, tempel SELURUH file ini.
 *  3. Isi FOLDER_ID di bawah. Klik 💾 Save.
 *  4. Di toolbar pilih fungsi "pasangJadwal" → klik Run → izinkan akses
 *     (Review permissions → pilih akun → Advanced → Go to project (unsafe) → Allow).
 *     Ini wajar untuk script buatan sendiri. Backup pertama langsung dibuat saat itu juga.
 *  5. Cek folder Drive: harus ada worktrack-backup.json dan worktrack-<tanggal hari ini>.json.
 *
 * Jika backup gagal, Google otomatis mengirim email pemberitahuan ke akun Anda.
 * Untuk menghentikan: jalankan fungsi "hapusJadwal".
 */

const SUPABASE_URL = 'https://chpxkngvuhrpblcsmkyo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sVOlHCe58TaO4f5PCntMKQ_mftUZOYZ'; // publishable key (publik, hanya bisa membaca)
const FOLDER_ID = 'GANTI_DENGAN_ID_FOLDER';
const TIMEZONE = 'Asia/Jakarta';            // WIB
const JAM_BACKUP = 23;                      // jam backup harian (0–23)
const KEEP_DAYS = 30;                       // salinan harian lebih lama dari ini dipindah ke Trash
const MAIN_FILE = 'worktrack-backup.json';
const TABLES = ['categories', 'tasks', 'meetings'];

// Dijalankan otomatis setiap hari oleh jadwal
function backupHarian() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const data = {};
  TABLES.forEach(function (t) { data[t] = ambilTabel(t); });

  // Pengaman: jangan menimpa backup yang berisi data dengan data kosong
  if (!data.tasks.length && !data.meetings.length) {
    const lama = folder.getFilesByName(MAIN_FILE);
    if (lama.hasNext()) {
      const isiLama = JSON.parse(lama.next().getBlob().getDataAsString());
      if ((isiLama.tasks || []).length || (isiLama.meetings || []).length) {
        throw new Error('Database WorkTrack kosong, padahal backup sebelumnya berisi data. ' +
          'Backup TIDAK ditimpa. Cek website WorkTrack — data mungkin terhapus. ' +
          'Pulihkan lewat Settings → Import memakai file harian terakhir.');
      }
    }
  }

  const content = JSON.stringify(data, null, 2);
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  upsert(folder, MAIN_FILE, content);
  upsert(folder, 'worktrack-' + today + '.json', content);
  cleanup(folder);
  Logger.log('Backup OK: %s task, %s meeting, %s kategori → %s',
    data.tasks.length, data.meetings.length, data.categories.length, folder.getName());
}

// Ambil semua baris satu tabel (per 1000 baris)
function ambilTabel(table) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const url = SUPABASE_URL + '/rest/v1/' + table + '?select=id,data&order=id&limit=1000&offset=' + offset;
    const res = UrlFetchApp.fetch(url, { headers: { apikey: SUPABASE_KEY }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('Gagal membaca tabel ' + table + ' (HTTP ' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
    }
    const rows = JSON.parse(res.getContentText());
    rows.forEach(function (r) { out.push(Object.assign({}, r.data, { id: r.id })); });
    if (rows.length < 1000) return out;
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

// Jalankan SEKALI dari editor: memasang jadwal harian + langsung membuat backup pertama
function pasangJadwal() {
  hapusJadwal();
  ScriptApp.newTrigger('backupHarian').timeBased().everyDays(1).atHour(JAM_BACKUP).inTimezone(TIMEZONE).create();
  backupHarian();
  Logger.log('Jadwal aktif: backup setiap hari sekitar pukul %s.00 WIB.', JAM_BACKUP);
}

// Menghentikan backup harian
function hapusJadwal() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'backupHarian'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
