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
      messages: [{ role: 'system', content: `${interaction.options.getString('message')}` }],
      // model: 'text-davinci-003',
      // prompt: `${interaction.options.getString('message')}`,
    })

    console.log('*** Your response is: ', completion?.data?.choices[0]?.message)

    const result = completion?.data?.choices[0]?.message?.content
    let splitResult = []
    let tooLong = false

    //check if result is longer than discord 2000 count message limit
    if (result.length > 1999) {
      console.log('*** RESULT LENGTH', result.length)
      tooLong = true
      let startIndex = 0
      for (var i = 0; i < result.length; i++) {
        if (i % 1999 == 0) {
          splitResult.push(result.substring(startIndex, i))
          startIndex = i
        }
        //once i reaches end, add remaining to splitResult
        i == result.length - 1 && splitResult.push(result.substring(startIndex, i))
      }
    }

    /* I initially wrote this thinking tooLong would be reused someplace else, excuse the redundancy */
    if (tooLong) {
      await interaction.editReply(`**"${interaction.options.getString('message')}":**
      \`\`\`fix
      ${splitResult[0]}-
      (Part 1)
      \`\`\``)
      splitResult.forEach((section, index) => {
        if (section !== splitResult[0]) {
          interaction.channel.send({
            content: `\`\`\`fix
          -${splitResult2}
          (Part ${index + 1})
          \`\`\``,
          })
        }
      })
    } else {
      await interaction
        .editReply(
          `**"${interaction.options.getString('message')}":**
       \`\`\`fix
      ${result}
      \`\`\` `,
        )
        .catch((err) => {
          console.log(err)
          interaction.editReply('Ah fuck, I have encountered a problem generating your response.')
        })
    }
  },
}
