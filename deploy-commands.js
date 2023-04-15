require('dotenv').config() //get values from .env file

const { REST, Routes } = require('discord.js')
const fs = require('fs')
const path = require('path')

const commands = []
// Grab all the command files from the commands directory you created earlier
const foldersPath = path.join(__dirname, 'commands') //find path to commands folder and files
const commandFolders = fs.readdirSync(foldersPath)

// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder)
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js')) //filter non js files
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file)
    const command = require(filePath)
    commands.push(command.data.toJSON())
  }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(process.env.TOKEN)

// and deploy your commands!
;(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`)

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = await rest.put(
      Routes.applicationCommands(
        process.env.CLIENT_ID,
        // process.env.GUILD_ID guild id not necessary if loading commands globally
      ),
      { body: commands },
    )

    console.log(`Successfully reloaded ${data.length} application (/) commands.`)
  } catch (error) {
    // And of course, make sure you catch and log any errors!
    console.error(error)
  }
})()
