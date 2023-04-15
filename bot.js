require('dotenv').config() //to start process from .env file
const fs = require('node:fs')
const path = require('node:path')
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js')
const { AudioManager } = require('discordaudio')
const discord = require('discord.js')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, //adds server functionality
    GatewayIntentBits.GuildMessages, //gets messages from our bot.
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
})

// attaching a .commands property to the client instance so that we can access commands in other files
client.commands = new Collection()

const foldersPath = path.join(__dirname, 'commands') //find path to commands folder and files
const commandFolders = fs.readdirSync(foldersPath)

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder)
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js')) //filter non js files
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file)
    const command = require(filePath)
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command)
    } else {
      console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`)
    }
  }
}

// Reading event files
const eventsPath = path.join(__dirname, 'events')
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'))

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file)
  const event = require(filePath)
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args))
  } else {
    client.on(event.name, (...args) => event.execute(...args))
  }
}

client.login(process.env.TOKEN)

// client.on('messageCreate', (message) => {
//   if (message.content.includes('hello') && message.author.username !== 'DreamyBot')
//     message.reply('hello' + ' ' + message.author.username) //reply hello word message with senders name
// })

// --------------------------------------------------MUSIC COMMANDS--------------------------------------------------------------------

const connections = new Map()

const audioManager = new AudioManager()

const playPrefix = process.env.COMMAND_PREFIX

client.on('messageCreate', (message) => {
  if (message.author.bot || message.channel.type === `DM`) return

  if (!message.content.startsWith(playPrefix)) return

  let args = message.content.substring(playPrefix.length).split(' ')

  const vc = connections.get(message.guild.members.me.voice.channel?.id)

  switch (args[0].toLowerCase()) {
    case 'play':
      if (!message.member.voice.channel && !message.guild.members.me.voice.channel)
        return message.channel.send({ content: `Please join a voice channel in order to play a song!` })
      if (!args[1]) return message.channel.send({ content: `Please provide a song` })
      const uvc = message.member.voice.channel || message.guild.members.me.voice.channel
      audioManager
        .play(uvc, args[1], {
          quality: 'high',
          audiotype: 'arbitrary',
          volume: 10,
        })
        .then((queue) => {
          connections.set(uvc.id, uvc)
          if (queue === false) message.channel.send({ content: `Now playing ${args[1]}` })
          else message.channel.send({ content: `Your song has been added to the queue!` })
        })
        .catch((err) => {
          console.log(err)
          message.channel.send({ content: `There was an error while trying to connect to the voice channel!` })
        })
      break
    case 'pause':
      if (!vc) return message.channel.send({ content: `There is currently nothing playing!` })
      audioManager.pause(vc)
      message.channel.send({ content: `Player paused.` })
      break
    case 'resume':
      if (!vc) return message.channel.send({ content: `There is currently nothing playing!` })
      audioManager.resume(vc)
      message.channel.send({ content: `Resuming playback.` })
      break
    case 'skip':
      if (!vc) return message.channel.send({ content: `There is currently nothing playing!` })
      audioManager
        .skip(vc)
        .then(() => message.channel.send({ content: `Song skipped.` }))
        .catch((err) => {
          console.log(err)
          message.channel.send({ content: `There was an error while skipping the song!` })
        })
      break
    case 'stop':
      if (!vc) return message.channel.send({ content: `There is currently nothing playing!` })
      audioManager.stop(vc)
      message.channel.send({ content: `Playback stopped!` })
      break
    case 'queue':
      if (!vc) return message.channel.send({ content: `There is currently nothing playing!` })
      const queue = audioManager.queue(vc).reduce((text, song, index) => {
        if (index > 50) {
          return text
        } else if (index > 49) {
          text += `\n...`
          return text
        }
        if (song.title) text += `\n**[${index + 1}]** ${song.title}`
        else text += `\n**[${index + 1}]** ${song.url}`
        return text
      }, `__**QUEUE**__`)
      const queueEmbed = new discord.EmbedBuilder().setColor(`Blurple`).setTitle(`Queue`).setDescription(queue)
      message.channel.send({ embeds: [queueEmbed] })
      break
    case 'volume':
      if (!vc) return message.channel.send({ content: `There is currently nothing playing!` })
      if (!args[1]) return message.channel.send({ content: `Please provide the volume` })
      if (Number(args[1]) < 1 || Number(args[1]) > 10)
        return message.channel.send({ content: `Please provide a volume between 1-10` })
      audioManager.volume(vc, Number(args[1]))
      break
    case 'shuffle':
      if (!vc) return message.channel.send({ content: `There is currently nothing playing!` })
      audioManager.shuffle(vc)
      message.channel.send({ content: `The queue has successfully been shufffled` })
      break
  }
})
