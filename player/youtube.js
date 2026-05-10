const playdl = require('play-dl');
const { withTimeout } = require('../utils/async');

async function searchOne(query) {
    const results = await withTimeout(playdl.search(query, { limit: 1 }), 15000, 'yt-search');
    const first = Array.isArray(results) ? results[0] : null;
    const url = first?.url;
    if (!url || typeof url !== 'string') return null;
    return { url, title: String(first?.title ?? 'Sem título') };
}

function extractYoutubeSearchQuery(rawUrl) {
    try {
        const u = new URL(String(rawUrl));
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (!host.endsWith('youtube.com')) return null;
        if (u.pathname !== '/results') return null;
        const q = u.searchParams.get('search_query');
        return q ? String(q).trim() : null;
    } catch {
        return null;
    }
}

function normalizeYoutubeInput(raw) {
    const text = String(raw ?? '').trim();
    try {
        const u = new URL(text);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        const pathname = u.pathname || '/';

        if (host === 'youtu.be') {
            const id = pathname.replace(/^\/+/, '').split('/')[0];
            if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
        }

        if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
            if (pathname.startsWith('/shorts/')) {
                const id = pathname.split('/')[2] || pathname.split('/')[1];
                if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
            }
            if (pathname.startsWith('/embed/')) {
                const id = pathname.split('/')[2] || pathname.split('/')[1];
                if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
            }
            if (pathname === '/watch') {
                const v = u.searchParams.get('v');
                const list = u.searchParams.get('list');
                if (list && list !== 'WL' && /^\w+/.test(list)) {
                    return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
                }
                if (v) return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`;
            }
            if (pathname === '/playlist') {
                const list = u.searchParams.get('list');
                if (list && /^\w+/.test(list)) return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
            }
            if (pathname === '/results') {
                const query = u.searchParams.get('search_query');
                if (query) return `search:${String(query).trim()}`;
            }
        }
    } catch {
        // Input is not a full URL, treat as plain search text.
    }
    return text;
}

async function resolveToTracks(input, { requestedById }) {
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('QUERY_VAZIA');

    let normalized = normalizeYoutubeInput(raw);
    let isSearchQuery = false;
    if (typeof normalized === 'string' && normalized.startsWith('search:')) {
        normalized = normalized.slice(7).trim();
        isSearchQuery = true;
    }

    if (!normalized) throw new Error('QUERY_VAZIA');

    const type = !isSearchQuery ? playdl.validate(normalized) : null;
    if (!type) {
        const searchText = extractYoutubeSearchQuery(normalized) ?? normalized;
        const found = await searchOne(searchText);
        if (!found) throw new Error('NAO_ENCONTRADO');
        return [{ url: found.url, title: found.title, requestedById }];
    }

    if (type === 'yt_playlist' || type === 'yt_music_playlist') {
        const playlist = await withTimeout(playdl.playlist_info(normalized, { incomplete: true }), 20000, 'yt-playlist');
        const videos = await withTimeout(playlist.all_videos(), 30000, 'yt-playlist-videos');
        const limited = Array.isArray(videos) ? videos.slice(0, 200) : [];
        if (!limited.length) throw new Error('NAO_ENCONTRADO');
        return limited.map((v) => ({ url: v.url, title: String(v?.title ?? 'Sem título'), requestedById }));
    }

    if (type === 'yt_video' || type === 'yt_short' || type === 'yt_music_video') {
        const info = await withTimeout(playdl.video_basic_info(normalized), 20000, 'yt-video-info');
        const title = String(info?.video_details?.title ?? 'Sem título');
        return [{ url: normalized, title, requestedById }];
    }

    if (type === 'yt_search') {
        const found = await searchOne(normalized);
        if (!found) throw new Error('NAO_ENCONTRADO');
        return [{ url: found.url, title: found.title, requestedById }];
    }

    throw new Error('TIPO_NAO_SUPORTADO');
}

async function getStream(url) {
    try {
        const s = await withTimeout(playdl.stream(url, { quality: 2 }), 20000, 'yt-stream');
        if (!s?.stream || !s?.type) throw new Error('STREAM_FALHOU');
        return s;
    } catch (err) {
        try {
            const info = await withTimeout(playdl.video_info(url), 20000, 'yt-video-info-stream');
            const s2 = await withTimeout(playdl.stream_from_info(info), 20000, 'yt-stream-from-info');
            if (!s2?.stream || !s2?.type) throw new Error('STREAM_FALHOU');
            return s2;
        } catch {
            throw err;
        }
    }
}

module.exports = { resolveToTracks, getStream };
