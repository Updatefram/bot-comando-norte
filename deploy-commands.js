const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('./config.json');
require('dotenv').config();

function buildCommands() {
    const paineladm = new SlashCommandBuilder()
        .setName('paineladm')
        .setDescription('Abre/atualiza o Painel Central no canal escolhido')
        .addChannelOption((opt) =>
            opt
                .setName('canal')
                .setDescription('Canal onde o Painel Central deve ficar')
                .setRequired(true)
        )
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

    return [paineladm.toJSON()];
}

module.exports = { buildCommands };

if (require.main === module) {
    const token = String(process.env.TOKEN ?? process.env.DISCORD_TOKEN ?? config.token ?? '').trim();
    const clientId = String(process.env.CLIENT_ID ?? config.clientId ?? '').trim();
    const guildId = String(process.env.GUILD_ID ?? config.guildId ?? '').trim();
    if (!token) throw new Error('TOKEN ausente (use .env ou variável de ambiente no Railway)');
    if (!clientId) throw new Error('CLIENT_ID ausente (use .env ou config.json)');
    if (!guildId) throw new Error('GUILD_ID ausente (use .env ou config.json)');

    const rest = new REST({ version: '10' }).setToken(token);
    (async () => {
        const commands = buildCommands();
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands }
        );
        console.log("Comandos registrados!");
    })();
}
