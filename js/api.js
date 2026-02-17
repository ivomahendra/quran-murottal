// ══════════════════════════════════════════
//  API HANDLER - WITH WORD TIMING
// ══════════════════════════════════════════

const QuranAPI = {
    BASE: 'https://api.alquran.cloud/v1',
    QURAN_COM_BASE: 'https://api.quran.com/api/v4',

    // Mapping qari ke reciter_id di quran.com
    RECITER_MAP: {
        'ar.alafasy': 7,
        'ar.abdulbasit': 1,
        'ar.husary': 6,
        'ar.minshawi': 9,
        'ar.abdurrahmaansudais': 10
    },

    // ═══ CACHE SYSTEM ═══
    cache: {
        set(key, data) {
            try {
                localStorage.setItem(`q_${key}`, JSON.stringify({
                    d: data,
                    t: Date.now()
                }));
            } catch (e) {
                this.cleanup();
                try {
                    localStorage.setItem(`q_${key}`, JSON.stringify({
                        d: data,
                        t: Date.now()
                    }));
                } catch (e2) {
                    console.warn('Cache penuh');
                }
            }
        },

        get(key, maxAge = 86400000) {
            try {
                const raw = localStorage.getItem(`q_${key}`);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (Date.now() - parsed.t > maxAge) {
                    localStorage.removeItem(`q_${key}`);
                    return null;
                }
                return parsed.d;
            } catch {
                return null;
            }
        },

        cleanup() {
            Object.keys(localStorage)
                .filter(k => k.startsWith('q_'))
                .forEach(k => localStorage.removeItem(k));
        }
    },

    // ═══ FETCH WITH TIMEOUT & RETRY ═══
    async fetchWithTimeout(url, timeout = 15000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    },

    async fetchData(endpoint, cacheKey, retries = 2) {
        if (cacheKey) {
            const cached = this.cache.get(cacheKey);
            if (cached) {
                console.log(`✅ Cache hit: ${cacheKey}`);
                return cached;
            }
        }

        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const json = await this.fetchWithTimeout(
                    `${this.BASE}${endpoint}`,
                    attempt === 0 ? 15000 : 20000
                );
                if (json.code === 200 && json.data) {
                    if (cacheKey) this.cache.set(cacheKey, json.data);
                    return json.data;
                }
                throw new Error(json.status || 'Data tidak valid');
            } catch (err) {
                lastError = err;
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        throw lastError;
    },

    // ═══ DAFTAR SURAH ═══
    async getSurahList() {
        return this.fetchData('/surah', 'list');
    },

    // ═══ DATA SURAH LENGKAP ═══
    async getSurahFull(surahNumber, language = 'id.indonesian', qari = 'ar.alafasy') {
        const cacheKey = `full_${surahNumber}_${language}_${qari}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const [arabicResult, transResult, audioResult] = await Promise.allSettled([
            this.fetchData(`/surah/${surahNumber}/quran-uthmani`, `ar_${surahNumber}`),
            this.fetchData(`/surah/${surahNumber}/${language}`, `tr_${surahNumber}_${language}`),
            this.fetchData(`/surah/${surahNumber}/${qari}`, `au_${surahNumber}_${qari}`)
        ]);

        if (arabicResult.status === 'rejected') {
            throw new Error('Gagal memuat teks Al-Quran');
        }

        const arabic = arabicResult.value;
        const translation = transResult.status === 'fulfilled' ? transResult.value : null;
        const audio = audioResult.status === 'fulfilled' ? audioResult.value : null;

        const result = {
            arabic, translation, audio,
            info: {
                number: arabic.number,
                name: arabic.name,
                englishName: arabic.englishName,
                englishNameTranslation: arabic.englishNameTranslation,
                revelationType: arabic.revelationType,
                numberOfAyahs: arabic.numberOfAyahs
            }
        };

        this.cache.set(cacheKey, result);
        return result;
    },

    // ═══ WORD-BY-WORD DATA DARI QURAN.COM ═══
    async getWordsForAyah(surahNumber, ayahNumber) {
        const cacheKey = `words_${surahNumber}_${ayahNumber}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const url = `${this.QURAN_COM_BASE}/verses/by_key/${surahNumber}:${ayahNumber}?language=id&words=true&word_fields=text_uthmani,text_indopak&fields=text_uthmani`;
            const json = await this.fetchWithTimeout(url, 10000);

            if (json.verse && json.verse.words) {
                const words = json.verse.words
                    .filter(w => w.char_type_name === 'word') // exclude end marker
                    .map(w => ({
                        text: w.text_uthmani || w.text,
                        translation: w.translation ? w.translation.text : '',
                        transliteration: w.transliteration ? w.transliteration.text : ''
                    }));
                this.cache.set(cacheKey, words);
                return words;
            }
            return null;
        } catch (err) {
            console.warn(`Words API gagal untuk ${surahNumber}:${ayahNumber}:`, err.message);
            return null;
        }
    },

    // ═══ WORD TIMING DARI QURAN.COM ═══
    async getWordTimings(surahNumber, ayahNumber, qari = 'ar.alafasy') {
        const reciterId = this.RECITER_MAP[qari] || 7;
        const cacheKey = `timing_${surahNumber}_${ayahNumber}_${reciterId}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const url = `${this.QURAN_COM_BASE}/recitations/${reciterId}/by_ayah/${surahNumber}:${ayahNumber}`;
            const json = await this.fetchWithTimeout(url, 10000);

            if (json.audio_files && json.audio_files.length > 0) {
                const audioFile = json.audio_files[0];
                if (audioFile.segments) {
                    // segments format: [[wordIndex, startMs, endMs], ...]
                    const timings = audioFile.segments.map(seg => ({
                        wordIndex: seg[0],
                        start: seg[1] / 1000, // convert to seconds
                        end: seg[2] / 1000
                    }));
                    this.cache.set(cacheKey, timings);
                    return timings;
                }
            }
            return null;
        } catch (err) {
            console.warn(`Timing API gagal untuk ${surahNumber}:${ayahNumber}:`, err.message);
            return null;
        }
    },

    // ═══ BATCH LOAD WORDS + TIMINGS UNTUK SELURUH SURAH ═══
    async getSurahWordData(surahNumber, totalAyahs, qari = 'ar.alafasy') {
        const cacheKey = `surahwords_${surahNumber}_${qari}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        console.log(`📝 Loading word data for surah ${surahNumber}...`);

        const results = {};
        // Load dalam batch kecil agar tidak overload
        const batchSize = 10;

        for (let i = 1; i <= totalAyahs; i += batchSize) {
            const batch = [];
            for (let j = i; j < Math.min(i + batchSize, totalAyahs + 1); j++) {
                batch.push(
                    Promise.allSettled([
                        this.getWordsForAyah(surahNumber, j),
                        this.getWordTimings(surahNumber, j, qari)
                    ]).then(([wordsRes, timingRes]) => ({
                        ayah: j,
                        words: wordsRes.status === 'fulfilled' ? wordsRes.value : null,
                        timings: timingRes.status === 'fulfilled' ? timingRes.value : null
                    }))
                );
            }

            const batchResults = await Promise.all(batch);
            batchResults.forEach(r => {
                results[r.ayah] = { words: r.words, timings: r.timings };
            });
        }

        this.cache.set(cacheKey, results);
        console.log(`✅ Word data loaded for surah ${surahNumber}`);
        return results;
    },

    // ═══ FALLBACK AUDIO ═══
    getEveryAyahUrl(surahNumber, ayahNumber, qari = 'ar.alafasy') {
        const qariMap = {
            'ar.alafasy': 'Alafasy_128kbps',
            'ar.abdulbasit': 'Abdul_Basit_Murattal_192kbps',
            'ar.husary': 'Husary_128kbps',
            'ar.minshawi': 'Minshawy_Murattal_128kbps',
            'ar.abdurrahmaansudais': 'Abdurrahmaan_As-Sudais_192kbps'
        };
        const folder = qariMap[qari] || 'Alafasy_128kbps';
        const s = String(surahNumber).padStart(3, '0');
        const a = String(ayahNumber).padStart(3, '0');
        return `https://everyayah.com/data/${folder}/${s}${a}.mp3`;
    }
};