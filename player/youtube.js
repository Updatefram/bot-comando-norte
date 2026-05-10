const playdl = require('play-dl');
const { withTimeout } = require('../utils/async');

async function searchOne(query) {
    const results = await withTimeout(playdl.search(query, { limit: 1 }), 15000, 'yt-search');
    const first = Array.isArray(results) ? results[0] : null;
    const url = first?.url;
    if (!url || typeof url !== 'string') return null;
    return { url, title: String(first?.title ?? 'Sem título') };
}

function parseSearchQueryFromResultsUrl(url) {
    try {
        const u = new URL(String(url));
        if (u.hostname !== 'www.youtube.com' && u.hostname !== 'youtube.com') return null;
        if (u.pathname !== '/results') return null;
        const q = u.searchParams.get('search_query');
        return q ? String(q) : null;
    } catch {
        return null;
    }
}

async function resolveToTracks(input, { requestedById }) {
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('QUERY_VAZIA');

    let normalized = raw;
    try {
        const u = new URL(raw);
        const host = String(u.hostname || '').toLowerCase();
        const isYouTubeHost = host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com';
        if (isYouTubeHost && u.pathname === '/watch') {
            const list = u.searchParams.get('list');
            if (list && /^\w+/.test(list)) {
                const playlistUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
                const typeFromWatch = playdl.validate(raw);
                if (typeFromWatch === 'yt_playlist' || typeFromWatch === 'yt_music_playlist') {
                    normalized = playlistUrl;
                }
            }
        }
    } catch {}

    const type = playdl.validate(normalized);
    if (!type) {
        const qFromUrl = parseSearchQueryFromResultsUrl(normalized);
        const q = qFromUrl ?? normalized;
        const found = await searchOne(q);
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

    throw new Error('TIPO_NAO_SUPORTADO');
}

async function getStream(url) {
    try {
        const s = await withTimeout(playdl.stream(url, { quality: 2 }), 20000, 'yt-stream');
        if (!s?.stream || !s?.type) throw new Error('STREAM_FALHOU');
        return s;
    } catch (err) {
        const info = await withTimeout(playdl.video_info(url), 20000, 'yt-video-info-stream');
        const s2 = await withTimeout(playdl.stream_from_info(info), 20000, 'yt-stream-from-info');
        if (!s2?.stream || !s2?.type) throw err;
        return s2;
    }
}

module.exports = { resolveToTracks, getStream };
