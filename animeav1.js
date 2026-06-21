// AnimeAV1 Sora Module
// Source: https://animeav1.com
// Language: Spanish (SUB + DUB)
// Stream Type: MP4

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const response = await fetchv2(`https://animeav1.com/catalogo?q=${encodedKeyword}`);
        const html = await response.text();

        const results = [];

        // Match each anime block: cover image + title + href together
        // Pattern: cover URL appears just before the title and href in each card
        const cardRegex = /https:\/\/cdn\.animeav1\.com\/covers\/(\d+)\.jpg[\s\S]*?###\s+(.+?)\n[\s\S]*?href="(https:\/\/animeav1\.com\/media\/[^"\/]+)"[^>]*>\s*Ver /g;

        let match;
        while ((match = cardRegex.exec(html)) !== null) {
            const imageId = match[1];
            const title = match[2].trim();
            const href = match[3];

            results.push({
                title: title,
                image: `https://cdn.animeav1.com/covers/${imageId}.jpg`,
                href: href
            });
        }

        if (results.length === 0) {
            return JSON.stringify([{ title: 'No results found', image: '', href: '' }]);
        }

        return JSON.stringify(results);

    } catch (error) {
        console.log('searchResults error:', error);
        return JSON.stringify([{ title: 'Error', image: '', href: '' }]);
    }
}

async function extractDetails(url) {
    try {
        const cleanUrl = url.split('?')[0];
        const response = await fetchv2(cleanUrl);
        const html = await response.text();

        // Description from meta tag
        const descMatch = html.match(/meta-description:\s*([^\n]+)/);
        const description = descMatch ? descMatch[1].trim() : 'No description available';

        // Type
        const typeMatch = html.match(/TV Anime|OVA|Pel[ií]cula|Especial/);
        const type = typeMatch ? typeMatch[0] : 'Anime';

        // Year
        const yearMatch = html.match(/•\s*(\d{4})\s*•/);
        const year = yearMatch ? yearMatch[1] : 'Unknown';

        // Genres
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
        const response = await fetchv2(cleanUrl);
        const html = await response.text();

        const slugMatch = cleanUrl.match(/\/media\/([^\/]+)$/);
        if (!slugMatch) throw new Error('Could not extract slug from URL');
        const slug = slugMatch[1];

        // Collect unique episode numbers
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
        const firstEpResponse = await fetchv2(`https://animeav1.com/media/${slug}/${episodeNumbers[0]}`);
        const firstEpHtml = await firstEpResponse.text();
        const hasDub = /\bDUB\b/.test(firstEpHtml);

        const episodes = [];
        for (const num of episodeNumbers) {
            const baseHref = `https://animeav1.com/media/${slug}/${num}`;
            episodes.push({
                href: baseHref + '?audio=sub',
                number: num
            });
            if (hasDub) {
                episodes.push({
                    href: baseHref + '?audio=dub',
                    number: parseFloat(`${num}.5`)
                });
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

        const response = await fetchv2(cleanUrl);
        const html = await response.text();

        // Split page into SUB and DUB sections
        let targetSection = html;
        const dubIndex = html.indexOf('\nDUB\n');

        if (isDub && dubIndex !== -1) {
            targetSection = html.substring(dubIndex);
        } else if (!isDub && dubIndex !== -1) {
            targetSection = html.substring(0, dubIndex);
        }

        // 1. Direct .mp4 URL
        const mp4Match = targetSection.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
        if (mp4Match) return mp4Match[0];

        // 2. Zilla or other embed player URL
        const playerMatch = targetSection.match(/https?:\/\/player\.[^\s"'<>]+/);
        if (playerMatch) {
            const playerResponse = await fetchv2(playerMatch[0]);
            const playerHtml = await playerResponse.text();

            const playerMp4 = playerHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
            if (playerMp4) return playerMp4[0];

            const playerHls = playerHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
            if (playerHls) return playerHls[0];
        }

        // 3. Any iframe embed
        const iframeMatch = targetSection.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
        if (iframeMatch) {
            const iframeResponse = await fetchv2(iframeMatch[1]);
            const iframeHtml = await iframeResponse.text();

            const iframeMp4 = iframeHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
            if (iframeMp4) return iframeMp4[0];

            const iframeHls = iframeHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
            if (iframeHls) return iframeHls[0];
        }

        console.log('extractStreamUrl: No stream found for', url);
        return null;

    } catch (error) {
        console.log('extractStreamUrl error:', error);
        return null;
    }
}
