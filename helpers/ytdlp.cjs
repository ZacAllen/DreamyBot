const { spawn } = require("child_process");

/**
 * Run yt-dlp with the given arguments and return stdout output
 * @param {string[]} args - Command line arguments for yt-dlp
 * @returns {Promise<string>} stdout output from yt-dlp
 */
function runYtdlp(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn("yt-dlp", args, {
            shell: true, // Required for Windows compatibility
        });
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
            stdout += data;
        });

        proc.stderr.on("data", (data) => {
            stderr += data;
        });

        proc.on("error", (err) => {
            reject(new Error(`Failed to start yt-dlp: ${err.message}`));
        });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                console.log("*** stderr", stderr);
                reject(new Error(stderr || `yt-dlp exited with code ${code}`));
            }
        });
    });
}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0";

/**
 * Get video info using yt-dlp
 * @param {string} url - YouTube video URL
 * @returns {Promise<Object>} Raw video info object from yt-dlp
 */
const getVideoInfoRaw = async (url) => {
    const args = [
        "--dump-single-json",
        "--no-warnings",
        "--no-check-certificates",
        // "--cookies-from-browser", "firefox",
        "--extractor-args", "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
        "--add-header", `referer:youtube.com`,
        "--add-header", `user-agent:"${userAgent}"`,
        `"${url}"`,
    ];

    // Log the full command as it would appear on the command line
    console.log("*** yt-dlp command:\nyt-dlp " + args.join(" "));

    const output = await runYtdlp(args);
    return JSON.parse(output);
};

/**
 * Get playlist info using yt-dlp
 * @param {string} url - YouTube playlist URL
 * @returns {Promise<Object>} Raw playlist info object from yt-dlp
 */
const getPlaylistInfoRaw = async (url) => {
    const output = await runYtdlp([
        "--dump-single-json",
        "--yes-playlist",
        "--flat-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--cookies-from-browser", "firefox",
        "--extractor-args", "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
        "--add-header", `referer:youtube.com`,
        "--add-header", `user-agent:"${userAgent}"`,
        `"${url}"`,
    ]);
    return JSON.parse(output);
};

/**
 * Download audio from a URL using yt-dlp
 * @param {string} url - Video URL to download
 * @param {string} outputTemplate - Output path template (e.g., "./yt-dl-output/%(title)s.%(ext)s")
 * @param {Object} options - Additional options
 * @returns {Promise<void>}
 */
const downloadAudio = async (url, outputTemplate, options = {}) => {
    const args = [
        "--extract-audio",
        "--audio-format", "mp3",
        "-o", outputTemplate,
        "--no-check-certificates",
        // "--cookies-from-browser", "firefox",
        "--extractor-args", "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
        "--no-warnings",
        "--add-header", `referer:youtube.com`,
        "--add-header", `user-agent:"${userAgent}"`,
        "--retries", "3",
        "--format", "bestaudio/best",
    ];

    if (options.forceIpv4) {
        args.push("--force-ipv4");
    }

    args.push(`"${url}"`);

    await runYtdlp(args);
};

/**
 * Debug helper to check YouTube authentication via cookies
 * @returns {Promise<Object|null>} Account info or null if not authenticated
 */
const debugCookieAuth = async () => {
    console.log("\n========== COOKIE AUTH DEBUG ==========");
    console.log("Attempting to verify YouTube authentication...\n");

    try {
        // First, try to get info about a regular video to see raw cookie/auth data
        const testVideoUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw"; // "Me at the zoo" - first YT video
        const videoInfo = await getVideoInfoRaw(testVideoUrl);

        console.log("\n--- Video Info Retrieved ---");
        console.log("Video Title:", videoInfo.title);
        console.log("Channel:", videoInfo.channel || videoInfo.uploader || "Unknown");

        // Try to access subscription feed - this requires authentication
        try {
            const output = await runYtdlp([
                "--dump-single-json",
                "--flat-playlist",
                "--playlist-end", "3",
                "--no-check-certificates",
                "--cookies-from-browser", "firefox",
                "--add-header", `referer:youtube.com`,
                "--add-header", `user-agent:"${userAgent}"`,
                "https://www.youtube.com/feed/subscriptions",
            ]);
            const subFeed = JSON.parse(output);

            console.log("\n--- Subscription Feed Access: SUCCESS ---");
            console.log("You ARE authenticated with YouTube cookies!");
            console.log("Subscriptions found:", subFeed.entries?.length || 0, "items");

            if (subFeed.entries && subFeed.entries.length > 0) {
                console.log("Recent subscription videos:");
                subFeed.entries.slice(0, 3).forEach((entry, i) => {
                    console.log(`  ${i + 1}. ${entry.title} (${entry.channel || entry.uploader || "Unknown channel"})`);
                });
            }

            console.log("\n========================================\n");
            return {
                authenticated: true,
                subscriptionCount: subFeed.entries?.length || 0,
                recentSubscriptions: subFeed.entries?.slice(0, 3) || [],
            };
        } catch (subErr) {
            console.log("\n--- Subscription Feed Access: FAILED ---");
            console.log("You are NOT authenticated or cookies are invalid.");
            console.log("Error:", subErr.message || subErr);
            console.log("\nPossible reasons:");
            console.log("  1. Firefox is not logged into YouTube");
            console.log("  2. Cookies have expired");
            console.log("  3. Wrong Firefox profile is being used");
            console.log("\nTip: Try specifying a profile: --cookies-from-browser 'firefox:profile-name'");
            console.log("\n========================================\n");
            return {
                authenticated: false,
                error: subErr.message || subErr,
            };
        }
    } catch (err) {
        console.log("\n--- CRITICAL ERROR ---");
        console.log("Failed to connect to YouTube at all.");
        console.log("Error:", err.message || err);
        console.log("\n========================================\n");
        return null;
    }
};

module.exports = {
    runYtdlp,
    userAgent,
    getVideoInfoRaw,
    getPlaylistInfoRaw,
    downloadAudio,
    debugCookieAuth,
};

