// Koneksi ke Supabase (Dashboard → Project Settings → API / API Keys).
// - supabaseUrl     : "Project URL", mis. https://abcdefgh.supabase.co
// - supabaseAnonKey : "anon public" key atau "publishable" key (sb_publishable_...)
// Kunci ini MEMANG publik dan aman ditaruh di sini: keamanan dijaga oleh aturan RLS
// di database (supabase/schema.sql). JANGAN PERNAH menaruh "service_role" / "secret" key di sini.
// Biarkan kosong untuk memakai mode lokal (data hanya di browser ini).
window.WORKTRACK_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
