// AnimeAV1 Sora Module
// Source: https://animeav1.com
// Uses SvelteKit __data.json internal API to bypass JS rendering
// Language: Spanish (SUB + DUB)

async function soraFetch(url, options = {}) {
    const headers = options.headers ?? {};
    const method = options.method ?? 'GET';
    const body = options.body ?? null;

    if (!headers['User-Agent'] && !headers['user-agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';
    }

    try {
        const res = await fetchv2(url, headers, method, body);
        if (res && typeof res.text === 'function') return await res.text();
        if (res && typeof res === 'object' && res._data !== undefined) return res._data;
        return res;
    } catch (e) {
        try {
            const res = await fetch(url, { method, headers, body });
            if (res && typeof res.text === 'function') return await res.text();
            return res;
        } catch (err) {
            return null;
        }
    }
}

// Recursively extract all string and number values from SvelteKit's devalue nodes
function extractNodes(data) {
    if (!data || !data.nodes) return [];
    return data.nodes.filter(n => n !== null && n !== undefined);
}

// Find anime entries from __data.json node array
// SvelteKit stores page data as a flat array of values with index references
function parseAnimeList(nodes) {
    const results = [];
    // Look for objects that have slug/title/cover patterns
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node && typeof node === 'object' && node.slug && node.title && node.cover) {
            results.push({
                title: node.title,
                image: `https://cdn.animeav1.com/covers/${node.cover}.jpg`,
                href: `https://animeav1.com/media/${node.slug}`
            });
        }
    }
    return results;
}

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);

        // Use SvelteKit's __data.json endpoint — returns raw JSON without JS rendering
        const text = await soraFetch(
            `https://animeav1.com/catalogo/__data.json?q=${encodedKeyword}`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (!text) return JSON.stringify([]);

        const data = JSON.parse(text);
        const nodes = extractNodes(data);
        const results = parseAnimeList(nodes);

        if (results.length > 0) return JSON.stringify(results);

        // Fallback: scan nodes for title/slug patterns stored as flat values
        const fallback = [];
        const slugs = [];
        const titles = [];
        const covers = [];

        for (const node of nodes) {
            if (typeof node === 'string') {
                if (node.match(/^[a-z0-9]+(-[a-z0-9]+)+$/) && !node.includes('http')) slugs.push(node);
                if (node.match(/\d+/) && node.length < 6 && !node.includes('/')) covers.push(node);
                if (node.length > 3 && node.length < 100 && /[A-ZÁÉÍÓÚÑ]/.test(node)) titles.push(node);
            }
        }

        const len = Math.min(slugs.length, titles.length, covers.length);
        for (let i = 0; i < len; i++) {
            fallback.push({
                title: titles[i],
                image: `https://cdn.animeav1.com/covers/${covers[i]}.jpg`,
                href: `https://animeav1.com/media/${slugs[i]}`
            });
        }

        return fallback.length > 0
            ? JSON.stringify(fallback)
            : JSON.stringify([{ title: 'No results found', image: '', href: '' }]);

    } catch (error) {
        console.log('searchResults error:', error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const cleanUrl = url.split('?')[0];
        const slug = cleanUrl.split('/media/')[1]?.split('/')[0];
        if (!slug) throw new Error('No slug');

        const text = await soraFetch(
            `https://animeav1.com/media/${slug}/__data.json`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (!text) throw new Error('No response');

        const data = JSON.parse(text);
        const nodes = extractNodes(data);

        let description = 'No description available';
        let year = 'Unknown';
        let type = 'Anime';
        let genres = '';

        for (const node of nodes) {
            if (node && typeof node === 'object') {
                if (node.synopsis || node.description) description = node.synopsis || node.description;
                if (node.year) year = String(node.year);
                if (node.type) type = node.type;
                if (node.genres && Array.isArray(node.genres)) {
                    genres = node.genres.map(g => g.name || g).join(', ');
                }
            }
        }

        return JSON.stringify([{
            description,
            aliases: `Type: ${type} | Genres: ${genres || 'Unknown'}`,
            airdate: `Year: ${year}`
        }]);

    } catch (error) {
        console.log('extractDetails error:', error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Type: Unknown',
            airdate: 'Year: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        const cleanUrl = url.split('?')[0];
        const slug = cleanUrl.split('/media/')[1]?.split('/')[0];
        if (!slug) throw new Error('No slug');

        const text = await soraFetch(
            `https://animeav1.com/media/${slug}/__data.json`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (!text) throw new Error('No response');

        const data = JSON.parse(text);
        const nodes = extractNodes(data);

        let totalEpisodes = 0;
        let hasDub = false;

        for (const node of nodes) {
            if (node && typeof node === 'object') {
                if (typeof node.episodes === 'number') totalEpisodes = node.episodes;
                if (node.episodes_count) totalEpisodes = node.episodes_count;
                if (node.dub === true || node.has_dub === true) hasDub = true;
            }
            // Also check for dub flag as a boolean node
            if (node === true && !hasDub) {
                // check surrounding context — will be refined below
            }
        }

        // If we couldn't find episode count in nodes, check episode 1
        // to confirm structure and fallback to fetching ep 1 data
        if (totalEpisodes === 0) {
            const ep1Text = await soraFetch(
                `https://animeav1.com/media/${slug}/1/__data.json`,
                { headers: { 'Accept': 'application/json' } }
            );
            if (ep1Text) {
                const ep1Data = JSON.parse(ep1Text);
                const ep1Nodes = extractNodes(ep1Data);
                for (const node of ep1Nodes) {
                    if (node && typeof node === 'object') {
                        if (typeof node.total === 'number') totalEpisodes = node.total;
                        if (typeof node.episodes === 'number') totalEpisodes = node.episodes;
                        if (node.dub === true || node.has_dub === true) hasDub = true;
                    }
                }
                // Also check raw text for dub marker
                if (ep1Text.includes('"dub":true') || ep1Text.includes('"has_dub":true')) hasDub = true;
            }
        }

        // Check raw text for dub marker in main page data
        if (text.includes('"dub":true') || text.includes('"has_dub":true')) hasDub = true;

        if (totalEpisodes === 0) totalEpisodes = 1;

        const episodes = [];
        for (let i = 1; i <= totalEpisodes; i++) {
            const baseHref = `https://animeav1.com/media/${slug}/${i}`;
            episodes.push({ href: baseHref + '?audio=sub', number: i });
            if (hasDub) {
                episodes.push({ href: baseHref + '?audio=dub', number: parseFloat(`${i}.5`) });
            }
        }

        return JSON.stringify(episodes);

    } catch (error) {
        console.log('extractEpisodes error:', error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const isDub = url.includes('?audio=dub');
        const cleanUrl = url.split('?')[0];

        // e.g. /media/baki-dou/1 → slug=baki-dou, ep=1
        const parts = cleanUrl.split('/media/')[1]?.split('/');
        const slug = parts?.[0];
        const ep = parts?.[1];
        if (!slug || !ep) throw new Error('Could not parse slug/ep');

        const text = await soraFetch(
            `https://animeav1.com/media/${slug}/${ep}/__data.json`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (!text) return JSON.stringify({ streams: [] });

        const data = JSON.parse(text);
        const nodes = extractNodes(data);
        const streams = [];

        // Look for stream server objects in nodes
        // AnimeAV1 typically stores servers as: { type: 'hls'|'mp4', url: '...', variant: 'sub'|'dub' }
        for (const node of nodes) {
            if (!node || typeof node !== 'object') continue;

            const variant = (node.variant || node.lang || node.type_audio || '').toLowerCase();
            const isSubNode = !variant || variant === 'sub' || variant === 'latino';
            const isDubNode = variant === 'dub' || variant === 'doblaje';

            // Skip if wrong audio type
            if (isDub && !isDubNode && variant) continue;
            if (!isDub && isDubNode) continue;

            // Check for direct stream URL
            const streamUrl = node.url || node.file || node.src || node.stream;
            if (streamUrl && typeof streamUrl === 'string' && streamUrl.startsWith('http')) {
                const isHls = streamUrl.includes('.m3u8');
                const isMp4 = streamUrl.includes('.mp4');
                if (isHls || isMp4) {
                    streams.push({
                        title: `${node.server || node.name || 'Stream'} (${isDub ? 'DUB' : 'SUB'})`,
                        streamUrl,
                        headers: { 'Referer': 'https://animeav1.com/' }
                    });
                }
            }

            // Check for embed player URL to resolve further
            const embedUrl = node.embed || node.iframe || node.player;
            if (embedUrl && typeof embedUrl === 'string' && embedUrl.startsWith('http')) {
                try {
                    const embedText = await soraFetch(embedUrl);
                    if (embedText) {
                        const m3u8 = embedText.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
                        const mp4 = embedText.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
                        const found = (mp4 || m3u8)?.[0];
                        if (found) {
                            streams.push({
                                title: `${node.server || node.name || 'Embed'} (${isDub ? 'DUB' : 'SUB'})`,
                                streamUrl: found,
                                headers: { 'Referer': embedUrl }
                            });
                        }
                    }
                } catch (e) {}
            }
        }

        // Fallback: scan raw JSON text for any m3u8 or mp4 URLs
        if (streams.length === 0) {
            const m3u8Matches = [...text.matchAll(/https?:\\?\/\\?\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g)];
            const mp4Matches = [...text.matchAll(/https?:\\?\/\\?\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g)];
            const allUrls = [...mp4Matches, ...m3u8Matches];

            for (const match of allUrls) {
                const streamUrl = match[0].replace(/\\u002F/g, '/').replace(/\\/g, '');
                streams.push({
                    title: isDub ? 'Stream (DUB)' : 'Stream (SUB)',
                    streamUrl,
                    headers: { 'Referer': 'https://animeav1.com/' }
                });
                break; // Just take the first one found
            }
        }

        if (streams.length === 0) {
            console.log('extractStreamUrl: No streams found for', url);
        }

        return JSON.stringify({ streams });

    } catch (error) {
        console.log('extractStreamUrl error:', error);
        return JSON.stringify({ streams: [] });
    }
}
