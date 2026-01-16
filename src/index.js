require('dotenv').config();

const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const { initDb } = require('./db');
const { registerCommands } = require('./registerCommands');
const { handleInteraction } = require('./interactionHandler');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildIdForCommands = process.env.GUILD_ID;

if (!token) {
  throw new Error('DISCORD_TOKEN is required');
}

if (!clientId) {
  throw new Error('CLIENT_ID is required');
}

const db = initDb(path.join(__dirname, '..', 'data'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', async () => {
  await registerCommands({ token, clientId, guildId: guildIdForCommands });
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('guildCreate', async (guild) => {
  const channel = guild.systemChannel;
  if (!channel) return;

  await channel
    .send('Ticket botu başarıyla eklendi. Kullanmak için /kurulum komutunu çalıştırınız.')
    .catch(() => null);
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteraction({ interaction, client, db });
  } catch {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'Bir hata oluştu.' });
      } else {
        await interaction.reply({ content: 'Bir hata oluştu.', ephemeral: true });
      }
    } catch {
      return;
    }
  }
});

client.on('channelDelete', async (channel) => {
  try {
    const ticket = db.getTicketByChannel(channel.id);
    if (!ticket) return;
    if (ticket.status !== 'open') return;

    db.closeTicket({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number });
  } catch {
    return;
  }
});

client.login(token);
