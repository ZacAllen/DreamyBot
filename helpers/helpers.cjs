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

  let ytdlPlaylist = [];
  await youtubedl(args[1], {
    dumpSingleJson: true,
    yesPlaylist: true,
    flatPlaylist: true,
    skipUnavailableFragments: true,
    forceIpv6: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    cookiesFromBrowser: "firefox",
    addHeader: ["referer:youtube.com", "user-agent:googlebot"],
  })
    .then(async (output) => {
      let newArray = []; //create new array for filtered songs
      // resolve all ytstream song checks (ytdl cannot verify if video is unavailable consistently)
      await Promise.all(
        output.entries.map((track) => {
          return isUnavailable(track);
        })
      )
        .then((result) => {
          if (result) {
            newArray = output.entries.filter((track, index) => result[index] === false);
          }
        })
        .catch((err) => {
          console.log("*** PromiseErr", err);
        });
      ytdlPlaylist = newArray;
    })
    .catch((err) => console.log(err));

  if (ytdlPlaylist.length === 0) {
    return message.channel.send({ content: `No valid songs found in playlist` });
  }

  const firstSong = ytdlPlaylist[0];
  const fileSafePLTitle = sanitizeTitle(firstSong.title);

  // Download and play first song
  await youtubedl(firstSong.url, {
    extractAudio: true,
    audioFormat: "mp3",
    output: `./yt-dl-output/${fileSafePLTitle}.%(ext)s`,
    noCheckCertificates: true,
    noWarnings: true,
  })
    .then((output) => {
      const audioFile = `./yt-dl-output/${fileSafePLTitle}.mp3`;
      const resource = createAudioResource(audioFile);

      // If already playing, add all songs to queue
      if (player.state.status === "playing") {
        ytdlPlaylist.forEach((song) => guildQueue.push({ url: song.url, title: firstSong.title }));
        message.channel.send({ content: `Added ${ytdlPlaylist.length} songs to queue` });
        return;
      }

      // Play first song and add rest to queue
      player.play(resource);
      connection.subscribe(player);
      // Store current song info
      global.currentSongMap.set(message.guild.id, {
        url: firstSong.url,
        title: firstSong.title,
      });
      message.channel.send({ content: `Now playing: ***${firstSong.title}***` });

      // Add remaining songs to queue
      for (let i = 1; i < ytdlPlaylist.length; i++) {
        guildQueue.push({ url: ytdlPlaylist[i].url, title: ytdlPlaylist[i].title });
      }

      if (ytdlPlaylist.length > 1) {
        message.channel.send({ content: `Added ${ytdlPlaylist.length - 1} more songs to queue` });
      }
    })
    .catch((err) => {
      message.channel.send({ content: `Error playing playlist: ${err}` });
    });
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
    noWarnings: true,
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

const handleSkip = async (channel, player, message, guildQueue) => {
  if (!channel)
    return message.channel.send({
      content: `There is currently nothing playing!`,
    });
  if (!guildQueue || guildQueue.length === 0) {
    return message.channel.send({
      content: `There are no more songs in the queue!`,
    });
  }

  const nextSong = guildQueue.shift()?.url;
  const nextTitle = await ytstream.getInfo(nextSong).then((info) => {
    return info.title;
  });
  const fileSafeTitle = sanitizeTitle(nextTitle);
  await youtubedl(nextSong, {
    extractAudio: true,
    audioFormat: "mp3",
    output: `./yt-dl-output/${fileSafeTitle}.%(ext)s`,
    noCheckCertificates: true,
    noWarnings: true,
  })
    .then((output) => {
      const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;
      const resource = createAudioResource(audioFile);
      player.play(resource);
      // Update current song
      global.currentSongMap.set(message.guild.id, {
        url: nextSong,
        title: nextTitle,
      });
      message.channel.send({ content: `Now playing: ***${nextTitle}***` });
    })
    .catch((err) => {
      message.channel.send({ content: `Error playing next song: ${err}` });
    });
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

// TODO ---------------------------------------------------------------------------------------------------------------
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
// TODO ---------------------------------------------------------------------------------------------------------------
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
// TODO ---------------------------------------------------------------------------------------------------------------
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
// TODO ---------------------------------------------------------------------------------------------------------------
const handleClear = (channel, message) => {
  if (!channel)
    return message.channel.send({
      content: `There is no queue!`,
    });
  message.channel.send({
    content: `The queue has successfully been cleared`,
  });
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
