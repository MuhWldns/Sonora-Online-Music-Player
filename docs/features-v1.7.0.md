# Rencana Fitur Sonora Music 1.7.0

Dokumen ini menetapkan scope tujuh fitur untuk rilis 1.7.0. Implementasi harus mengikuti arsitektur Sonora saat ini: proxy tetap stateless, cookie akun hanya diteruskan per request, dan playback aktif tetap dimiliki native Media3.

## 1. Like dan Unlike Lagu

- Pengguna dapat menyukai atau membatalkan suka dari setiap baris lagu dan full player.
- Status suka berasal dari akun YouTube Music dan tetap konsisten di seluruh layar.
- Perubahan tampil optimistis, tetapi dikembalikan jika mutation upstream gagal.
- Daftar Library otomatis diperbarui setelah perubahan berhasil.
- Tidak boleh ada request status otomatis per baris yang menyebabkan N+1 request.
- Keadaan tanpa cookie, loading, dan error harus jelas serta dapat diakses screen reader.

### Kriteria selesai

- Status tetap benar setelah navigasi dan reload.
- Gagal mutation mengembalikan UI ke status sebelumnya.
- Semua route akun tetap stateless dan tidak menyimpan cookie atau hasil mutation.

## 2. Editor Playlist Milik Pengguna

- Playlist milik pengguna dapat diubah namanya, dihapus, dan diatur ulang urutan lagunya.
- Lagu dapat ditambahkan ke playlist milik pengguna dari aksi lagu.
- Lagu dapat dihapus dari playlist milik pengguna.
- Kontrol edit hanya muncul ketika metadata upstream membuktikan playlist tersebut milik pengguna dan dapat diedit.
- Rename dibatasi maksimal 150 karakter.
- Delete memakai konfirmasi destruktif.
- Mutation memakai identifier item playlist resmi dari upstream dan diikuti refresh data otoritatif.
- Mengedit playlist tidak boleh merusak antrean playback yang sedang aktif.

### Kriteria selesai

- Rename, delete, add, remove, dan reorder bekerja dengan payload InnerTube yang tepat.
- Playlist yang bukan milik pengguna tidak pernah menampilkan kontrol mutation.
- Kontrol dinonaktifkan saat request berjalan; kegagalan melakukan rollback atau reload aman.

## 3. Sleep Timer Native

- Pilihan timer: 15, 30, 45, atau 60 menit.
- Pilihan tambahan: berhenti setelah lagu yang sedang diputar selesai.
- Timer dapat diganti atau dibatalkan.
- Sisa waktu dan mode timer tampil di full player.
- Media3 playback service memiliki timer; JavaScript hanya menampilkan state.

### Kriteria selesai

- Timer tetap berjalan ketika aplikasi berada di background.
- Playback dijeda tepat sekali saat deadline atau batas akhir lagu tercapai.
- Timer lama tidak boleh menjeda sesi baru setelah timer diganti atau dibatalkan.

## 4. Pemulihan Sesi Playback

- Simpan queue logis, indeks lagu aktif, posisi, shuffle, dan repeat.
- URL stream yang dapat kedaluwarsa tidak disimpan.
- Saat cold start, URL stream dibuat ulang sebelum queue dipulihkan ke native player.
- Sesi yang dipulihkan selalu berada dalam keadaan pause; tidak boleh autoplay.
- Snapshot rusak atau versi lama ditangani tanpa membuat aplikasi tidak dapat digunakan.
- Memulai playback baru menggantikan sesi hasil restore secara bersih.

### Kriteria selesai

- Queue, lagu aktif, posisi, shuffle, dan repeat pulih setelah process death.
- Restore tidak autoplay dan tidak memicu radio/recommendation seed baru.
- Indeks queue native dan JavaScript tetap identik.

## 5. Offset Sinkronisasi Lirik per Lagu

- Offset disimpan lokal per `videoId` dalam rentang -5 hingga +5 detik.
- Perubahan memakai langkah waktu yang konsisten dan menyediakan tombol reset.
- Nilai nol menghapus entry penyimpanan.
- Offset positif memajukan lirik terhadap audio.
- Preview, baris aktif, nomor posisi, centering, dan seek dari baris lirik memakai model offset yang sama.
- Lirik tanpa timestamp tidak menggunakan offset dan tidak menampilkan kontrol aktif.

### Kriteria selesai

- Offset tetap tersimpan per lagu dan tidak bocor saat pergantian track.
- Data penyimpanan rusak diabaikan dengan aman.
- Tidak ada operasi storage pada setiap tick playback.
- Mengetuk baris lirik melakukan inverse seek yang sesuai dengan offset.

## 6. Statistik Mendengarkan Lokal

- Statistik tersedia untuk rentang 7, 30, dan 365 hari.
- Tampilkan total waktu dengar, lagu teratas, dan artis teratas.
- Plays atau completions hanya ditampilkan jika event tersebut benar-benar diukur.
- Waktu hanya dihitung ketika audio benar-benar berstatus playing.
- Delta mencurigakan dibatasi, event status duplikat tidak dihitung ganda, dan durasi yang melewati tengah malam dibagi ke tanggal lokal yang benar.
- Data disimpan lokal dengan retensi terbatas; tidak dikirim ke proxy atau server.
- Pengguna dapat reset dengan konfirmasi dan mengekspor statistik melalui React Native Share.

### Kriteria selesai

- Pause, pergantian track, event duplikat, dan batas hari menghasilkan agregasi deterministik.
- Ranking memiliki aturan tie yang stabil.
- Reset dan ekspor hanya menyentuh data statistik lokal.

## 7. Pencarian Lebih Cepat

- Search suggestions dari YouTube Music tersedia melalui proxy portable.
- Input memakai debounce dan membatalkan atau mengabaikan response request lama.
- Kegagalan jaringan suggestions tetap senyap; kandidat lokal tetap dapat digunakan.
- Riwayat pencarian dapat dipin atau dilepas pin.
- Clear biasa mempertahankan item pin; clear seluruhnya termasuk pin harus merupakan aksi eksplisit.
- Filter pencarian terakhir dipersist dan dipulihkan.
- Aksi lagu menyediakan shortcut mencari artis atau album dengan query dan filter yang sesuai.
- Riwayat hanya dicatat setelah pencarian benar-benar disubmit, bukan setiap ketikan.

### Kriteria selesai

- Response suggestions yang stale tidak pernah mengganti hasil query terbaru.
- Pin dan filter terakhir bertahan setelah relaunch.
- Shortcut artis/album membuka Search dengan query dan filter yang benar.
- Cache suggestion dibatasi, dipisahkan berdasarkan scope akun, dan tidak pernah mengekspos cookie.

## Persyaratan Bersama

- Dark/light theme, ukuran font besar, Reduce Motion, touch target minimum, serta label dan state aksesibilitas harus tetap benar.
- Tidak ada credential, cookie, URL deployment privat, APK, atau file environment yang masuk commit.
- Proxy `src/` hanya menggunakan Web Standard API; integrasi Node-only tetap berada di `packages/proxy/server/`.
- Perubahan native, proxy, mobile, test, dan dokumentasi harus terintegrasi tanpa compatibility shim atau implementasi sementara.
- Verifikasi akhir mencakup test proxy/mobile, typecheck, Worker bundle dry-run, build APK, dan smoke Android untuk seluruh alur baru.
