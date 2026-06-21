// AnimeAV1 Sora Module
// Source: https://animeav1.com
// Language: Spanish (SUB + DUB)
// Stream Type: MP4 (with fallback to HLS player embed)

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const response = await fetchv2(`https://animeav1.com/catalogo?q=${encodedKeyword}`);
        const html = await response.text();

        const results = [];

        // Parse cover image IDs
        const covers = [];
        const coverRegex = /https:\/\/cdn\.animeav1\.com\/covers\/(\d+)\.jpg/g;
        let coverMatch;
        while ((coverMatch = coverRegex.exec(html)) !== null) {
            covers.push(`https://cdn.animeav1.com/covers/${coverMatch[1]}.jpg`);
        }

        // Parse titles from ### headings
        const titles = [];
        const titleRegex = /###\s+(.+?)\n/g;
        let titleMatch;
        while ((titleMatch = titleRegex.exec(html)) !== null) {
            titles.push(titleMatch[1].trim());
        }

        // Parse hrefs — only catalog-level links (not episode links)
        const hrefs = [];
        const linkRegex = /href="(https:\/\/animeav1\.com\/media\/([^"\/]+))"[^>]*>\s*Ver [^<]+<\/a>/g;
        let linkMatch;
        while ((linkMatch = linkRegex.exec(html)) !== null) {
            hrefs.push(linkMatch[1]);
        }

        const len = Math.min(titles.length, hrefs.length, covers.length);
        for (let i = 0; i < len; i++) {
            results.push({
                title: titles[i],
                image: covers[i],
                href: hrefs[i]
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
        // Strip any ?audio= suffix before fetching
        const cleanUrl = url.split('?')[0];
        const response = await fetchv2(cleanUrl);
        const html = await response.text();

        const descMatch = html.match(/meta-description:\s*(.+)/);
        const description = descMatch
            ? descMatch[1].trim()
            : 'No description available';

        const typeMatch = html.match(/TV Anime|OVA|Película|Especial/);
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
        const response = await fetchv2(cleanUrl);
        const html = await response.text();

        const slugMatch = cleanUrl.match(/\/media\/([^\/]+)$/);
        if (!slugMatch) throw new Error('Could not extract slug from URL');
        const slug = slugMatch[1];

        // Collect unique episode numbers from links
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

        // Check if this anime has DUB available by fetching episode 1
        // and looking for the DUB section in the page
        const firstEpResponse = await fetchv2(`https://animeav1.com/media/${slug}/${episodeNumbers[0]}`);
        const firstEpHtml = await firstEpResponse.text();
        const hasDub = /\bDUB\b/.test(firstEpHtml);

        const episodes = [];
        for (const num of episodeNumbers) {
            const baseHref = `https://animeav1.com/media/${slug}/${num}`;
            // Always include SUB
            episodes.push({
                href: baseHref + '?audio=sub',
                number: num
            });
            // Include DUB as a second entry (e.g. episode 1 → "1", dub episode 1 → "1 (DUB)")
            if (hasDub) {
                episodes.push({
                    href: baseHref + '?audio=dub',
                    number: parseFloat(`${num}.5`) // offset to keep sort order; Sora displays the number field
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
        // Determine audio preference from the query param we added
        const isDub = url.includes('?audio=dub');
        const cleanUrl = url.split('?')[0];

        const response = await fetchv2(cleanUrl);
        const html = await response.text();

        // The page has two sections: SUB and DUB, each followed by player links.
        // Split on the DUB section marker so we can target the right block.
        let targetSection = html;

        if (isDub) {
            // Find the DUB block — it comes after the SUB block
            const dubIndex = html.indexOf('\nDUB\n');
            if (dubIndex !== -1) {
                targetSection = html.substring(dubIndex);
            }
        } else {
            // Use only the SUB block (everything before the DUB section)
            const dubIndex = html.indexOf('\nDUB\n');
            if (dubIndex !== -1) {
                targetSection = html.substring(0, dubIndex);
            }
        }

        // 1. Try to find a direct .mp4 URL in the target section
        const mp4Match = targetSection.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
        if (mp4Match) {
            return mp4Match[0];
        }

        // 2. Try to find a zilla-networks or similar embed player URL
        const playerMatch = targetSection.match(/https?:\/\/player\.[^\s"'<>]+/);
        if (playerMatch) {
            const playerUrl = playerMatch[0];
            const playerResponse = await fetchv2(playerUrl);
            const playerHtml = await playerResponse.text();

            // Look for mp4 inside the player page
            const playerMp4 = playerHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
            if (playerMp4) return playerMp4[0];

            // Fallback: look for an HLS .m3u8 inside the player page
            const playerHls = playerHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
            if (playerHls) return playerHls[0];
        }

        // 3. Fallback: look for any iframe embed in the section
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
