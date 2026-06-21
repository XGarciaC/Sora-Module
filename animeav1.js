// AnimeAV1 Sora Module
// Source: https://animeav1.com
// Language: Spanish (SUB + DUB)
// Stream Type: MP4

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

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const html = await soraFetch(`https://animeav1.com/catalogo?q=${encodedKeyword}`);
        if (!html) return JSON.stringify([]);

        const results = [];

        // Match cover image ID, title and href together from each card block
        const cardRegex = /https:\/\/cdn\.animeav1\.com\/covers\/(\d+)\.jpg[\s\S]*?###\s+(.+?)\n[\s\S]*?href="(https:\/\/animeav1\.com\/media\/[^"\/]+)"[^>]*>\s*Ver /g;
        let match;
        while ((match = cardRegex.exec(html)) !== null) {
            results.push({
                title: match[2].trim(),
                image: `https://cdn.animeav1.com/covers/${match[1]}.jpg`,
                href: match[3]
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
        const html = await soraFetch(cleanUrl);
        if (!html) return JSON.stringify([{ description: 'No description available', aliases: '', airdate: '' }]);

        const descMatch = html.match(/meta-description:\s*([^\n]+)/);
        const description = descMatch ? descMatch[1].trim() : 'No description available';

        const typeMatch = html.match(/TV Anime|OVA|Pel[ií]cula|Especial/);
        const type = typeMatch ? typeMatch[0] : 'Anime';

        const yearMatch = html.match(/•\s*(\d{4})\s*•/);
        const year = yearMatch ? yearMatch[1] : 'Unknown';

        const genreMatches = [...html.matchAll(/catalogo\?genre=[^"]+">([^<]+)<\/a>/g)];
        const genres = genreMatches.map(m => m[1]).join(', ');

        return JSON.stringify([{
            description: description,
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
        const html = await soraFetch(cleanUrl);
        if (!html) return JSON.stringify([]);

        const slugMatch = cleanUrl.match(/\/media\/([^\/]+)$/);
        if (!slugMatch) throw new Error('Could not extract slug');
        const slug = slugMatch[1];

        const episodeRegex = new RegExp(`href="https://animeav1\\.com/media/${slug}/(\\d+)"`, 'g');
        const seen = new Set();
        const episodeNumbers = [];
        let match;

        while ((match = episodeRegex.exec(html)) !== null) {
            const num = match[1];
            if (!seen.has(num)) {
                seen.add(num);
                episodeNumbers.push(parseInt(num, 10));
            }
        }

        episodeNumbers.sort((a, b) => a - b);

        if (episodeNumbers.length === 0) {
            return JSON.stringify([{ href: cleanUrl + '/1', number: 1 }]);
        }

        // Check episode 1 for DUB availability
        const firstEpHtml = await soraFetch(`https://animeav1.com/media/${slug}/${episodeNumbers[0]}`);
        const hasDub = firstEpHtml ? /\bDUB\b/.test(firstEpHtml) : false;

        const episodes = [];
        for (const num of episodeNumbers) {
            const baseHref = `https://animeav1.com/media/${slug}/${num}`;
            episodes.push({ href: baseHref + '?audio=sub', number: num });
            if (hasDub) {
                episodes.push({ href: baseHref + '?audio=dub', number: parseFloat(`${num}.5`) });
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

        const html = await soraFetch(cleanUrl);
        if (!html) return JSON.stringify({ streams: [] });

        // Split into SUB and DUB sections
        let targetSection = html;
        const dubIndex = html.indexOf('\nDUB\n');

        if (isDub && dubIndex !== -1) {
            targetSection = html.substring(dubIndex);
        } else if (!isDub && dubIndex !== -1) {
            targetSection = html.substring(0, dubIndex);
        }

        const streams = [];

        // 1. Direct .mp4 URL
        const mp4Match = targetSection.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
        if (mp4Match) {
            streams.push({
                title: isDub ? 'MP4 (DUB)' : 'MP4 (SUB)',
                streamUrl: mp4Match[0],
                headers: { 'Referer': 'https://animeav1.com/' }
            });
        }

        // 2. Zilla player embed
        const playerMatch = targetSection.match(/https?:\/\/player\.[^\s"'<>]+/);
        if (playerMatch) {
            const playerHtml = await soraFetch(playerMatch[0]);
            if (playerHtml) {
                const playerMp4 = playerHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
                if (playerMp4) {
                    streams.push({
                        title: isDub ? 'Player (DUB)' : 'Player (SUB)',
                        streamUrl: playerMp4[0],
                        headers: { 'Referer': playerMatch[0] }
                    });
                }
                const playerHls = playerHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
                if (playerHls) {
                    streams.push({
                        title: isDub ? 'HLS (DUB)' : 'HLS (SUB)',
                        streamUrl: playerHls[0],
                        headers: { 'Referer': playerMatch[0] }
                    });
                }
            }
        }

        // 3. Iframe fallback
        const iframeMatch = targetSection.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
        if (iframeMatch) {
            const iframeHtml = await soraFetch(iframeMatch[1]);
            if (iframeHtml) {
                const iframeMp4 = iframeHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
                if (iframeMp4) {
                    streams.push({
                        title: isDub ? 'Iframe (DUB)' : 'Iframe (SUB)',
                        streamUrl: iframeMp4[0],
                        headers: { 'Referer': iframeMatch[1] }
                    });
                }
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
