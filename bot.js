require("dotenv").config(); //to start process from .env file
const fs = require("fs");
const path = require("path");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");
const { AudioManager } = require("discordaudio");
const { EmbedBuilder } = require("discord.js");
const ytstream = require("yt-stream");

// ytstream.setApiKey(process.env.YT_API_KEY); // Only sets the api key
// ytstream.setPreference("api", "ANDROID"); // Tells the package to use the api and use a web client for requests

// ytstream.setPreference("scrape"); // Tells the package to use the scrape methods instead of the api, even if an api key has been provided

// ytstream.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0";

const agent = new ytstream.YTStreamAgent([], {
  keepAlive: true,
  keepAliveMsecs: 5e3,
});
agent.syncFile(path.join(__dirname, `./cookies.json`)); // This is an absolute path which will always work
// agent.syncFile(`./cookies.json`) // This is a relative path which will only work if the cookies.json file is inside the root folder of the process

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

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js")); //filter non js files
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  }
}

// Reading event files
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// client.on('messageCreate', (message) => {
//   if (message.content.includes('hello') && message.author.username !== 'DreamyBot')
//     message.reply('hello' + ' ' + message.author.username) //reply hello word message with senders name
// })

// --------------------------------------------------MUSIC COMMANDS--------------------------------------------------------------------

const connections = new Map();

let audioManager = new AudioManager();

const playPrefix = process.env.COMMAND_PREFIX;

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.channel.type === `DM`) return;

  if (!message.content.startsWith(playPrefix)) return;

  let args = message.content.substring(playPrefix.length).split(" ");

  if (args[0] === `play` && !args[1]) {
    message.channel.send({
      content: `Please provide a youtube link.`,
    });
    return;
  }

  const vc = connections.get(message.guild.members.me.voice.channel?.id);

  const includeCommands = [`play`];

  let playError = false;

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
        // console.log("Playlist count", info.videos.length);
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

  switch (args[0].toLowerCase()) {
    case "play":
      if (!message.member.voice.channel && !message.guild.members.me.voice.channel)
        return message.channel.send({
          content: `Please join a voice channel in order to play a song!`,
        });
      if (!args[1]) return message.channel.send({ content: `Please provide a song` });
      const uvc = message.member.voice.channel || message.guild.members.me.voice.channel;

      if (!audioManager) {
        audioManager = new AudioManager();
      }
      let playShuffle = false;
      if (args[2] && args[2] === "-shuffle") {
        playShuffle = true;
      }

      audioManager
        .play(
          uvc,
          args[1],
          {
            quality: "high",
            audiotype: "arbitrary",
            volume: 10,
          },
          playShuffle
        )
        .then((queue) => {
          if (playError) return;
          connections.set(uvc.id, uvc);
          if (queue === false)
            message.channel.send({
              content: `Now playing  **${videoTitle ? videoTitle : args[1]}**`,
            });
          else
            message.channel.send({
              content: `${videoTitle ? videoTitle : "Your song"} has been added to the queue!`,
            });
        })
        .catch((err) => {
          console.log(err);
          message.channel.send({
            content: `There was an error while trying to connect to the voice channel!`,
          });
        });
      break;
    case "pause":
      if (!vc)
        return message.channel.send({
          content: `There is currently nothing playing!`,
        });
      audioManager.pause(vc);
      message.channel.send({ content: `Player paused.` });
      break;
    case "resume":
      {
        if (!vc)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        const queue = audioManager.queue(vc);
        audioManager.resume(vc);
        message.channel.send({ content: `Resuming playback of **${queue[0]?.title}.**` });
      }
      break;
    case "skip":
      {
        if (!vc)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        const queue = audioManager.queue(vc);
        audioManager
          .skip(vc)
          .then(() => {
            message.channel.send({ content: `Skipping song **${queue[0]?.title || ""}.**` });
          })
          .catch((err) => {
            console.log("*** ARE WE ERRINFG", typeof err, err);
            message.channel.send({
              content: `There was an error while skipping the song! \n**Error:** *${err}*`,
            });
            // If unavailable video error, retry skip to remove blank from queue
            if (typeof err === "string" && err.includes("error while getting the YouTube video url")) {
              audioManager
                .skip(vc)
                .then(() => {
                  message.channel.send({
                    content: `The next song in queue is unavailable. Skipping song **${queue[1]?.title || ""}.**`,
                  });
                })
                .catch((err) => {
                  message.channel.send({
                    content: `There was an error while skipping the song! Error: ${err}`,
                  });
                });
              // If failed fetch error, retry skip to remove blank from queue
            } else if (err.message.includes("aborted")) {
              audioManager
                .skip(vc)
                .then(() => {
                  message.channel.send({
                    content: `The next song in queue is unavailable. Skipping song **${queue[1]?.title || ""}.**`,
                  });
                })
                .catch((err) => {
                  message.channel.send({
                    content: `There was an error while skipping the song! Error: ${err}`,
                  });
                });
            }
          });
      }
      break;
    case "loop":
      {
        if (!vc)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        const queue = audioManager.queue(vc);
        audioManager.loop(vc, audioManager?.looptypes?.loop);
        message?.channel.send({ content: `Looping current song ${queue[0]?.title || ""}.` });
      }
      break;
    case "stop":
      if (!vc)
        return message.channel.send({
          content: `There is currently nothing playing!`,
        });
      audioManager.stop(vc);
      message.channel.send({ content: `Playback stopped!` });
      break;
    case "queue":
      {
        if (!vc)
          return message.channel.send({
            content: `There is currently nothing playing!`,
          });
        const queue = audioManager.queue(vc).reduce((text, song, index) => {
          if (index > 50) {
            return text;
          } else if (index > 49) {
            text += `\n...`;
            return text;
          }
          if (song.title) text += `\n**[${index + 1}]** ${song.title}`;
          else text += `\n**[${index + 1}]** ${song.url}`;
          return text;
        }, `__**QUEUE**__`);
        const queueEmbed = new EmbedBuilder()
          .setColor(`Blurple`)
          .setTitle(`Queue: [${audioManager.queue(vc).length}] Songs`)
          .setDescription(queue);
        if (queueEmbed) {
          message.channel.send({ embeds: [queueEmbed] });
        } else {
          message.channel.send({ content: `There was an error while reading the queue!` });
        }
      }

      break;
    case "volume":
      if (!vc)
        return message.channel.send({
          content: `There is currently nothing playing!`,
        });
      if (!args[1]) return message.channel.send({ content: `Please provide the volume` });
      if (Number(args[1]) < 1 || Number(args[1]) > 10)
        return message.channel.send({
          content: `Please provide a volume between 1-10`,
        });
      audioManager.volume(vc, Number(args[1]));
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
      if (!vc)
        return message.channel.send({
          content: `There is currently nothing playing!`,
        });
      audioManager.shuffle(vc);
      message.channel.send({
        content: `The queue has successfully been shufffled`,
      });
      break;
    case "clear":
      if (!vc)
        return message.channel.send({
          content: `There is no queue!`,
        });
      audioManager.clearqueue(vc);
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
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState?.id === "1094140206367653940" && audioManager) {
    //check if bot left vc
    let error = false;
    if (newState?.channelId == null && oldState?.channelId != null) {
      try {
        //destroy audiomanager and end playback
        if (audioManager) {
          audioManager.destroy();
        }
      } catch (err) {
        // console.log("*** AudioManager Destroy error?", err);
        error = true;
      }
    }
  }
});

// --------------------------------------------------MESSAGE EMBED FUNCS--------------------------------------------------------------------

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
      content: `[⠀](${mess.replace(twitterLink, "https://vxtwitter.com")})`,
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
