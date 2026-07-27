require("dotenv").config(); //to start process from .env file
const fs = require("fs");
const ytdlp = require("./helpers/ytdlp.cjs");
const {
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const path = require("path");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
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
    const guildId = message.guild.id;
    const isLooping = global.loopMap?.get(guildId) || false;
    const currentSong = global.currentSongMap?.get(guildId);

    // If looping and we have a current song, replay it
    if (isLooping && currentSong) {
      try {
        const fileSafeTitle = helpers.sanitizeTitle(currentSong.title);
        const audioFile = `./yt-dl-output/${fileSafeTitle}.mp3`;

        // File should already exist from previous play
        if (fs.existsSync(audioFile) && fs.statSync(audioFile).size > 0) {
          const resource = createAudioResource(audioFile);
          player.play(resource);
          console.log("*** LOOPING", currentSong.title);
          return;
        }
        // If file doesn't exist, re-download it
        await ytdlp.downloadAudio(currentSong.url, `./yt-dl-output/${fileSafeTitle}.%(ext)s`);
        const resource = createAudioResource(audioFile);
        player.play(resource);
        console.log("*** LOOPING (re-downloaded)", currentSong.title);
        return;
      } catch (err) {
        console.error("Error looping song:", err);
        // Disable loop and fall through to play next song
        global.loopMap.set(guildId, false);
      }
    }

    // Not looping - proceed to next song in queue. playNext skips any
    // unavailable tracks (404 / removed / private) automatically so a bad
    // entry never leaves playback stalled. The player is already subscribed
    // to the connection from the initial play, so no connection is needed here.
    await helpers.playNext(player, null, message, guildQueue);
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
    let videoTitle = null;
    let playError = false;

    if (includeCommands.includes(args[0]) && !args[1].includes("/playlist")) {
      try {
        const info = await helpers.getVideoInfo(args[1]);
        videoTitle = info.title;
      } catch (err) {
        console.log("*** Error playing YT link!", args);
        if (args[1]) console.log("Error playing YT link!", args[1], err);
        playError = true;
        message.channel.send({
          content: `${err.message || err} - Please provide a valid video link.`,
        });
      }
    }

    if (includeCommands.includes(args[0]) && args[1].includes("/playlist")) {
      try {
        const info = await helpers.getPlaylistInfo(args[1]);
        videoTitle = info.title;
      } catch (err) {
        playError = true;
        message.channel.send({
          content: `${err.message || err} - Please provide a valid playlist link.`,
        });
      }
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
      content: `[⠀](${mess.replace(tiktokLink, "https://kktiktok.com")})`,
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
