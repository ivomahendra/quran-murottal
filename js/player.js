// ══════════════════════════════════════════
//  QURAN PLAYER - WORD-BY-WORD HIGHLIGHT
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

        this.fromIndex = 0;
        this.toIndex = 0;

        this.autoScroll = true;
        this.repeat = false;
        this.isLoading = false;

        // ═══ WORD HIGHLIGHT DATA ═══
        this.wordData = {};           // word data per ayah
        this.highlightTimer = null;   // requestAnimationFrame ID
        this.currentWordIndex = -1;   // current highlighted word

        // Audio events
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
                sajda: ayah.sajda || false
            };
        });

        this.fromIndex = 0;
        this.toIndex = this.ayahs.length - 1;

        // Load word data di background (tidak blocking render)
        this.loadWordDataBackground();

        return { ayahs: this.ayahs, info: data.info };
    }

    // ═══ LOAD WORD TIMINGS DI BACKGROUND ═══
    async loadWordDataBackground() {
        try {
            console.log('📝 Loading word timing data...');
            this.wordData = await QuranAPI.getSurahWordData(
                this.surahNumber,
                this.totalAyahs,
                this.currentQari
            );
            console.log('✅ Word timing data ready!');

            // Re-render ayahs dengan word spans jika sudah ada di DOM
            this.injectWordSpans();
        } catch (err) {
            console.warn('Word timing data gagal dimuat, fallback ke highlight per-ayat:', err.message);
            this.wordData = {};
        }
    }

    // ═══ INJECT WORD SPANS KE DOM ═══
    injectWordSpans() {
        this.ayahs.forEach(ayah => {
            const data = this.wordData[ayah.number];
            if (!data || !data.words) return;

            const arabicEl = document.querySelector(`#ayah-${ayah.number} .ayah-arabic`);
            if (!arabicEl) return;
            if (arabicEl.dataset.wordified === 'true') return; // sudah di-inject

            // Buat word spans
            const words = data.words;
            let html = '';

            words.forEach((word, idx) => {
                html += `<span class="quran-word" data-word-idx="${idx}" data-ayah="${ayah.number}">${word.text}</span> `;
            });

            // Tambahkan end mark
            html += `<span class="ayah-end-mark">﴿${toArabicNumber(ayah.number)}﴾</span>`;

            arabicEl.innerHTML = html;
            arabicEl.dataset.wordified = 'true';
        });
    }

    // ═══ PLAY MODES ═══
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

    // ═══ PLAY CURRENT AYAH ═══
    playCurrentAyah() {
        if (this.currentIndex < 0 || this.currentIndex >= this.ayahs.length) {
            this.stop();
            return;
        }

        const ayah = this.ayahs[this.currentIndex];

        // Clear all highlights
        this.clearHighlights();
        this.clearWordHighlights();

        // Highlight ayah block
        this.highlightAyah(ayah.number);

        // Info
        this.updateNowPlaying(`⏳ Memuat: ${this.surahName} ayat ${ayah.number}...`);
        this.updatePlayButton(true);

        // Scroll
        if (this.autoScroll) this.scrollToAyah(ayah.number);

        // Reset word tracking
        this.currentWordIndex = -1;

        // Play audio
        this.isLoading = true;
        this.audio.src = ayah.audioUrl;

        const playPromise = this.audio.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    this.isLoading = false;
                    this.updateNowPlaying(`🔊 ${this.surahName} — Ayat ${ayah.number}`);
                    // Mulai word highlight tracking
                    this.startWordHighlightLoop();
                })
                .catch(err => {
                    console.warn('Play gagal:', err.message);
                    this.tryFallbackAudio(ayah);
                });
        }
    }

    // ══════════════════════════════════════
    //  WORD-BY-WORD HIGHLIGHT ENGINE
    // ══════════════════════════════════════

    startWordHighlightLoop() {
        // Cancel previous loop
        this.stopWordHighlightLoop();

        const ayah = this.ayahs[this.currentIndex];
        if (!ayah) return;

        const data = this.wordData[ayah.number];

        // Jika ada timing data dari API → gunakan precise timing
        if (data && data.timings && data.timings.length > 0) {
            this.runPreciseWordHighlight(ayah.number, data.timings);
        }
        // Jika ada words tapi tanpa timing → estimasi timing
        else if (data && data.words && data.words.length > 0) {
            this.runEstimatedWordHighlight(ayah.number, data.words.length);
        }
        // Tidak ada data word → highlight per ayat saja (sudah jalan)
    }

    // ═══ PRECISE WORD HIGHLIGHT (dengan timing dari API) ═══
    runPreciseWordHighlight(ayahNumber, timings) {
        const loop = () => {
            if (!this.isPlaying || this.audio.paused) return;

            const currentTime = this.audio.currentTime;
            let activeIdx = -1;

            // Cari kata yang sedang aktif berdasarkan currentTime
            for (let i = 0; i < timings.length; i++) {
                if (currentTime >= timings[i].start && currentTime < timings[i].end) {
                    activeIdx = timings[i].wordIndex;
                    break;
                }
            }

            // Update highlight hanya jika berubah
            if (activeIdx !== this.currentWordIndex) {
                this.currentWordIndex = activeIdx;
                this.applyWordHighlight(ayahNumber, activeIdx);
            }

            this.highlightTimer = requestAnimationFrame(loop);
        };

        this.highlightTimer = requestAnimationFrame(loop);
    }

    // ═══ ESTIMATED WORD HIGHLIGHT (tanpa timing API) ═══
    runEstimatedWordHighlight(ayahNumber, wordCount) {
        // Tunggu sampai duration tersedia
        const waitForDuration = () => {
            if (this.audio.duration && this.audio.duration > 0) {
                this.doEstimatedHighlight(ayahNumber, wordCount);
            } else {
                // Retry
                if (this.isPlaying) {
                    setTimeout(waitForDuration, 100);
                }
            }
        };
        waitForDuration();
    }

    doEstimatedHighlight(ayahNumber, wordCount) {
        if (wordCount === 0) return;

        // Estimasi: bagi durasi rata ke semua kata
        // Tapi berikan weight lebih ke kata panjang
        const words = this.wordData[ayahNumber]?.words || [];
        let weights = words.map(w => Math.max(1, w.text.length));
        const totalWeight = weights.reduce((a, b) => a + b, 0);

        const duration = this.audio.duration;
        let cumulative = 0;
        const wordTimings = words.map((w, i) => {
            const start = cumulative;
            const wordDuration = (weights[i] / totalWeight) * duration;
            cumulative += wordDuration;
            return { wordIndex: i, start: start, end: cumulative };
        });

        // Gunakan precise highlight dengan timing estimasi
        this.runPreciseWordHighlight(ayahNumber, wordTimings);
    }

    // ═══ APPLY HIGHLIGHT KE DOM ═══
    applyWordHighlight(ayahNumber, activeWordIdx) {
        const ayahEl = document.getElementById(`ayah-${ayahNumber}`);
        if (!ayahEl) return;

        const wordSpans = ayahEl.querySelectorAll('.quran-word');

        wordSpans.forEach((span, idx) => {
            if (idx === activeWordIdx) {
                span.classList.add('word-active');
            } else {
                // Kata yang sudah dilewati
                if (activeWordIdx >= 0 && idx < activeWordIdx) {
                    span.classList.remove('word-active');
                    span.classList.add('word-passed');
                } else {
                    span.classList.remove('word-active');
                    span.classList.remove('word-passed');
                }
            }
        });
    }

    stopWordHighlightLoop() {
        if (this.highlightTimer) {
            cancelAnimationFrame(this.highlightTimer);
            this.highlightTimer = null;
        }
    }

    clearWordHighlights() {
        this.stopWordHighlightLoop();
        this.currentWordIndex = -1;
        document.querySelectorAll('.quran-word.word-active').forEach(el => {
            el.classList.remove('word-active');
        });
        document.querySelectorAll('.quran-word.word-passed').forEach(el => {
            el.classList.remove('word-passed');
        });
    }

    // ═══ FALLBACK AUDIO ═══
    tryFallbackAudio(ayah) {
        const fallbackUrl = QuranAPI.getEveryAyahUrl(this.surahNumber, ayah.number, this.currentQari);
        if (fallbackUrl !== this.audio.src) {
            this.audio.src = fallbackUrl;
            this.audio.play()
                .then(() => {
                    this.isLoading = false;
                    this.updateNowPlaying(`🔊 ${this.surahName} — Ayat ${ayah.number}`);
                    this.startWordHighlightLoop();
                })
                .catch(() => {
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

    // ═══ AUDIO EVENTS ═══
    onEnded() {
        this.clearWordHighlights();
        const ayah = this.ayahs[this.currentIndex];
        if (ayah) this.removeHighlight(ayah.number);

        if (this.currentIndex >= this.toIndex) {
            if (this.repeat) {
                this.currentIndex = this.fromIndex;
                this.playCurrentAyah();
            } else {
                this.stop();
            }
            return;
        }

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

    // ═══ CONTROLS ═══
    togglePlay() {
        if (this.isPlaying) this.pause();
        else this.resume();
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.stopWordHighlightLoop();
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
            if (ayah) {
                this.highlightAyah(ayah.number);
                this.startWordHighlightLoop();
            }
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
        this.clearWordHighlights();
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
            this.clearWordHighlights();
            this.currentIndex++;
            this.isPlaying = true;
            this.playCurrentAyah();
        }
    }

    previous() {
        if (this.currentIndex > this.fromIndex) {
            this.clearHighlights();
            this.clearWordHighlights();
            this.currentIndex--;
            this.isPlaying = true;
            this.playCurrentAyah();
        }
    }

    setVolume(val) {
        this.audio.volume = val / 100;
    }

    // ═══ AYAH-LEVEL HIGHLIGHT ═══
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

    // ═══ UI ═══
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