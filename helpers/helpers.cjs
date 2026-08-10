const fs = require("fs");
const { createAudioResource } = require("@discordjs/voice");
const ytdlp = require("./ytdlp.cjs");

// Global map to store current playing songs per guild
if (!global.currentSongMap) {
  global.currentSongMap = new Map();
}

// Global map to store loop state per guild
if (!global.loopMap) {
  global.loopMap = new Map();
}

// Clean titles with invalid FileSystem characters like ? or /, and spaces
const sanitizeTitle = (title) => {
  // Replace spaces and characters that are invalid in Windows filenames with '_'
  return title.replace(/[<>:"/\\|?*\x00-\x1F\s]/g, "_");
};

/**
 * Get video info using yt-dlp directly
 * @param {string} url - YouTube video URL
 * @returns {Promise<Object>} Video info object with title, description, author, duration, views
 */
const getVideoInfo = async (url) => {
  const info = await ytdlp.getVideoInfoRaw(url);
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
 * Get playlist info using yt-dlp directly
 * @param {string} url - YouTube playlist URL
 * @returns {Promise<Object>} Playlist info object with title and entries
 */
const getPlaylistInfo = async (url) => {
  const info = await ytdlp.getPlaylistInfoRaw(url);
  return {
    title: info.title,
    entries: info.entries || [],
  };
};

const isUnavailable = async (track) => {
  const title = track.title?.toLowerCase() || "";
  if (title.includes("private video") || title.includes("deleted video")) {
    return true;
  } else {
    return false;
  }
  // try {
  //   await getVideoInfo(track.url);
  //   return false;
  // } catch (err) {
  //   console.log("*** isUnavailable error", err.message || err, " - ", track.title);
  //   return true;
  // }
};

const handlePlaylist = async (args, message, player, connection, guildQueue) => {
  if (!args[1] || !args[1].includes("/playlist")) return message.channel.send({ content: `Please provide a playlist link` });

  let ytdlPlaylist;
  try {
    const output = await ytdlp.getPlaylistInfoRaw(args[1]);
    console.log("*** handlePlaylist output", output);

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

/**
 * Play the next available song in the queue, automatically skipping any
 * tracks that fail to resolve/download (404, removed, private, region-blocked,
 * age-gated, etc.) so a single bad entry never stalls playback.
 *
 * @returns {Promise<boolean>} true if a track started playing, false if the
 *          queue was exhausted without finding a playable track.
 */
const playNext = async (player, connection, message, guildQueue) => {
  const guildId = message.guild.id;
  if (!global.currentSongMap) global.currentSongMap = new Map();

  while (guildQueue.length > 0) {
    const next = guildQueue.shift();
    const nextUrl = next?.url;
    if (!nextUrl) continue;

    try {
      const info = await getVideoInfo(nextUrl);
      const nextTitle = info.title;
      const fileSafeTitle = sanitizeTitle(nextTitle);

      await ytdlp.downloadAudio(nextUrl, `./yt-dl-output/${fileSafeTitle}.%(ext)s`);

      const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;
      if (!fs.existsSync(audioFile) || fs.statSync(audioFile).size === 0) {
        throw new Error("downloaded audio file is missing or empty");
      }

      const resource = createAudioResource(audioFile);
      // The player stays subscribed across tracks; only (re)subscribe when a
      // fresh connection is supplied (manual play/skip entry points).
      if (connection) connection.subscribe(player);
      player.play(resource);

      global.currentSongMap.set(guildId, { url: nextUrl, title: nextTitle });
      message.channel.send({ content: `Now playing: ***${nextTitle}***` });
      return true;
    } catch (err) {
      // Unavailable track: log it and keep looping to the next queue entry
      // instead of stalling playback.
      console.log("*** Skipping unavailable track:", next?.title || nextUrl, "-", err.message || err);
    }
  }

  // Queue exhausted without a playable track.
  global.currentSongMap.delete(guildId);
  return false;
};

const handlePlay = async (args, videoTitle, message, player, connection, guildQueue) => {
  if (!args[1]) return message.channel.send({ content: `Please provide a song` });

  // Handle null videoTitle (failed to fetch info)
  if (!videoTitle) {
    return message.channel.send({ content: `Error: Could not fetch video information. The video may be unavailable or restricted.` });
  }

  const fileSafeTitle = sanitizeTitle(videoTitle);
  // Download video as audio file using yt-dlp directly
  try {
    await ytdlp.downloadAudio(args[1], `./yt-dl-output/${fileSafeTitle}.%(ext)s`, { forceIpv4: true });

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
  } catch (err) {
    console.log("*** Error downloading audio:", err);
    // message.channel.send({ content: `Error downloading audio: ${err}` });
  }
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

  if (skippedTitle) {
    message.channel.send({ content: `Skipped: ***${skippedTitle}***` });
  }

  // playNext walks the queue, skipping any unavailable tracks, so a bad entry
  // never leaves playback stalled.
  const started = await playNext(player, connection, message, guildQueue);
  if (!started) {
    message.channel.send({ content: `There are no more playable songs in the queue!` });
  }
};
const handleLoop = (channel, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });

  const guildId = message.guild.id;
  const currentLoop = global.loopMap.get(guildId) || false;
  const newLoopState = !currentLoop;

  global.loopMap.set(guildId, newLoopState);

  const currentSong = global.currentSongMap.get(guildId);
  if (newLoopState && currentSong) {
    message.channel.send({ content: `🔂 Now looping: ***${currentSong.title}***` });
  } else if (newLoopState) {
    message.channel.send({ content: `🔂 Loop enabled` });
  } else {
    message.channel.send({ content: `➡️ Loop disabled` });
  }
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

    // Discord caps message content at 2000 characters. The description is the
    // only unbounded field, so build the message and, if it overflows, trim the
    // description just enough to fit while keeping the code block closed.
    const DISCORD_LIMIT = 2000;

    const buildMessage = (description) => {
      const songData = {
        title: info.title,
        url: currentSong.url,
        description,
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
      return `**Current Song Info:**\n ${msg}`;
    };

    let content = buildMessage(info.description);

    if (content.length > DISCORD_LIMIT) {
      const ellipsis = "…";
      // Removing N raw description chars removes at least N chars of output
      // (JSON escaping only ever adds length), so trim by the overflow plus a
      // small margin for the ellipsis to guarantee we land under the limit.
      const overflow = content.length - DISCORD_LIMIT;
      const keep = Math.max(0, (info.description?.length || 0) - overflow - ellipsis.length - 8);
      content = buildMessage((info.description || "").slice(0, keep).trimEnd() + ellipsis);

      // Final safety net for the edge case where description isn't the culprit:
      // hard-clamp while preserving the closing code fence.
      if (content.length > DISCORD_LIMIT) {
        const fence = "\n}```";
        content = content.slice(0, DISCORD_LIMIT - fence.length) + fence;
      }
    }

    message.channel.send({ content });
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

// Re-export debugCookieAuth from the ytdlp utility module
const { debugCookieAuth } = ytdlp;

module.exports = {
  sanitizeTitle,
  getVideoInfo,
  getPlaylistInfo,
  isUnavailable,
  debugCookieAuth,
  playNext,
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
