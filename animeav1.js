// AnimeAV1 Sora Module
// Source: https://animeav1.com
// Uses SvelteKit __data.json internal API
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

// Resolve a value from SvelteKit's flat data array.
// Values can be direct or index references into the array.
function resolve(data, val) {
    if (typeof val === 'number' && val < data.length && typeof data[val] !== 'number') {
        return data[val];
    }
    return val;
}

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const text = await soraFetch(
            `https://animeav1.com/catalogo/__data.json?q=${encodedKeyword}`,
            { headers: { 'Accept': 'application/json' } }
        );
        if (!text) return JSON.stringify([]);

        const json = JSON.parse(text);
        // Data is in nodes[2].data — a flat array
        const data = json.nodes[2].data;

        // data[0] = { results: 1, total: ..., ... }
        // data[1] = array of indices pointing to each anime's first field index
        // Each anime entry follows the template at data[2]: {id, title, synopsis, categoryId, slug, category}
        // So for each index i in data[1], the anime object is at data[i]
        // and its fields: title = data[i+1], synopsis = data[i+2], slug = data[i+4]
        // cover/id = data[i] (the numeric id string like "3812")

        const resultsIndexArray = data[1]; // array of starting indices for each anime
        const results = [];

        for (const startIdx of resultsIndexArray) {
            const animeObj = data[startIdx];
            if (!animeObj || typeof animeObj !== 'object') continue;

            // animeObj has keys: id, title, synopsis, categoryId, slug, category
            // Each value is an index into the data array
            const id = resolve(data, animeObj.id);       // numeric string like "3812"
            const title = resolve(data, animeObj.title);
            const slug = resolve(data, animeObj.slug);

            if (!title || !slug) continue;

            results.push({
                title: title,
                image: `https://cdn.animeav1.com/covers/${id}.jpg`,
                href: `https://animeav1.com/media/${slug}`
            });
        }

        if (results.length === 0) {
            return JSON.stringify([{ title: 'No results found', image: '', href: '' }]);
        }

        return JSON.stringify(results);

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

        const json = JSON.parse(text);
        const data = json.nodes[2].data;

        // Find the main anime object in the flat array
        let description = 'No description available';
        let year = 'Unknown';
        let type = 'Anime';
        let genres = '';

        for (let i = 0; i < data.length; i++) {
            const node = data[i];
            if (node && typeof node === 'object') {
                if (node.synopsis !== undefined && node.title !== undefined) {
                    description = resolve(data, node.synopsis) || description;
                    year = resolve(data, node.year) ? String(resolve(data, node.year)) : year;

                    const catObj = resolve(data, node.category);
                    if (catObj && typeof catObj === 'object') {
                        type = resolve(data, catObj.name) || type;
                    }
                }
                if (node.genres !== undefined && Array.isArray(resolve(data, node.genres))) {
                    const genreArr = resolve(data, node.genres);
                    genres = genreArr.map(g => {
                        const gObj = resolve(data, g);
                        return gObj && typeof gObj === 'object' ? resolve(data, gObj.name) : g;
                    }).filter(Boolean).join(', ');
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

        const json = JSON.parse(text);
        const data = json.nodes[2].data;

        let totalEpisodes = 0;
        let hasDub = false;

        for (let i = 0; i < data.length; i++) {
            const node = data[i];
            if (node && typeof node === 'object') {
                if (node.episodes_count !== undefined) {
                    totalEpisodes = resolve(data, node.episodes_count) || 0;
                }
                if (node.episodes !== undefined && typeof resolve(data, node.episodes) === 'number') {
                    totalEpisodes = resolve(data, node.episodes);
                }
                if (node.dub !== undefined && resolve(data, node.dub) === true) hasDub = true;
                if (node.has_dub !== undefined && resolve(data, node.has_dub) === true) hasDub = true;
            }
        }

        // Also check raw text for dub flags
        if (text.includes('"dub":true') || text.includes('"has_dub":true')) hasDub = true;

        // Fallback: fetch episode 1 to check dub and confirm structure
        if (totalEpisodes === 0) {
            const ep1Text = await soraFetch(
                `https://animeav1.com/media/${slug}/1/__data.json`,
                { headers: { 'Accept': 'application/json' } }
            );
            if (ep1Text) {
                const ep1Json = JSON.parse(ep1Text);
                const ep1Data = ep1Json.nodes[2].data;
                for (let i = 0; i < ep1Data.length; i++) {
                    const node = ep1Data[i];
                    if (node && typeof node === 'object') {
                        if (node.total !== undefined) totalEpisodes = resolve(ep1Data, node.total) || 0;
                        if (node.episodes_count !== undefined) totalEpisodes = resolve(ep1Data, node.episodes_count) || 0;
                        if (node.dub !== undefined && resolve(ep1Data, node.dub) === true) hasDub = true;
                    }
                }
                if (ep1Text.includes('"dub":true') || ep1Text.includes('"has_dub":true')) hasDub = true;
            }
        }

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
        const parts = cleanUrl.split('/media/')[1]?.split('/');
        const slug = parts?.[0];
        const ep = parts?.[1];
        if (!slug || !ep) throw new Error('Could not parse slug/ep');

        const text = await soraFetch(
            `https://animeav1.com/media/${slug}/${ep}/__data.json`,
            { headers: { 'Accept': 'application/json' } }
        );
        if (!text) return JSON.stringify({ streams: [] });

        const json = JSON.parse(text);
        const data = json.nodes[2].data;
        const streams = [];

        for (let i = 0; i < data.length; i++) {
            const node = data[i];
            if (!node || typeof node !== 'object') continue;

            // Look for server objects with url/embed and variant info
            const variant = resolve(data, node.variant) || resolve(data, node.lang) || '';
            const variantLower = String(variant).toLowerCase();
            const isDubNode = variantLower === 'dub' || variantLower === 'doblaje';
            const isSubNode = !variantLower || variantLower === 'sub' || variantLower === 'latino';

            if (isDub && !isDubNode && variantLower) continue;
            if (!isDub && isDubNode) continue;

            const streamUrl = resolve(data, node.url) || resolve(data, node.file) || resolve(data, node.src);
            if (streamUrl && typeof streamUrl === 'string' && streamUrl.startsWith('http')) {
                if (streamUrl.includes('.m3u8') || streamUrl.includes('.mp4')) {
                    streams.push({
                        title: `${resolve(data, node.server) || resolve(data, node.name) || 'Stream'} (${isDub ? 'DUB' : 'SUB'})`,
                        streamUrl,
                        headers: { 'Referer': 'https://animeav1.com/' }
                    });
                    continue;
                }
            }

            // Check for embed player URL
            const embedUrl = resolve(data, node.embed) || resolve(data, node.iframe) || resolve(data, node.player);
            if (embedUrl && typeof embedUrl === 'string' && embedUrl.startsWith('http')) {
                try {
                    const embedText = await soraFetch(embedUrl);
                    if (embedText) {
                        const mp4 = embedText.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/)?.[0];
                        const m3u8 = embedText.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/)?.[0];
                        const found = mp4 || m3u8;
                        if (found) {
                            streams.push({
                                title: `${resolve(data, node.server) || resolve(data, node.name) || 'Embed'} (${isDub ? 'DUB' : 'SUB'})`,
                                streamUrl: found,
                                headers: { 'Referer': embedUrl }
                            });
                        }
                    }
                } catch (e) {}
            }
        }

        // Fallback: scan raw JSON for any stream URLs
        if (streams.length === 0) {
            const mp4 = text.match(/https?:\\?\/\\?\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/)?.[0];
            const m3u8 = text.match(/https?:\\?\/\\?\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/)?.[0];
            const found = mp4 || m3u8;
            if (found) {
                streams.push({
                    title: isDub ? 'Stream (DUB)' : 'Stream (SUB)',
                    streamUrl: found.replace(/\\/g, ''),
                    headers: { 'Referer': 'https://animeav1.com/' }
                });
            }
        }

        if (streams.length === 0) console.log('extractStreamUrl: No streams found for', url);

        return JSON.stringify({ streams });

    } catch (error) {
        console.log('extractStreamUrl error:', error);
        return JSON.stringify({ streams: [] });
    }
}
