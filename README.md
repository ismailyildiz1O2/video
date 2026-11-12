# Cinecode Studio

[cinecode](https://github.com/sarpstar/cinecode) için masaüstü uygulaması. Fikrini yazarsın, Claude senaryoyu yazar, her kareyi kodla kurar, sesi tasarlar ve sana bir MP4 verir. Terminal, VS Code ya da Claude Code bilmen gerekmez.

## Ne yapar?

- **Film projeleri:** Her film kendi klasöründe durur (varsayılan: `Belgeler/Cinecode Filmleri`). Sohbet ve ajan oturumu kaydedilir; uygulamayı kapatıp açınca kaldığın yerden devam edersin.
- **Sohbet + soru kartları:** cinecode'un soruları (mod, amaç, görünüm, ses…) tıklanabilir kartlar olarak gelir. ★ önerilen seçeneklerdir. "Diğer" kutusuna kendi cevabını da yazabilirsin.
- **İzinler:** Varsayılan olarak ajan komutları onay beklemeden çalıştırır (Ayarlar > "İzin sormadan devam et"). Bu kapatılırsa her komut için izin kartı çıkar; "Bu oturumda tüm komutlara izin ver" ile tekrar tekrar sorulmaz.
- **Önizleme paneli:** Projedeki taslaklar, kareler ve ses dosyaları sağ panelde listelenir. Yeni bir video oluşunca kendiliğinden oynatılır.
- **cinecode kiti otomatik kurulur:** İlk açılışta GitHub'dan indirilir (git gerekmez) ve `~/.claude/skills/cinecode` klasörüne konur. Açılışta güncellenir. Kiti daha önce elle kurduysan o kopya kullanılır ve uygulama ona dokunmaz.
- **Eksik araçlar kendiliğinden kurulur:** Python, ffmpeg ve Node.js yoksa uygulama bunların taşınabilir sürümlerini kendi klasörüne indirir (Windows ve Linux'ta üçü de; macOS'ta Python ve Node.js). Bilgisayara sistem geneli bir şey yüklenmez. Chrome yerine Windows'taki Edge de kullanılabilir.

## Mimari

```
Electron ana süreci (src/main)
 ├─ session.mjs       Claude Agent SDK: query() + cinecode skill'i, proje klasöründe çalışır
 │                    canUseTool → soru ve izin kartlarını arayüze iletir, cevabı bekler
 ├─ skill.mjs         cinecode'u GitHub tarball'undan kurar/günceller
 ├─ projects.mjs      film klasörleri, sohbet geçmişi, medya listesi
 ├─ requirements.mjs  node / python / ffmpeg / chrome denetimi
 ├─ settings.mjs      model, effort, klasör; API anahtarı safeStorage ile şifreli
 └─ main.mjs          pencere, IPC, film:// protokolü (sadece projeler klasöründen dosya sunar)
src/preload.cjs       arayüze açılan dar, güvenli köprü (contextIsolation + sandbox)
src/renderer          HTML/CSS/JS arayüz (framework yok)
```

Filmi üreten şey Claude'dur: uygulama Claude Agent SDK ile Claude Code'un ajan döngüsünü ve araçlarını (Bash, dosya okuma/yazma, web arama) çalıştırır. cinecode'un betikleri (kare yakalama, miks, −14 LUFS mastering) senin bilgisayarında çalışır.

## Gereksinimler

- Bir **Anthropic API anahtarı** ([console.anthropic.com](https://console.anthropic.com/settings/keys)). Kullanım ücreti API hesabına yazılır. Kısa bir film bile çok sayıda ajan adımı demektir; maliyet her turun sonunda gösterilir.
- Chrome, Chromium ya da Edge ve tarayıcının kullanabildiği bir GPU. Python, ffmpeg ve Node.js'i uygulama kendisi kurar.

## Geliştirme

```bash
npm install
```

```bash
npm start
```

```bash
npm run check
```

`npm run check`, sözdizimi denetimi ve Electron gerektirmeyen hızlı testleri çalıştırır.

## Paketleme

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

Her platformun paketi kendi işletim sisteminde üretilmelidir: Claude Agent SDK, platforma özel bir ikili (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`) kullanır. Bu ikili `asarUnpack` ile arşivin dışında tutulur. macOS'ta dağıtım için imzalama ve notarization gerekir (electron-builder belgelerine bakın).

## Ayarlar

| Ayar | Varsayılan | Not |
|---|---|---|
| Model | Claude Opus 5.5 | Sonnet 5.5 daha ucuzdur; Fable 5.1 en güçlü ve en pahalısıdır |
| Çaba (effort) | high | `xhigh`/`max` daha derin ama daha pahalı |
| Filmler klasörü | `~/Documents/Cinecode Filmleri` | |
| cinecode otomatik güncelleme | açık | |

## Lisans

MIT. cinecode kiti Sarp Yıldız'ındır (MIT) ve uygulamayla birlikte dağıtılmaz; çalışma anında GitHub'dan indirilir. Ayrıntılar: [NOTICE.md](NOTICE.md).
