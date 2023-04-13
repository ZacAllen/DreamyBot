const { SlashCommandBuilder } = require('discord.js')
const ytstream = require('yt-stream')
const { Player, Connection, AudioManager } = require('discordaudio')

module.exports = {
  cooldown: 2,
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause a currently playing song/playlist'),
  //   .addStringOption((option) => option.setName('url').setDescription('Youtube link').setRequired(true)),

  async execute(interaction) {
    //   const urlString = interaction.options.getString('url') ?? 'No url provided'

    interaction.reply(`Pausing...`)

    const channel = interaction.member.voice.channel
    const player = new Player(channel)
    // console.log('*** PLAYER', player)

    player.pause()
  },
}
