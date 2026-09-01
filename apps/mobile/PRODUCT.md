# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

Pemilik akun (developer, MuhWldns) dan teman-temannya yang dibagikan aksesnya. Pengguna Android, sudah paham konsep dasar (login YouTube via cookie, proxy pribadi), tetapi bukan developer — perlu settings yang jelas untuk paste cookie/proxy URL.

## Product Purpose

Sonora Music: client YouTube Music pribadi dengan UI custom. Memutar musik YouTube Music lewat proxy InnerTube milik sendiri, dengan queue/radio, library, dan liked songs dari akun masing-masing. Sukses = mendengarkan musik full tanpa hambatan dari HP Android.

## Positioning

Proxy InnerTube portable milik sendiri (VPS pribadi via Docker) + app native Android ringan. Tidak ada iklan, tidak ada tracking, akun tetap milik pengguna (cookie per-device, server stateless).

## Operating Context

- Proxy URL dikonfigurasi melalui `EXPO_PUBLIC_PROXY_BASE` saat build atau lewat Settings; jangan commit URL deployment pribadi
- Audio playback lewat /stream (relay proxy, IP-safe); /player disimpan untuk optimasi future
- Cookie YouTube dikirim per-request header x-yt-cookie, disimpan di Android Keychain per device
- Tanpa cookie: search + home anonim tetap jalan; library/liked butuh cookie

## Capabilities and Constraints

- Search (song/album/artist/playlist), home feed, radio queue (/next), playback, library & liked (cookie)
- Expo SDK 57 (RN 0.86, React 19), react-native-track-player, react-native-keychain
- Playback via /stream terbukti jalan (206 Partial Content, seek OK) — PoC app-side track-player masih perlu diverifikasi di device
- Belum ada: player screen dengan controls, search screen, settings screen, library screen

## Brand Commitments

Standing preference (user-confirmed): visual language mengikuti konvensi streaming app modern ala Spotify/YouTube Music — familiar, bukan eksperimen identitas. Bar kerajinan: level craft Spotify. Eksekusi canon full-fidelity di atas struktur Material 3 Android, dengan identitas Sonora lewat theming (warna, shape, motion), bukan lewat penemuan komponen baru.

## Evidence on Hand

- Proxy produksi live dan terverifikasi (healthz, search, home, next, player, stream dengan Range)
- App scaffold Expo berjalan, HomeScreen placeholder aktif
- Repo: github.com/MuhWldns/Sonora-Online-Music-Player

## Product Principles

1. Musik dulu: apapun yang menghalangi play/pause/next adalah bug prioritas satu
2. Server stateless, credentials tidak pernah keluar dari device pengguna kecuali per-request ke proxy sendiri
3. UI harus bisa dipakai teman non-developer tanpa penjelasan: settings cookie/proxy jelas dan ada feedback status
4. Playback offline-toleran: gagal fetch radio queue tidak boleh menghentikan lagu yang sedang main
5. Satu kode, dua realitas: anonymous (tanpa cookie) tetap fungsional, bukan error state

## Accessibility & Inclusion

Belum ada requirement spesifik; target pengguna Indonesia, mungkin perlu dukungan teks berukuran cukup untuk dibaca santai (konteks: memutar musik sambil berkendara/olahraga — kontrol besar dan kontras tinggi).
