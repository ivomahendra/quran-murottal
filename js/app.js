// ══════════════════════════════════════════
//  APP LOGIC - FIXED + LATIN SUPPORT
// ══════════════════════════════════════════

const player = new QuranPlayer();

const urlParams = new URLSearchParams(window.location.search);
let surahNumber = parseInt(urlParams.get('surah')) || 1;
let currentLanguage = urlParams.get('lang') || 'id.indonesian';
let currentQari = urlParams.get('qari') || 'ar.alafasy';
let autoplay = urlParams.get('autoplay') === '1';

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 App starting...');
    loadTheme();
    loadOptions();

    try {
        await Promise.all([
            populateSurahSelector(),
            loadSurah(surahNumber)
        ]);

        const qariSelect = document.getElementById('qari-select');
        const langSelect = document.getElementById('lang-select');
        if (qariSelect) qariSelect.value = currentQari;
        if (langSelect) langSelect.value = currentLanguage;

        if (autoplay) setTimeout(() => player.playAll(), 1500);
    } catch (err) {
        console.error('Init error:', err);
    }
});

// ═══ LOAD SURAH ═══
async function loadSurah(number) {
    surahNumber = number;
    const container = document.getElementById('quran-container');

    container.innerHTML = `
        <div class="loading-container">
            <div class="spinner"></div>
            <p>Memuat Surah ${number}...</p>
            <p class="loading-hint">Mengambil data dari server...</p>
        </div>
    `;

    try {
        console.log(`📖 Loading surah ${number}...`);
        const result = await player.loadSurah(number, currentLanguage, currentQari);
        const info = result.info;

        console.log(`✅ Surah ${number} loaded: ${info.englishName}, ${result.ayahs.length} ayahs`);

        updateHeader(info);

        const surahSelector = document.getElementById('surah-selector');
        if (surahSelector) surahSelector.value = number;

        const bismillah = document.getElementById('bismillah');
        if (bismillah) bismillah.style.display = (number === 9) ? 'none' : 'block';

        populateAyahSelectors(info.numberOfAyahs);
        renderAyahs(result.ayahs, info);

        const prevBtn = document.getElementById('btn-prev-surah');
        const nextBtn = document.getElementById('btn-next-surah');
        if (prevBtn) prevBtn.disabled = (number <= 1);
        if (nextBtn) nextBtn.disabled = (number >= 114);

        const newUrl = `surah.html?surah=${number}&lang=${currentLanguage}&qari=${currentQari}`;
        history.replaceState(null, '', newUrl);

    } catch (error) {
        console.error('❌ Load surah error:', error);
        container.innerHTML = `
            <div class="error-container">
                <div class="error-icon">❌</div>
                <h3>Gagal Memuat Surah</h3>
                <p>${error.message || 'Periksa koneksi internet Anda'}</p>
                <div class="error-actions">
                    <button class="btn-retry" onclick="loadSurah(${number})">🔄 Coba Lagi</button>
                    <button class="btn-retry btn-clear-cache" onclick="clearCacheAndReload(${number})">🗑️ Clear Cache & Coba Lagi</button>
                </div>
                <p class="error-tip">💡 Tip: Pastikan internet stabil. API mungkin sedang sibuk.</p>
            </div>
        `;
    }
}

// ═══ UPDATE HEADER ═══
function updateHeader(info) {
    const elements = {
        'surah-number-big': info.number,
        'surah-name-ar': info.name,
        'surah-name-en': info.englishName,
        'surah-meta-info': `${info.revelationType === 'Meccan' ? 'Makkiyah' : 'Madaniyah'} • ${info.numberOfAyahs} Ayat • ${info.englishNameTranslation}`
    };
    for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }
    document.title = `${info.englishName} (${info.name}) - Murottal Al-Quran`;
}

// ═══ RENDER AYAHS (DITAMBAH LATIN) ═══
function renderAyahs(ayahs, info) {
    const container = document.getElementById('quran-container');
    const showTranslation = document.getElementById('opt-show-translation');
    const showTrans = showTranslation ? showTranslation.checked : true;
    const showLatin = localStorage.getItem('opt-latin') === 'true';

    container.innerHTML = '';

    if (!ayahs || ayahs.length === 0) {
        container.innerHTML = `
            <div class="error-container">
                <p>Tidak ada ayat yang dimuat.</p>
                <button class="btn-retry" onclick="loadSurah(${surahNumber})">🔄 Coba Lagi</button>
            </div>
        `;
        return;
    }

    const fragment = document.createDocumentFragment();

    ayahs.forEach((ayah, index) => {
        const block = document.createElement('div');
        block.className = 'ayah-block';
        block.id = `ayah-${ayah.number}`;

        // Latin: tampilkan jika sudah ada data, atau placeholder
        const latinContent = ayah.latin
            ? ayah.latin
            : '<span class="latin-loading">Memuat transliterasi...</span>';

        block.innerHTML = `
            <div class="ayah-top-bar">
                <div class="ayah-badge-area">
                    <span class="ayah-badge">${ayah.number}</span>
                    ${ayah.sajda ? '<span class="sajda-badge">🕌 Sajda</span>' : ''}
                </div>
                <div class="ayah-actions">
                    <button class="btn-ayah-action btn-play-ayah" data-ayah="${ayah.number}" title="Play ayat ini">
                        ▶
                    </button>
                    <button class="btn-ayah-action btn-tafsir-ayah" data-ayah="${ayah.number}" data-surah="${info.number}" data-total="${info.numberOfAyahs}" data-name="${info.englishName}" title="Lihat Tafsir">
                        📖
                    </button>
                    <button class="btn-ayah-action btn-copy-ayah" data-index="${index}" title="Salin ayat">
                        📋
                    </button>
                    <button class="btn-ayah-action btn-share-ayah" data-index="${index}" title="Bagikan">
                        🔗
                    </button>
                </div>
            </div>

            <div class="ayah-arabic" dir="rtl" data-ayah="${ayah.number}">
                ${ayah.arabic} <span class="ayah-end-mark">﴿${toArabicNumber(ayah.number)}﴾</span>
            </div>

            <div class="ayah-latin ${showLatin ? '' : 'hidden'}">
                ${latinContent}
            </div>

            <div class="ayah-translation ${showTrans ? '' : 'hidden'}">
                ${ayah.translation}
            </div>
        `;

        fragment.appendChild(block);
    });

    container.appendChild(fragment);

    // Event delegation
    container.addEventListener('click', handleAyahClick);

    console.log(`✅ Rendered ${ayahs.length} ayahs`);
}

// ═══ EVENT DELEGATION HANDLER (tidak berubah) ═══
function handleAyahClick(e) {
    const target = e.target.closest('button') || e.target.closest('.ayah-arabic');
    if (!target) return;

    if (target.classList.contains('btn-play-ayah') || target.classList.contains('ayah-arabic')) {
        const ayahNum = parseInt(target.dataset.ayah);
        if (ayahNum) player.playSingleAyah(ayahNum);
        return;
    }
    if (target.classList.contains('btn-tafsir-ayah')) {
        openTafsir(parseInt(target.dataset.surah), parseInt(target.dataset.ayah), parseInt(target.dataset.total), target.dataset.name);
        return;
    }
    if (target.classList.contains('btn-copy-ayah')) {
        copyAyah(parseInt(target.dataset.index));
        return;
    }
    if (target.classList.contains('btn-share-ayah')) {
        shareAyah(parseInt(target.dataset.index));
        return;
    }
}

// ═══ POPULATE SURAH SELECTOR (tidak berubah) ═══
async function populateSurahSelector() {
    const selector = document.getElementById('surah-selector');
    if (!selector) return;
    try {
        const surahs = await QuranAPI.getSurahList();
        selector.innerHTML = '';
        surahs.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.number;
            opt.textContent = `${s.number}. ${s.englishName} (${s.name})`;
            if (s.number === surahNumber) opt.selected = true;
            selector.appendChild(opt);
        });
        console.log('✅ Surah selector populated');
    } catch (err) {
        console.warn('Gagal load surah list:', err);
        selector.innerHTML = '';
        for (let i = 1; i <= 114; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `Surah ${i}`;
            if (i === surahNumber) opt.selected = true;
            selector.appendChild(opt);
        }
    }
}

// ═══ POPULATE AYAH SELECTORS (tidak berubah) ═══
function populateAyahSelectors(total) {
    const fromEl = document.getElementById('from-ayah');
    const toEl = document.getElementById('to-ayah');
    if (!fromEl || !toEl) return;

    let fromHTML = '';
    let toHTML = '';
    for (let i = 1; i <= total; i++) {
        fromHTML += `<option value="${i}">Ayat ${i}</option>`;
        toHTML += `<option value="${i}">Ayat ${i}</option>`;
    }
    fromEl.innerHTML = fromHTML;
    toEl.innerHTML = toHTML;
    toEl.value = total;

    fromEl.onchange = function() {
        if (parseInt(toEl.value) < parseInt(this.value)) {
            toEl.value = this.value;
        }
    };
}

// ═══ PLAY CONTROLS (tidak berubah) ═══
function playAll() {
    if (player.isPlaying) {
        player.togglePlay();
    } else {
        player.playAll();
    }
}

function playRange() {
    const from = parseInt(document.getElementById('from-ayah').value);
    const to = parseInt(document.getElementById('to-ayah').value);
    if (from > to) {
        showToast('⚠️ Ayat awal harus ≤ ayat akhir');
        return;
    }
    player.playRange(from, to);
    showToast(`▶ Play ayat ${from} - ${to}`);
}

function togglePlay() {
    if (player.ayahs.length === 0) {
        showToast('⚠️ Belum ada surah yang dimuat');
        return;
    }
    player.togglePlay();
}

// ═══ NAVIGATION (tidak berubah) ═══
function goToSurah(val) {
    const num = parseInt(val);
    if (num >= 1 && num <= 114) {
        player.stop();
        loadSurah(num);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function navigateSurah(direction) {
    const newNum = surahNumber + direction;
    if (newNum >= 1 && newNum <= 114) {
        player.stop();
        loadSurah(newNum);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ═══ BARU: Auto lanjut ke surah berikutnya ═══
async function goToNextSurahContinuous() {
    const nextSurah = surahNumber + 1;
    if (nextSurah > 114) {
        showToast('✅ Alhamdulillah, telah selesai 114 surah!');
        return;
    }

    showToast(`📖 Melanjutkan ke surah ${nextSurah}...`);

    // Load surah berikutnya
    await loadSurah(nextSurah);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Tunggu sebentar lalu auto play
    setTimeout(() => {
        player.playAll();
    }, 1500);
}

// ═══ CHANGE SETTINGS (tidak berubah) ═══
async function changeQari(qari) {
    currentQari = qari;
    player.stop();
    showToast('🔄 Mengganti qari...');
    await loadSurah(surahNumber);
}

async function changeLanguage(lang) {
    currentLanguage = lang;
    player.stop();
    showToast('🔄 Mengganti terjemahan...');
    await loadSurah(surahNumber);
}

// ═══ OPTIONS (DITAMBAH LATIN TOGGLE) ═══
function loadOptions() {
    // Auto Scroll
    const optScroll = document.getElementById('opt-auto-scroll');
    if (optScroll) {
        optScroll.checked = localStorage.getItem('opt-scroll') !== 'false';
        optScroll.onchange = function() {
            player.autoScroll = this.checked;
            localStorage.setItem('opt-scroll', this.checked);
        };
        player.autoScroll = optScroll.checked;
    }

    // Repeat
// BARU: Continuous (Lanjut Surah Berikutnya)
    const optContinuous = document.getElementById('opt-continuous');
    if (optContinuous) {
        optContinuous.checked = localStorage.getItem('opt-continuous') !== 'false';
        optContinuous.onchange = function() {
            player.continuous = this.checked;
            localStorage.setItem('opt-continuous', this.checked);
            if (this.checked) {
                showToast('📖 Akan otomatis lanjut ke surah berikutnya');
            } else {
                showToast('⏹ Berhenti di akhir surah');
            }
        };
        player.continuous = optContinuous.checked;
    }

    // Show Translation
    const optTrans = document.getElementById('opt-show-translation');
    if (optTrans) {
        optTrans.checked = localStorage.getItem('opt-trans') !== 'false';
        optTrans.onchange = function() {
            document.querySelectorAll('.ayah-translation').forEach(el => {
                el.classList.toggle('hidden', !this.checked);
            });
            localStorage.setItem('opt-trans', this.checked);
        };
    }

    // BARU: Show Latin
    const optLatin = document.getElementById('opt-show-latin');
    if (optLatin) {
        optLatin.checked = localStorage.getItem('opt-latin') === 'true';
        optLatin.onchange = function() {
            document.querySelectorAll('.ayah-latin').forEach(el => {
                el.classList.toggle('hidden', !this.checked);
            });
            localStorage.setItem('opt-latin', this.checked);

            if (this.checked) {
                showToast('🔤 Transliterasi latin ditampilkan');
            } else {
                showToast('🔤 Transliterasi latin disembunyikan');
            }
        };
    }
}

// ═══ TAFSIR POPUP (tidak berubah) ═══
function openTafsir(surah, ayah, total, name) {
    const url = `tafsir.html?surah=${surah}&ayah=${ayah}&total=${total}&name=${encodeURIComponent(name)}`;
    const w = Math.min(700, window.innerWidth - 40);
    const h = Math.min(700, window.innerHeight - 40);
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    const popup = window.open(
        url,
        'tafsir_popup',
        `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`
    );
    if (!popup || popup.closed) {
        window.open(url, '_blank');
    }
}

// ═══ UTILITIES (DITAMBAH LATIN DI COPY) ═══
function toArabicNumber(num) {
    const digits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    return num.toString().split('').map(d => digits[parseInt(d)]).join('');
}

function copyAyah(index) {
    const ayah = player.ayahs[index];
    if (!ayah) return;

    // DITAMBAH: sertakan latin jika ada
    let text = ayah.arabic;
    if (ayah.latin) {
        text += `\n\n${ayah.latin}`;
    }
    text += `\n\n${ayah.translation}`;
    text += `\n\n— QS ${player.surahName}: ${ayah.number}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('✅ Ayat berhasil disalin!'))
            .catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast('✅ Ayat berhasil disalin!');
    } catch {
        showToast('❌ Gagal menyalin');
    }
    document.body.removeChild(ta);
}

function shareAyah(index) {
    const ayah = player.ayahs[index];
    if (!ayah) return;

    let text = ayah.arabic;
    if (ayah.latin) {
        text += `\n\n${ayah.latin}`;
    }
    text += `\n\n${ayah.translation}`;
    text += `\n\n— QS ${player.surahName}: ${ayah.number}`;

    if (navigator.share) {
        navigator.share({
            title: `QS ${player.surahName}: ${ayah.number}`,
            text: text
        }).catch(() => {});
    } else {
        copyAyah(index);
    }
}

// ═══ TOAST (tidak berubah) ═══
function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ═══ CACHE (tidak berubah) ═══
function clearCacheAndReload(number) {
    QuranAPI.cache.cleanup();
    localStorage.clear();
    showToast('🗑️ Cache dibersihkan, memuat ulang...');
    setTimeout(() => loadSurah(number), 500);
}

// ═══ THEME (tidak berubah) ═══
function toggleTheme() {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    const btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

function loadTheme() {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
        const btn = document.querySelector('.theme-toggle');
        if (btn) btn.textContent = '☀️';
    }
}