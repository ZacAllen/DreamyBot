const { SlashCommandBuilder } = require('discord.js')
const ytdl = require('ytdl-core')
const ytstream = require('yt-stream')
// const audioManager = new discordaudio.AudioManager()
const { Player, Connection, AudioManager } = require('discordaudio')

const playSong = async (channel, urlString) => {
  // const channel = interaction.member.voice.channel
  // console.log('Channel', channel)
  const player = new Player(channel)

  player
    .play(`${urlString}`, {
      autoleave: true,
      quality: 'high',
      selfDeaf: false,
      selfMute: false,
      audiotype: 'arbitrary',
    })
    .then((stream) => console.log(`Playing ${stream}`))
    .catch((err) => {
      console.log(err)
    })

  // player.pause()
}

const playPlaylist = async (channel, playlist) => {
  const player = new Player(channel)
  const videos = playlist.videos
}

module.exports = {
  cooldown: 2,
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Plays youtube, hopefully!')
    .addStringOption((option) => option.setName('url').setDescription('Youtube link').setRequired(true)),

  async execute(interaction) {
    const urlString = interaction.options.getString('url') ?? 'No url provided'

    interaction.reply(`Searching youtube for...${urlString}`)

    const channel = interaction.member.voice.channel

    //check if provided url is youtube playlist
    const isPlaylist = ytstream.validatePlaylistURL(urlString)

    //play playlist or single video conditionally
    if (isPlaylist) {
      const vidInfo = await ytstream
        .getPlaylist(`${urlString}`)
        .then((playlist) => {
          if (playlist) {
            // console.log(playlist)
            playPlaylist(channel, playlist)
          }
        })
        .catch((err) => {
          console.log(err)
        })
    } else {
      await playSong(channel, urlString)
    }
  },
}
