require("dotenv").config(); //to start process from .env file
const fs = require("fs");
const youtubedl = require("youtube-dl-exec");
// const { Player } = require("discordaudio");
const { createAudioPlayer, NoSubscriberBehavior, createAudioResource, joinVoiceChannel } = require("@discordjs/voice");
const path = require("path");
const cookies = require("./cookies.json");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");
const { AudioManager } = require("discordaudio");
const { EmbedBuilder } = require("discord.js");
const ytstream = require("yt-stream");
const wiki = require("wikipedia");

// Load imageV2 module, i.e. non-commonjs
const loadImageV2 = async () => {
  let command;
  await import("./commands/utility/imageV2.js")
    .then((module) => {
      command = module.default;
    })
    .catch((error) => {
      console.error("Failed to import module:", error);
    });
  return command;
};

ytstream.setApiKey(process.env.YT_API_KEY); // Only sets the api key
ytstream.setPreference("api", "ANDROID"); // Tells the package to use the api and use a web client for requests

// ytstream.setPreference("scrape", "ANDROID"); // Tells the package to use the scrape methods instead of the api, even if an api key has been provided

ytstream.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0";
// ytstream.userAgent =
//   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const agent = new ytstream.YTStreamAgent(cookies, {
  keepAlive: true,
  keepAliveMsecs: 5e3,
  // localAddress: "2600:1700:37b0:c60::44",
  // localAddress: "127.0.0.1",
});

// agent.syncFile(path.join(__dirname, `./cookies.json`)); // This is an absolute path which will always work
agent.syncFile(`./cookies.json`); // This is a relative path which will only work if the cookies.json file is inside the root folder of the process

ytstream.setGlobalAgent(agent);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, //adds server functionality
    GatewayIntentBits.GuildMessages, //gets messages from our bot.
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// attaching a .commands property to the client instance so that we can access commands in other files
client.commands = new Collection();

const foldersPath = path.join(__dirname, "commands"); //find path to commands folder and files
const commandFolders = fs.readdirSync(foldersPath);

async function defineCommands() {
  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js") || file.endsWith(".cjs")); //filter non js files
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      //* Create exception for ImageV2, if ever have more than one ES6 command, create array to select from?
      const command = file.endsWith(".cjs") ? require(filePath) : await loadImageV2();
      // Set a new item in the Collection with the key as the command name and the value as the exported module
      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
      } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
      }
    }
  }
}

defineCommands();

// Reading event files
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".cjs"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
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

// --------------------------------------------------MUSIC COMMANDS--------------------------------------------------------------------

let audioManager = new AudioManager();

const playPrefix = process.env.COMMAND_PREFIX;
const wikiPrefix = process.env.WIKI_PREFIX;

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.channel.type === `DM`) return;

  // TODO Extract these conditions into separate methods, this file is getting annoyingly huge! Have some self respect!
  if (message.content.startsWith(playPrefix)) {
    let args = message.content.substring(playPrefix.length).split(" ");

    if (args[0] === `play` && !args[1]) {
      message.channel.send({
        content: `Please provide a youtube link.`,
      });
      return;
    }

    const includeCommands = [`play`];

    // Only fetch title for commands that need it!
    let videoTitle =
      includeCommands.includes(args[0]) && !args[1].includes("/playlist")
        ? await ytstream
            .getInfo(args[1])
            .then((info) => {
              return info.title;
            })
            .catch((err) => {
              if (args[1]) console.log("Error playing YT link!", args[1], err);
              playError = true;
              message.channel.send({
                content: `${err} - Please provide a valid video link.`,
              });
              return null;
            })
        : null;
    if (includeCommands.includes(args[0]) && args[1].includes("/playlist")) {
      videoTitle = await ytstream
        .getPlaylist(args[1])
        .then((info) => {
          return info.title;
        })
        .catch((err) => {
          playError = true;
          message.channel.send({
            content: `${err} - Please provide a valid playlist link.`,
          });
          return null;
        });
    }
    // Get or create player for this guild
    const guildId = message.guild.id;
    if (!global.playerObjectList) {
      global.playerObjectList = new Map();
    }

    let player;
    if (global.playerObjectList.has(guildId)) {
      player = global.playerObjectList.get(guildId);
    } else {
      player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });
      global.playerObjectList.set(guildId, player);
    }

    const channel = message.member.voice.channel;

    if (!channel)
      return message.channel.send({
        content: `Please join a voice channel in order to play a song!`,
      });

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    // Initialize queue if it doesn't exist
    if (!global.songQueue) {
      global.songQueue = new Map();
    }

    // Get or create queue for this guild
    let guildQueue = global.songQueue.get(guildId);
    if (!guildQueue) {
      guildQueue = [];
      global.songQueue.set(guildId, guildQueue);
    }

    switch (args[0].toLowerCase()) {
      case "playlist":
        if (!args[1] || !args[1].includes("/playlist"))
          return message.channel.send({ content: `Please provide a playlist link` });

        let ytdlPlaylist = [];
        await youtubedl(args[1], {
          dumpSingleJson: true,
          yesPlaylist: true,
          flatPlaylist: true,
          // playlistRandom: playShuffle ? true : new Boolean(false), // why need cast?
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

        // console.log("***YTDL PL", ytdlPlaylist);
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
              ytdlPlaylist.forEach((song) => guildQueue.push(song.url));
              message.channel.send({ content: `Added ${ytdlPlaylist.length} songs to queue` });
              return;
            }

            // Play first song and add rest to queue
            player.play(resource);
            connection.subscribe(player);
            message.channel.send({ content: `Now playing: ***${firstSong.title}***` });

            // Add remaining songs to queue
            for (let i = 1; i < ytdlPlaylist.length; i++) {
              guildQueue.push(ytdlPlaylist[i].url);
            }

            if (ytdlPlaylist.length > 1) {
              message.channel.send({ content: `Added ${ytdlPlaylist.length - 1} more songs to queue` });
            }
          })
          .catch((err) => {
            message.channel.send({ content: `Error playing playlist: ${err}` });
          });
        break;
      case "play":
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
              guildQueue.push(args[1]);
              message.channel.send({ content: `Added ***${videoTitle}*** to queue. Position: ${guildQueue.length}` });
              return;
            } else {
              message.channel.send({ content: `Now playing: ***${videoTitle}***` });
            }

            const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;
            const resource = createAudioResource(audioFile);

            // Add listener for when current song ends
            player.on("stateChange", async (oldState, newState) => {
              if (newState.status === "idle" && guildQueue.length > 0) {
                // Play next song in queue
                const nextSong = guildQueue.shift();
                let nextTitle;

                const info = await ytstream.getInfo(nextSong);
                nextTitle = info.title;

                const fileSafeTitle = sanitizeTitle(nextTitle);
                youtubedl(nextSong, {
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
                    message.channel.send({ content: `Now playing next song in queue: ***${nextTitle}***` });
                  })
                  .catch((err) => {
                    message.channel.send({ content: `Error playing next song: ${err}` });
                  });
              }
            });
            player.play(resource);
            connection.subscribe(player);
          })
          .catch((err) => {
            message.channel.send({ content: `Error downloading audio: ${err}` });
          });

        break;
      case "pause":
        if (!channel)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        player.pause();
        message.channel.send({ content: `Player paused.` });
        break;
      case "resume":
        {
          if (!channel)
            return message.channel.send({
              content: `There is currently nothing playing!`,
            });
          player.unpause();
          message.channel.send({ content: `Resuming playback.` });
        }
        break;
      case "skip":
        {
          if (!channel)
            return message.channel.send({
              content: `There is currently nothing playing!`,
            });
          let guildQueue = global.songQueue.get(guildId);
          const nextSong = guildQueue.shift();
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
            // dumpSingleJson: true,
          })
            .then((output) => {
              const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;
              const resource = createAudioResource(audioFile);
              player.play(resource);
              message.channel.send({ content: `Now playing next song in queue: ***${nextTitle}***` });
            })
            .catch((err) => {
              message.channel.send({ content: `Error playing next song: ${err}` });
            });
        }
        break;
      case "loop":
        {
          if (!channel)
            return message.channel.send({
              content: `There is currently nothing playing!`,
            });
        }
        break;
      case "stop":
        if (!channel)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        player.stop();
        connection.destroy();
        message.channel.send({ content: `Playback stopped!` });
        break;
      case "queue":
        {
          if (!channel)
            return message.channel.send({
              content: `There is currently nothing playing!`,
            });
          // const queue = audioManager.queue(vc).reduce((text, song, index) => {
          //   if (index > 50) {
          //     return text;
          //   } else if (index > 49) {
          //     text += `\n...`;
          //     return text;
          //   }
          //   if (song.title) text += `\n**[${index + 1}]** ${song.title}`;
          //   else text += `\n**[${index + 1}]** ${song.url}`;
          //   return text;
          // }, `__**QUEUE**__`);
          // const queueEmbed = new EmbedBuilder()
          //   .setColor(`Blurple`)
          //   .setTitle(`Queue: [${audioManager.queue(vc).length}] Songs`)
          //   .setDescription(queue);
          // if (queueEmbed) {
          //   message.channel.send({ embeds: [queueEmbed] });
          // } else {
          //   message.channel.send({ content: `There was an error while reading the queue!` });
          // }
        }

        break;
      case "volume":
        if (!channel)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        if (!args[1]) return message.channel.send({ content: `Please provide the volume` });
        if (Number(args[1]) < 1 || Number(args[1]) > 10)
          return message.channel.send({
            content: `Please provide a volume between 1-10`,
          });

        break;
      case "current":
        if (!vc)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        function encodeDuration(millis) {
          var minutes = Math.floor(millis / 60000);
          var seconds = ((millis % 60000) / 1000).toFixed(0);
          return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
        }
        try {
          // TODO Change this source
          let songData = audioManager.getCurrentSong(vc);
          songData = {
            ...songData,
            ytInfo: {
              author: songData.ytInfo?.author,
              uploaded: songData.ytInfo?.uploaded,
              views: songData.ytInfo?.views,
              duration: encodeDuration(songData.ytInfo?.duration),
            },
          };

          var msg = "```json\n{";
          for (var key in songData) {
            if (songData.hasOwnProperty(key)) {
              msg = msg + '\n "' + key + '": "' + JSON.stringify(songData[key], null, " ") + '",';
            }
          }
          msg = msg.substring(0, msg.length - 1);
          msg = msg + "\n}```";

          message.channel.send({ content: msg });
        } catch (err) {
          console.log("*** Get current song error:", err);
          message.channel.send({
            content: `There was an error getting the current song.`,
          });
        }

        break;
      case "shuffle":
        if (!channel)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        message.channel.send({
          content: `The queue has successfully been shufffled`,
        });
        break;
      case "clear":
        if (!channel)
          return message.channel.send({
            content: `There is no queue!`,
          });
        message.channel.send({
          content: `The queue has successfully been cleared`,
        });
        break;
      // case "crunch":
      //   if (!vc)
      //     return message.channel.send({
      //       content: `There is no queue!`,
      //     });
      //   const queue = audioManager.queue(vc);
      //   const uvc2 = message.member.voice.channel || message.guild.members.me.voice.channel;
      //   //I don't think this works
      //   audioManager.setFilter(uvc2, ["acrusher=samples=250:lfo=1:lforange=200:bits=256"]);
      //   const filtys = audioManager.getFilters(uvc2);
      //   console.log(filtys);
      //   message.channel.send({
      //     content: "CRUNCHING " + queue[0].title,
      //   });
    }
  }
});

// TODO Likely deprecated, delete this
client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState?.id === "1094140206367653940" && audioManager) {
    //check if bot left vc
    let error = false;
    if (newState?.channelId == null && oldState?.channelId != null) {
      try {
        //destroy audiomanager and end playback
        // if (audioManager) {
        //   audioManager.destroy();
        // }
      } catch (err) {
        // console.log("*** AudioManager Destroy error?", err);
        error = true;
      }
    }
  }
});

// --------------------------------------------------MESSAGE EMBED FUNCS--------------------------------------------------------------------

/**
 * Create wikipedia link from wiki prefix message
 * @params { object } message
 */
client.on("messageCreate", async (message) => {
  const mess = message.content;
  if (message.author.bot === true) return null;
  if (mess.startsWith(wikiPrefix)) {
    let args = message.content.substring(wikiPrefix.length);

    try {
      const page = await wiki.page(args);
      message.reply({
        content: `${page.fullurl}`,
      });
    } catch (error) {
      console.log(error);
      message.reply({
        content: `${error}`,
      });
    }
  }
});

/**
 * Create vxtwitter link from non-embedable native links. Replies to user with vx link.
 * @params { object } message
 */
client.on("messageCreate", async (message) => {
  const mess = message.content;
  const twitterLink = ["https://x.com", "https://twitter.com"].find((link) => mess.includes(link));

  if (twitterLink && !message.author.bot) {
    message.author.bot ? false : message.suppressEmbeds(true), message.suppressEmbeds(true);
    message.reply({
      /*
      Empty character unicode 
      */
      content: `[⠀](${mess.replace(twitterLink, "https://fxtwitter.com")})`,
    });
  }
});

/**
 * Create tiktok embed for tiktok videos. Replies to user with vx embed and suppresses native embed.
 * @params { object } message
 */
client.on("messageCreate", async (message) => {
  const mess = message.content;
  const tiktokLink = ["https://tiktok.com", "https://www.tiktok.com"].find((link) => mess.includes(link));

  if (tiktokLink) {
    message.author.bot ? false : message.suppressEmbeds(true), message.suppressEmbeds(true);
    message.reply({
      content: `[⠀](${mess.replace(tiktokLink, "https://vxtiktok.com")})`,
    });
  }
});

/**
 * Create reddit embed for reddit links. Replies to user with rxddit link, and suppresses native embed.
 * @params { object } message
 */
client.on("messageCreate", async (message) => {
  const mess = message.content;
  const redditLink = ["https://reddit.com", "https://www.reddit.com"].find((link) => mess.includes(link));

  if (redditLink) {
    message.author.bot ? false : message.suppressEmbeds(true), message.suppressEmbeds(true);
    message.reply({
      content: `[⠀](${mess.replace(redditLink, "https://rxddit.com")})`,
    });
    console.log("*** Suppressing Reddit Embed", message);
  }
});

client.login(process.env.TOKEN);

const getAudioManager = () => {
  return audioManager;
};

module.exports = getAudioManager;
