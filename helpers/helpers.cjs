const fs = require("fs");
const youtubedl = require("youtube-dl-exec");
const { createAudioResource } = require("@discordjs/voice");
const ytstream = require("yt-stream");

// Global map to store current playing songs per guild
if (!global.currentSongMap) {
  global.currentSongMap = new Map();
}

// Clean titles with invalid FileSystem characters like ? or /.
const sanitizeTitle = (title) => {
  // Replace characters that are invalid in Windows filenames with '-'
  return title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
};

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";
// const userAgent =
//   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const isUnavailable = async (track) => {
  let hasError = false;
  if (track.title.includes("Private video") && track.title.includes("Deleted video")) {
    return true;
  } else {
    try {
      await ytstream.getInfo(track.url).catch((err) => {
        console.log("*** isUnavailable error", err, " - ", track.title);
        hasError = true;
      });
    } catch (err) {
      hasError = true;
    }
  }
  return hasError;
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
      forceIpv6: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      cookiesFromBrowser: "firefox",
      extractorArgs: "youtubetab:skip=authcheck",
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

  const fileSafeTitle = sanitizeTitle(videoTitle);
  // Download video as audio file
  await youtubedl(args[1], {
    extractAudio: true,
    audioFormat: "mp3",
    output: `./yt-dl-output/${fileSafeTitle}.%(ext)s`, // Saves to root directory with video title as filename
    noCheckCertificates: true,
    cookiesFromBrowser: "firefox",
    extractorArgs: "youtubetab:skip=authcheck",
    noWarnings: true,
    addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
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
      message.channel.send({ content: `Error downloading audio: ${err}` });
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
    const info = await ytstream.getInfo(nextSong);
    const nextTitle = info.title;
    const fileSafeTitle = sanitizeTitle(nextTitle);

    await youtubedl(nextSong, {
      extractAudio: true,
      audioFormat: "mp3",
      output: `./yt-dl-output/${fileSafeTitle}.%(ext)s`,
      noCheckCertificates: true,
      cookiesFromBrowser: "firefox",
      extractorArgs: "youtubetab:skip=authcheck",
      noWarnings: true,
      addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
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

    // Get full song info
    const info = await ytstream.getInfo(currentSong.url);

    // Format duration
    function encodeDuration(millis) {
      var minutes = Math.floor(millis / 60000);
      var seconds = ((millis % 60000) / 1000).toFixed(0);
      return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }

    const songData = {
      title: info.title,
      url: currentSong.url,
      description: info.description,
      author: info.author || "Unknown",
      duration: encodeDuration(info.duration || 0),
      views: info.views || 0,
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

module.exports = {
  sanitizeTitle,
  isUnavailable,
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
