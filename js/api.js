// ══════════════════════════════════════════
//  API HANDLER - FIXED + TRANSLITERATION
// ══════════════════════════════════════════

const QuranAPI = {
    BASE: 'https://api.alquran.cloud/v1',
    QURAN_COM_BASE: 'https://api.quran.com/api/v4',

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
                console.log(`🔄 Fetch attempt ${attempt + 1}: ${endpoint}`);
                const json = await this.fetchWithTimeout(
                    `${this.BASE}${endpoint}`,
                    attempt === 0 ? 15000 : 20000
                );
                if (json.code === 200 && json.data) {
                    if (cacheKey) this.cache.set(cacheKey, json.data);
                    console.log(`✅ Fetch berhasil: ${endpoint}`);
                    return json.data;
                }
                throw new Error(json.status || 'Data tidak valid');
            } catch (err) {
                lastError = err;
                console.warn(`⚠️ Attempt ${attempt + 1} gagal:`, err.message);
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

    // ═══ DATA SURAH LENGKAP (Arab + Terjemah + Audio) ═══
    async getSurahFull(surahNumber, language = 'id.indonesian', qari = 'ar.alafasy') {
        const cacheKey = `full_${surahNumber}_${language}_${qari}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            console.log(`✅ Full cache hit: surah ${surahNumber}`);
            return cached;
        }

        console.log(`📖 Loading surah ${surahNumber}...`);

        const [arabicResult, transResult, audioResult] = await Promise.allSettled([
            this.fetchData(`/surah/${surahNumber}/quran-uthmani`, `ar_${surahNumber}`),
            this.fetchData(`/surah/${surahNumber}/${language}`, `tr_${surahNumber}_${language}`),
            this.fetchData(`/surah/${surahNumber}/${qari}`, `au_${surahNumber}_${qari}`)
        ]);

        if (arabicResult.status === 'rejected') {
            throw new Error('Gagal memuat teks Al-Quran. Coba lagi.');
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

    // ══════════════════════════════════════════════════
    //  BARU: TRANSLITERASI LATIN DARI QURAN.COM API
    // ══════════════════════════════════════════════════

    async getSurahTransliteration(surahNumber) {
        const cacheKey = `latin_${surahNumber}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            console.log(`✅ Latin cache hit: surah ${surahNumber}`);
            return cached;
        }

        try {
            console.log(`🔤 Loading transliteration for surah ${surahNumber}...`);

            // quran.com API: ambil semua ayat dengan field transliteration
            // Per page max 50, jadi mungkin perlu pagination
            const allVerses = [];
            let page = 1;
            let totalPages = 1;

            while (page <= totalPages) {
                const url = `${this.QURAN_COM_BASE}/verses/by_chapter/${surahNumber}?language=id&words=true&word_fields=text_uthmani&per_page=50&page=${page}&fields=text_uthmani`;
                const json = await this.fetchWithTimeout(url, 15000);

                if (json.verses) {
                    allVerses.push(...json.verses);
                }
                if (json.pagination) {
                    totalPages = json.pagination.total_pages || 1;
                }
                page++;
            }

            // Susun transliterasi per ayat
            const latinData = {};
            allVerses.forEach((verse, idx) => {
                const ayahNumber = idx + 1;
                if (verse.words && verse.words.length > 0) {
                    // Gabungkan transliterasi per kata
                    const latinText = verse.words
                        .filter(w => w.char_type_name === 'word')
                        .map(w => {
                            if (w.transliteration && w.transliteration.text) {
                                return w.transliteration.text;
                            }
                            return '';
                        })
                        .join(' ');

                    latinData[ayahNumber] = latinText || null;
                }
            });

            this.cache.set(cacheKey, latinData);
            console.log(`✅ Transliteration loaded for surah ${surahNumber}: ${Object.keys(latinData).length} ayahs`);
            return latinData;

        } catch (err) {
            console.warn(`⚠️ Transliteration gagal untuk surah ${surahNumber}:`, err.message);
            return {};
        }
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