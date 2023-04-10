const { Events } = require("discord.js");

module.exports = {
  name: Events.InteractionCreate,
  // Listener for event that will execute when bot receives an interaction
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return; // prevent execution for non-slash commands

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(
        `No command matching ${interaction.commandName} was found.`
      );
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing ${interaction.commandName}`);
      console.error(error);
    }
  },
};
