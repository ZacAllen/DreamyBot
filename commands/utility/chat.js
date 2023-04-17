const { SlashCommandBuilder } = require('discord.js')
const { config } = require('dotenv')
const { Configuration, OpenAIApi } = require('openai')
const openaikey = process.env.GPT_API_KEY

const configuration = new Configuration({
  apiKey: openaikey,
})

const openai = new OpenAIApi(configuration)

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('what if the robot go crazy they might take over the world')
    .addStringOption((option) =>
      option.setName('message').setDescription('What would you like to ask DreamyBot?').setRequired(true),
    ),

  async execute(interaction) {
    await interaction.reply('Let me think about it...')
    let completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `${interaction.options.getString('message')}` }],
      // model: 'text-davinci-003',
      // prompt: `${interaction.options.getString('message')}`,
    })

    console.log('*** Your response is: ', completion?.data?.choices[0]?.message)

    await interaction
      .editReply(
        `**"${interaction.options.getString('message')}":**
     \`\`\`fix
    ${completion?.data?.choices[0]?.message?.content}
    \`\`\` `,
      )
      .catch((err) => {
        interaction.editReply('Ah fuck, I have encountered a problem generating your response.')
      })
  },
}
