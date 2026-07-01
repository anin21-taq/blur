# Gesture Vision — Hand Gesture Detection Website

Website statis (HTML/CSS/JS murni, tanpa backend) yang mendeteksi gerakan
tangan secara real-time dari webcam menggunakan **MediaPipe Hands**, lalu
memicu efek blur sinematik + flash + audio saat tangan diangkat ke atas.

## Cara menjalankan

Browser memblokir akses kamera dari file `file://` biasa, jadi jalankan lewat
local server, misalnya:

```bash
cd project
python3 -m http.server 8000
# lalu buka http://localhost:8000
```

Atau pakai ekstensi "Live Server" di VS Code.

## Struktur

```
project/
├── index.html          # markup + permission screen + HUD
├── css/style.css        # glassmorphism, blur transition, responsive
├── js/
│   ├── handDetection.js # wrapper MediaPipe Hands (deteksi landmark)
│   └── app.js            # state machine gesture, blur/flash/audio, HUD
├── assets/audio/blur.mp3 # sound effect (placeholder — ganti sesuai selera)
└── libs/                 # (kosong) MediaPipe dimuat via CDN di index.html
```

> **Catatan tentang `blur.mp3`**: file yang disertakan adalah placeholder
> hasil sintesis (whoosh pendek), bukan aset final. Ganti saja file
> `assets/audio/blur.mp3` dengan sound effect pilihanmu — nama file dan path
> sudah sesuai kode, jadi tinggal timpa filenya.

## Cara kerja gesture

1. `handDetection.js` mengirim setiap frame video ke model MediaPipe Hands
   dan mengembalikan 21 titik landmark tangan.
2. `app.js` memakai landmark **#9 (pangkal jari tengah / palm center)**
   sebagai titik acuan tinggi tangan, dihaluskan dengan *exponential moving
   average* supaya tidak jitter.
3. State machine dengan **hysteresis** dua ambang:
   - `RAISE_THRESHOLD = 0.38` → tangan dianggap "terangkat" saat y makin kecil dari ini (dekat atas frame).
   - `LOWER_THRESHOLD = 0.46` → tangan dianggap "turun" saat y melewati ini.
   - Celah antara dua angka ini mencegah efek "kedip-kedip" saat tangan pas di garis batas.
4. Saat transisi naik: flash putih (~0.35s) → jeda singkat → blur aktif
   (CSS `filter: blur(18px)` dengan transisi 450ms) → glow tipis cyan di
   tepi frame → audio diputar (kecuali masih dalam cooldown 2 detik).
5. Saat transisi turun: blur & glow memudar, tidak ada suara.

## Menyesuaikan sensitivitas

Semua konstanta ada di bagian atas `js/app.js`:

```js
const RAISE_THRESHOLD = 0.38; // makin kecil = harus angkat tangan lebih tinggi
const LOWER_THRESHOLD = 0.46; // makin besar = lebih toleran sebelum dianggap turun
const AUDIO_COOLDOWN_MS = 2000;
```

## Kebutuhan browser

- Butuh HTTPS atau `localhost` untuk `getUserMedia`.
- Audio hanya diputar setelah tombol "Aktifkan Kamera" ditekan (user gesture),
  sesuai kebijakan autoplay browser modern.
