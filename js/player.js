// ══════════════════════════════════════════
//  QURAN PLAYER - FIXED + LATIN SUPPORT
// ══════════════════════════════════════════

class QuranPlayer {
    constructor() {
        this.audio = new Audio();
        this.ayahs = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.surahNumber = 1;
        this.surahName = '';
        this.totalAyahs = 0;
        this.currentQari = 'ar.alafasy';

        // Range
        this.fromIndex = 0;
        this.toIndex = 0;

        // Options
        this.autoScroll = true;
        this.repeat = false;
        this.continuous = true;  // ← TAMBAH BARIS INI

        // Status
        this.isLoading = false;

        // BARU: Latin data
        this.latinData = {};

        // Bind audio events
        this.audio.addEventListener('ended', () => this.onEnded());
        this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
        this.audio.addEventListener('error', (e) => this.onError(e));
        this.audio.addEventListener('waiting', () => this.onWaiting());
        this.audio.addEventListener('playing', () => this.onPlayingEvent());
        this.audio.addEventListener('canplay', () => this.onCanPlay());

        this.audio.volume = 0.8;
        this.audio.preload = 'auto';
    }

    // ═══ LOAD SURAH ═══
    async loadSurah(surahNumber, language, qari) {
        this.surahNumber = surahNumber;
        this.currentQari = qari || 'ar.alafasy';
        this.stop();

        const data = await QuranAPI.getSurahFull(surahNumber, language, qari);

        this.surahName = data.info.englishName;
        this.totalAyahs = data.info.numberOfAyahs;

        this.ayahs = data.arabic.ayahs.map((ayah, i) => {
            let audioUrl = '';
            if (data.audio && data.audio.ayahs && data.audio.ayahs[i]) {
                audioUrl = data.audio.ayahs[i].audio || '';
            }
            if (!audioUrl) {
                audioUrl = QuranAPI.getEveryAyahUrl(surahNumber, ayah.numberInSurah, this.currentQari);
            }

            return {
                number: ayah.numberInSurah,
                arabic: ayah.text,
                translation: (data.translation && data.translation.ayahs && data.translation.ayahs[i])
                    ? data.translation.ayahs[i].text
                    : '(Terjemahan tidak tersedia)',
                audioUrl: audioUrl,
                sajda: ayah.sajda || false,
                latin: '' // akan diisi setelah latin data loaded
            };
        });

        this.fromIndex = 0;
        this.toIndex = this.ayahs.length - 1;

        console.log(`✅ Loaded ${this.ayahs.length} ayahs for surah ${surahNumber}`);

        // BARU: Load latin di background
        this.loadLatinBackground();

        return {
            ayahs: this.ayahs,
            info: data.info
        };
    }

    // ═══ BARU: LOAD LATIN DI BACKGROUND ═══
    async loadLatinBackground() {
        try {
            this.latinData = await QuranAPI.getSurahTransliteration(this.surahNumber);

            // Update ayahs dengan data latin
            this.ayahs.forEach(ayah => {
                if (this.latinData[ayah.number]) {
                    ayah.latin = this.latinData[ayah.number];
                }
            });

            // Inject latin ke DOM jika sudah di-render
            this.injectLatinToDOM();

            console.log('✅ Latin data loaded & injected');
        } catch (err) {
            console.warn('⚠️ Latin data gagal:', err.message);
            this.latinData = {};
        }
    }

    // ═══ BARU: INJECT LATIN KE DOM ═══
    injectLatinToDOM() {
        this.ayahs.forEach(ayah => {
            if (!ayah.latin) return;

            const block = document.getElementById(`ayah-${ayah.number}`);
            if (!block) return;

            // Cek apakah sudah ada elemen latin
            let latinEl = block.querySelector('.ayah-latin');

            if (latinEl) {
                // Update text jika sudah ada
                latinEl.textContent = ayah.latin;
            } else {
                // Buat elemen baru
                const arabicEl = block.querySelector('.ayah-arabic');
                if (!arabicEl) return;

                latinEl = document.createElement('div');
                latinEl.className = 'ayah-latin';

                // Cek apakah user mau tampilkan latin
                const showLatin = localStorage.getItem('opt-latin') === 'true';
                if (!showLatin) {
                    latinEl.classList.add('hidden');
                }

                latinEl.textContent = ayah.latin;

                // Sisipkan setelah teks arab
                arabicEl.insertAdjacentElement('afterend', latinEl);
            }
        });
    }

    // ═══ PLAY MODES (tidak berubah) ═══
    playAll() {
        if (this.ayahs.length === 0) return;
        this.fromIndex = 0;
        this.toIndex = this.ayahs.length - 1;
        this.currentIndex = 0;
        this.isPlaying = true;
        this.playCurrentAyah();
    }

    playRange(from, to) {
        if (this.ayahs.length === 0) return;
        this.fromIndex = Math.max(0, from - 1);
        this.toIndex = Math.min(this.ayahs.length - 1, to - 1);
        this.currentIndex = this.fromIndex;
        this.isPlaying = true;
        this.playCurrentAyah();
    }

    playSingleAyah(ayahNumber) {
        this.playRange(ayahNumber, ayahNumber);
    }

    // ═══ PLAY CURRENT ═══
    playCurrentAyah() {
        if (this.currentIndex < 0 || this.currentIndex >= this.ayahs.length) {
            this.stop();
            return;
        }

        const ayah = this.ayahs[this.currentIndex];

        this.clearHighlights();
        this.highlightAyah(ayah.number);

        this.updateNowPlaying(`⏳ Memuat: ${this.surahName} ayat ${ayah.number}...`);
        this.updatePlayButton(true);

        if (this.autoScroll) {
            this.scrollToAyah(ayah.number);
        }

        this.isLoading = true;
        this.audio.src = ayah.audioUrl;

        const playPromise = this.audio.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    this.isLoading = false;
                    this.updateNowPlaying(`🔊 ${this.surahName} — Ayat ${ayah.number}`);
                })
                .catch(err => {
                    console.warn('Play gagal, coba fallback...', err.message);
                    this.tryFallbackAudio(ayah);
                });
        }
    }

    // ═══ FALLBACK AUDIO ═══
    tryFallbackAudio(ayah) {
        const fallbackUrl = QuranAPI.getEveryAyahUrl(this.surahNumber, ayah.number, this.currentQari);
        if (fallbackUrl !== this.audio.src) {
            console.log('🔄 Trying fallback audio:', fallbackUrl);
            this.audio.src = fallbackUrl;
            this.audio.play()
                .then(() => {
                    this.isLoading = false;
                    this.updateNowPlaying(`🔊 ${this.surahName} — Ayat ${ayah.number}`);
                })
                .catch(err => {
                    console.error('Fallback juga gagal:', err.message);
                    this.updateNowPlaying(`❌ Audio ayat ${ayah.number} tidak tersedia`);
                    setTimeout(() => {
                        if (this.isPlaying && this.currentIndex < this.toIndex) {
                            this.currentIndex++;
                            this.playCurrentAyah();
                        } else {
                            this.stop();
                        }
                    }, 2000);
                });
        }
    }

    // ═══ AUDIO EVENTS (tidak berubah) ═══
    onEnded() {
    const ayah = this.ayahs[this.currentIndex];
    if (ayah) this.removeHighlight(ayah.number);

    // Cek akhir range
    if (this.currentIndex >= this.toIndex) {
        if (this.repeat) {
            // Ulangi surah dari awal
            this.currentIndex = this.fromIndex;
            this.playCurrentAyah();
        } else if (this.continuous && this.surahNumber < 114) {
            // ═══ BARU: Lanjut ke surah berikutnya ═══
            this.stop();
            if (typeof goToNextSurahContinuous === 'function') {
                goToNextSurahContinuous();
            }
        } else {
            this.stop();
        }
        return;
    }

    // Next ayah
    this.currentIndex++;
    if (this.isPlaying) {
        this.playCurrentAyah();
    }
}

    onTimeUpdate() {
        if (!this.audio.duration) return;
        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        const bar = document.getElementById('progress-bar');
        if (bar) bar.style.width = `${percent}%`;
        const time = document.getElementById('player-time');
        if (time) time.textContent = this.formatTime(this.audio.currentTime);
    }

    onError(e) {
        console.warn('Audio error:', e);
        const ayah = this.ayahs[this.currentIndex];
        if (ayah && this.isPlaying) this.tryFallbackAudio(ayah);
    }

    onWaiting() {
        const ayah = this.ayahs[this.currentIndex];
        if (ayah) this.updateNowPlaying(`⏳ Buffering ayat ${ayah.number}...`);
    }

    onPlayingEvent() {
        this.isLoading = false;
        const ayah = this.ayahs[this.currentIndex];
        if (ayah) this.updateNowPlaying(`🔊 ${this.surahName} — Ayat ${ayah.number}`);
    }

    onCanPlay() {
        this.isLoading = false;
    }

    // ═══ CONTROLS (tidak berubah) ═══
    togglePlay() {
        if (this.isPlaying) this.pause();
        else this.resume();
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updatePlayButton(false);
        const ayah = this.ayahs[this.currentIndex];
        if (ayah) this.updateNowPlaying(`⏸ Dijeda: ${this.surahName} ayat ${ayah.number}`);
    }

    resume() {
        if (this.ayahs.length === 0) return;
        if (this.audio.src && this.audio.src !== window.location.href) {
            this.audio.play().catch(() => {
                this.isPlaying = true;
                this.playCurrentAyah();
            });
            this.isPlaying = true;
            this.updatePlayButton(true);
            const ayah = this.ayahs[this.currentIndex];
            if (ayah) this.highlightAyah(ayah.number);
        } else {
            this.playAll();
        }
    }

    stop() {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.isPlaying = false;
        this.isLoading = false;
        this.clearHighlights();
        this.updatePlayButton(false);
        this.updateNowPlaying('Siap diputar');
        const bar = document.getElementById('progress-bar');
        if (bar) bar.style.width = '0%';
        const time = document.getElementById('player-time');
        if (time) time.textContent = '0:00';
    }

    next() {
        if (this.currentIndex < this.toIndex) {
            this.clearHighlights();
            this.currentIndex++;
            this.isPlaying = true;
            this.playCurrentAyah();
        }
    }

    previous() {
        if (this.currentIndex > this.fromIndex) {
            this.clearHighlights();
            this.currentIndex--;
            this.isPlaying = true;
            this.playCurrentAyah();
        }
    }

    setVolume(val) {
        this.audio.volume = val / 100;
    }

    // ═══ HIGHLIGHT (tidak berubah) ═══
    highlightAyah(number) {
        const el = document.getElementById(`ayah-${number}`);
        if (el) el.classList.add('active');
    }

    removeHighlight(number) {
        const el = document.getElementById(`ayah-${number}`);
        if (el) el.classList.remove('active');
    }

    clearHighlights() {
        document.querySelectorAll('.ayah-block.active').forEach(el => el.classList.remove('active'));
    }

    scrollToAyah(number) {
        const el = document.getElementById(`ayah-${number}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ═══ UI HELPERS (tidak berubah) ═══
    updatePlayButton(playing) {
        const toggle = document.getElementById('btn-toggle-play');
        if (toggle) toggle.textContent = playing ? '⏸' : '▶';
        const main = document.getElementById('btn-play-all');
        if (main) main.textContent = playing ? '⏸ Pause' : '▶ Play Seluruh Surah';
    }

    updateNowPlaying(text) {
        const el = document.getElementById('now-playing');
        if (el) el.textContent = text;
    }

    formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}