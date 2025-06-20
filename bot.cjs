require("dotenv").config(); //to start process from .env file
const fs = require("fs");
const youtubedl = require("youtube-dl-exec");
const {
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const path = require("path");
const cookies = require("./cookies.json");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
const ytstream = require("yt-stream");
const wiki = require("wikipedia");
const helpers = require("./helpers/helpers.cjs");

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
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0";
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

const initializePlayerListener = (player, guildQueue, message) => {
  player.on(AudioPlayerStatus.Idle, async () => {
    if (guildQueue.length === 0) {
      if (global.currentSongMap) {
        global.currentSongMap.delete(message.guild.id);
      }
      return;
    }

    const nextSong = guildQueue.shift()?.url;
    if (!nextSong) return;

    try {
      const info = await ytstream.getInfo(nextSong);
      const nextTitle = info.title;
      const fileSafeTitle = helpers.sanitizeTitle(nextTitle);

      await youtubedl(nextSong, {
        extractAudio: true,
        audioFormat: "mp3",
        output: `./yt-dl-output/${fileSafeTitle}.%(ext)s`,
        noCheckCertificates: true,
        cookiesFromBrowser: "firefox",
        addHeader: [`referer:youtube.com`, `user-agent:${userAgent}`],
        noWarnings: true,
      });

      const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;

      // Verify file exists and is not empty before playing
      if (!fs.existsSync(audioFile) || fs.statSync(audioFile).size === 0) {
        message.channel.send({ content: `Error: Audio file for "${nextTitle}" is missing or empty. Skipping.` });
        return; // Skip this song and wait for next idle event
      }

      const resource = createAudioResource(audioFile);
      player.play(resource);

      if (!global.currentSongMap) {
        global.currentSongMap = new Map();
      }
      global.currentSongMap.set(message.guild.id, {
        url: nextSong,
        title: nextTitle,
      });
      console.log("*** NOW PLAYING", nextTitle);
    } catch (err) {
      message.channel.send({ content: `Error playing next song: ${err}` });
    }
  });
};

// --------------------------------------------------MUSIC COMMANDS--------------------------------------------------------------------

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
    // Initialize playerObject map, ideally there should only be one player per guild
    const guildId = message.guild.id;
    if (!global.playerObjectList) {
      global.playerObjectList = new Map();
    }
    let guildQueue;

    // Initialize queue if it doesn't exist
    if (!global.songQueue) {
      global.songQueue = new Map();
    }

    let player;
    // Get or create player for this guild
    if (global.playerObjectList.has(guildId)) {
      player = global.playerObjectList.get(guildId);
    } else {
      player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });
      global.playerObjectList.set(guildId, player);
      // Get or create queue for this guild - must be done before listener is attached
      guildQueue = global.songQueue.get(guildId);
      if (!guildQueue) {
        guildQueue = [];
        global.songQueue.set(guildId, guildQueue);
      }
      // !! Initialize listener only when player is created
      initializePlayerListener(player, guildQueue, message);
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

    // Initialize currentSongMap if it doesn't exist
    if (!global.currentSongMap) {
      global.currentSongMap = new Map();
    }

    // Log listener count for debugging
    console.log(
      `[DEBUG] ${new Date().toLocaleTimeString()} - Listeners for guild ${guildId}: ${player.listenerCount(
        AudioPlayerStatus.Idle
      )}`
    );

    //  Set guildQueue globally for use in helpers as they are called
    guildQueue = global.songQueue.get(guildId);

    switch (args[0].toLowerCase()) {
      case "playlist":
        // ?  "This can happen if the audio player becomes idle immediately after a song starts,
        // triggering the next song in the queue to be processed prematurely.
        // This cycle repeats, causing multiple downloads and skips."
        helpers.handlePlaylist(args, message, player, connection, guildQueue);
        break;
      case "play":
        helpers.handlePlay(args, videoTitle, message, player, connection, guildQueue);
        break;
      case "pause":
        helpers.handlePause(channel, player, message);
        break;
      case "resume":
        helpers.handleResume(channel, player, message);
        break;
      case "skip":
        helpers.handleSkip(channel, player, connection, message, guildQueue);
        break;
      case "loop":
        helpers.handleLoop(channel, message);
        break;
      case "stop":
        helpers.handleStop(channel, player, connection, message);
        break;
      case "queue":
        helpers.handleQueue(channel, message, guildQueue);
        break;
      case "volume":
        helpers.handleVolume(channel, args, message);
        break;
      case "current":
        helpers.handleCurrent(channel, message, guildQueue);
        break;
      case "shuffle":
        helpers.handleShuffle(channel, message, guildQueue);
        break;
      case "clear":
        helpers.handleClear(channel, message);
        break;
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
