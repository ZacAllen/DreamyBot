const fs = require("fs");
const youtubedl = require("youtube-dl-exec");
const { createAudioResource } = require("@discordjs/voice");

// Global map to store current playing songs per guild
if (!global.currentSongMap) {
  global.currentSongMap = new Map();
}

// Clean titles with invalid FileSystem characters like ? or /.
const sanitizeTitle = (title) => {
  // Replace characters that are invalid in Windows filenames with '-'
  return title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
};

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0";

/**
 * Get video info using youtube-dl-exec
 * @param {string} url - YouTube video URL
 * @returns {Promise<Object>} Video info object with title, description, author, duration, views
 */
const getVideoInfo = async (url) => {
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    cookiesFromBrowser: "firefox",
    // Let yt-dlp use default client with automatic fallbacks
    // Only skip auth check for tabs/playlists
    extractorArgs: "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
    addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
  });
  console.log("*** getVideoInfo info", info.title);
  return {
    title: info.title,
    description: info.description || "",
    author: info.uploader || info.channel || "Unknown",
    duration: (info.duration || 0) * 1000, // Convert seconds to milliseconds for consistency
    views: info.view_count || 0,
    url: info.webpage_url || url,
  };
};

/**
 * Get playlist info using youtube-dl-exec
 * @param {string} url - YouTube playlist URL
 * @returns {Promise<Object>} Playlist info object with title and entries
 */
const getPlaylistInfo = async (url) => {
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    yesPlaylist: true,
    flatPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
    cookiesFromBrowser: "firefox",
    extractorArgs: "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
    addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
  });
  return {
    title: info.title,
    entries: info.entries || [],
  };
};

const isUnavailable = async (track) => {
  if (track.title.includes("Private video") || track.title.includes("Deleted video")) {
    return true;
  }
  try {
    await getVideoInfo(track.url);
    return false;
  } catch (err) {
    console.log("*** isUnavailable error", err.message || err, " - ", track.title);
    return true;
  }
};

const handlePlaylist = async (args, message, player, connection, guildQueue) => {
  if (!args[1] || !args[1].includes("/playlist")) return message.channel.send({ content: `Please provide a playlist link` });

  let ytdlPlaylist;
  try {
    const output = await youtubedl(args[1], {
      dumpSingleJson: true,
      yesPlaylist: true,
      flatPlaylist: true,
      skipUnavailableFragments: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      cookiesFromBrowser: "firefox",
      extractorArgs: "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
      addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
    });

    const availability = await Promise.all(output.entries.map((track) => isUnavailable(track)));
    ytdlPlaylist = output.entries.filter((track, index) => availability[index] === false);
  } catch (err) {
    console.log("Error fetching playlist:", err);
    return message.channel.send({ content: "Error fetching playlist details." });
  }

  if (ytdlPlaylist.length === 0) {
    return message.channel.send({ content: `No valid songs found in playlist` });
  }

  const wasPlaying = player.state.status === "playing";
  ytdlPlaylist.forEach((song) => guildQueue.push({ url: song.url, title: song.title }));
  message.channel.send({ content: `Added ${ytdlPlaylist.length} songs to queue` });

  if (!wasPlaying) {
    const channel = message.member.voice.channel;
    if (channel) {
      try {
        await handleSkip(channel, player, connection, message, guildQueue);
      } catch (err) {
        console.log("Error in playing from queue:", err);
        message.channel.send({ content: `Error playing next song: ${err.message}` });
      }
    }
  }
};

const handlePlay = async (args, videoTitle, message, player, connection, guildQueue) => {
  if (!args[1]) return message.channel.send({ content: `Please provide a song` });

  // Handle null videoTitle (failed to fetch info)
  if (!videoTitle) {
    return message.channel.send({ content: `Error: Could not fetch video information. The video may be unavailable or restricted.` });
  }

  const fileSafeTitle = sanitizeTitle(videoTitle);
  // Download video as audio file
  await youtubedl(args[1], {
    extractAudio: true,
    audioFormat: "mp3",
    output: `./yt-dl-output/${fileSafeTitle}.%(ext)s`, // Saves to root directory with video title as filename
    noCheckCertificates: true,
    forceIpv4: true,
    cookiesFromBrowser: "firefox",
    extractorArgs: "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
    noWarnings: true,
    addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
    retries: 3,
    format: "bestaudio/best",
  })
    .then((output) => {
      // If player is already playing, add to queue instead
      if (player.state.status === "playing") {
        guildQueue.push({ url: args[1], title: videoTitle });
        message.channel.send({ content: `Added ***${videoTitle}*** to queue. Position: ${guildQueue.length}` });
        return;
      } else {
        message.channel.send({ content: `Now playing: ***${videoTitle}***` });
      }

      const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;
      const resource = createAudioResource(audioFile);
      player.play(resource);
      connection.subscribe(player);
      // Store current song info
      global.currentSongMap.set(message.guild.id, {
        url: args[1],
        title: videoTitle,
      });
    })
    .catch((err) => {
      console.log("*** Error downloading audio:", err);
      // message.channel.send({ content: `Error downloading audio: ${err}` });
    });
};

const handlePause = (channel, player, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });
  player.pause();
  message.channel.send({ content: `Player paused.` });
};

const handleResume = (channel, player, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });
  player.unpause();
  message.channel.send({ content: `Resuming playback.` });
};

const handleSkip = async (channel, player, connection, message, guildQueue) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });
  if (!guildQueue || guildQueue.length === 0) {
    return message.channel.send({
      content: `There are no more songs in the queue!`,
    });
  }
  const skippedTitle = global.currentSongMap.get(message.guild.id)?.title;
  const nextSong = guildQueue.shift()?.url;

  if (!nextSong) {
    return message.channel.send({ content: "Queue is empty or song has no URL." });
  }

  try {
    const info = await getVideoInfo(nextSong);
    const nextTitle = info.title;
    const fileSafeTitle = sanitizeTitle(nextTitle);

    await youtubedl(nextSong, {
      extractAudio: true,
      audioFormat: "mp3",
      output: `./yt-dl-output/${fileSafeTitle}.%(ext)s`,
      noCheckCertificates: true,
      cookiesFromBrowser: "firefox",
      extractorArgs: "youtubetab:skip=authcheck,youtube:player_client=default,-android_sdkless",
      noWarnings: true,
      addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
      retries: 3,
      format: "bestaudio/best",
    });

    const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;
    const resource = createAudioResource(audioFile);

    // Subscribe player to connection before playing
    connection.subscribe(player);
    player.play(resource);

    global.currentSongMap.set(message.guild.id, {
      url: nextSong,
      title: nextTitle,
    });

    if (skippedTitle) {
      message.channel.send({ content: `Skipped: ***${skippedTitle}***` });
    }
    message.channel.send({ content: `Now playing: ***${nextTitle}***` });
  } catch (err) {
    console.error("Error in handleSkip:", err);
    message.channel.send({ content: `Error playing next song: ${err.message}` });
  }
};
// TODO ---------------------------------------------------------------------------------------------------------------
const handleLoop = (channel, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });
};

const handleStop = (channel, player, connection, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });
  player.stop();
  connection.destroy();
  // Clear current song when stopping
  global.currentSongMap.delete(message.guild.id);
  message.channel.send({ content: `Playback stopped!` });
};

const handleQueue = (channel, message, guildQueue) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });

  if (!guildQueue || guildQueue.length === 0) {
    return message.channel.send({
      content: `There is no queue!`,
    });
  }
  // Create numbered list of songs in queue
  let queueList = guildQueue.map((song, index) => `${index + 1}. ${song.title}`).join("\n");
  // Discord embed has a max length of 6000 characters
  // If queue list is too long, truncate it and add a message
  if (queueList.length > 4000) {
    // Leave room for embed title, footer etc
    const truncatedList = queueList.slice(0, 4000);
    // Find the last complete song entry by looking for last newline
    const lastNewline = truncatedList.lastIndexOf("\n");
    queueList = truncatedList.slice(0, lastNewline);
    queueList += "\n...";
  }

  // Create embed message
  const queueEmbed = {
    color: 0x0099ff, // Blue color
    title: "🎵  Current Queue  🎵",
    description: queueList,
    footer: {
      text: `${guildQueue.length} songs in queue`,
    },
    timestamp: new Date(),
  };

  return message.channel.send({ embeds: [queueEmbed] });
};
// TODO ---------------------------------------------------------------------------------------------------------------
const handleVolume = (channel, args, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });
  if (!args[1]) return message.channel.send({ content: `Please provide the volume` });
  if (Number(args[1]) < 1 || Number(args[1]) > 10)
    return message.channel.send({
      content: `Please provide a volume between 1-10`,
    });
};

const handleCurrent = async (channel, message, guildQueue) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });

  try {
    // Get current song from our global map
    const currentSong = global.currentSongMap.get(message.guild.id);

    if (!currentSong) {
      return message.channel.send({
        content: `There is currently nothing playing!`,
      });
    }

    // Get full song info using youtube-dl-exec
    const info = await getVideoInfo(currentSong.url);

    // Format duration (info.duration is already in milliseconds from getVideoInfo)
    function encodeDuration(millis) {
      var minutes = Math.floor(millis / 60000);
      var seconds = ((millis % 60000) / 1000).toFixed(0);
      return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }

    const songData = {
      title: info.title,
      url: currentSong.url,
      description: info.description,
      author: info.author,
      duration: encodeDuration(info.duration),
      views: info.views,
    };

    // Format the output
    var msg = "```json\n{";
    for (var key in songData) {
      if (songData.hasOwnProperty(key)) {
        msg = msg + "\n " + key + ": " + JSON.stringify(songData[key], null, " ") + ",";
      }
    }
    msg = msg.substring(0, msg.length - 1);
    msg = msg + "\n}```";

    message.channel.send({ content: `**Current Song Info:**\n ${msg}` });
  } catch (err) {
    console.log("*** Get current song error:", err);
    message.channel.send({
      content: `There was an error getting the current song.`,
    });
  }
};

const handleShuffle = (channel, message, guildQueue) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });

  if (!guildQueue || guildQueue.length === 0) {
    return message.channel.send({
      content: `The queue is empty!`,
    });
  }

  // Fisher-Yates? Probably outsource to a real libarary later
  for (let i = guildQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [guildQueue[i], guildQueue[j]] = [guildQueue[j], guildQueue[i]];
  }

  message.channel.send({
    content: `The queue has successfully been shufffled`,
  });
};

const handleClear = (channel, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is no queue!`,
    });
  try {
    const guildId = message.guild.id;
    const guildQueue = global.songQueue.get(guildId);

    if (!guildQueue || guildQueue.length === 0) {
      return message.channel.send({
        content: "The queue is already empty.",
      });
    }
    // Clear the queue by setting global songqueue to empty array
    global.songQueue.set(guildId, []);
    message.channel.send({
      content: `The queue has successfully been cleared`,
    });
  } catch (err) {
    message.channel.send({
      content: `There was an error clearing the queue ${err || (err.message ?? "")}`,
    });
  }
};

/**
 * Debug helper to check which YouTube account's cookies are being used.
 * Attempts to fetch subscription feed (requires auth) and logs account info.
 * @returns {Promise<Object|null>} Account info or null if not authenticated
 */
const debugCookieAuth = async () => {
  console.log("\n========== COOKIE AUTH DEBUG ==========");
  console.log("Attempting to verify YouTube authentication...\n");

  try {
    // First, try to get info about a regular video to see raw cookie/auth data
    const testVideoUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw"; // "Me at the zoo" - first YT video
    const videoInfo = await youtubedl(testVideoUrl, {
      dumpSingleJson: true,
      verbose: true,
      noCheckCertificates: true,
      cookiesFromBrowser: "firefox",
      addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
    });

    console.log("\n--- Video Info Retrieved ---");
    console.log("Video Title:", videoInfo.title);
    console.log("Channel:", videoInfo.channel || videoInfo.uploader || "Unknown");

    // Try to access subscription feed - this requires authentication
    try {
      const subFeed = await youtubedl("https://www.youtube.com/feed/subscriptions", {
        dumpSingleJson: true,
        flatPlaylist: true,
        playlistEnd: 3, // Just get first 3 items to check auth
        noCheckCertificates: true,
        cookiesFromBrowser: "firefox",
        addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
      });

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
      console.log("\nTip: Try specifying a profile: cookiesFromBrowser: 'firefox:profile-name'");
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
  sanitizeTitle,
  getVideoInfo,
  getPlaylistInfo,
  isUnavailable,
  debugCookieAuth,
  handlePlaylist,
  handlePlay,
  handlePause,
  handleResume,
  handleSkip,
  handleLoop,
  handleStop,
  handleQueue,
  handleVolume,
  handleCurrent,
  handleShuffle,
  handleClear,
};
