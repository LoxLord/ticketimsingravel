const { REST, Routes, SlashCommandBuilder } = require('discord.js');

function buildCommands() {
  const kurulum = new SlashCommandBuilder().setName('kurulum').setDescription('Ticket sistemi kurulumu ve ayarları');
  return [kurulum.toJSON()];
}

async function registerCommands({ token, clientId, guildId }) {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = buildCommands();

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: commands });
}

module.exports = {
  registerCommands
};
