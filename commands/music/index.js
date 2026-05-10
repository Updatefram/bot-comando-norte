const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { LOOP } = require('../../player/musicManager');

function requireVoice(interaction) {
    const voiceChannel = interaction.member?.voice?.channel ?? null;
    if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
        return null;
    }
    return voiceChannel;
}

function buildQueueText(ctrl) {
    if (!ctrl.current && ctrl.queue.length === 0) return '📭 Fila vazia.';
    const lines = [];
    if (ctrl.current) lines.push(`🎶 Tocando agora: ${ctrl.current.title}`);
    const upcoming = ctrl.queue.slice(0, 10);
    if (upcoming.length) {
        lines.push('🗒️ Próximas:');
        for (let i = 0; i < upcoming.length; i++) lines.push(`${i + 1}. ${upcoming[i].title}`);
    }
    if (ctrl.queue.length > 10) lines.push(`… e mais ${ctrl.queue.length - 10} na fila`);
    return lines.join('\n');
}

const commands = [
    {
        name: 'play',
        data: new SlashCommandBuilder()
            .setName('play')
            .setDescription('Tocar música por nome/link do YouTube')
            .addStringOption((opt) => opt.setName('query').setDescription('Nome ou link do YouTube').setRequired(true))
            .setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (!(await ctx.ensureCanPlayNow(interaction))) return;
            const voiceChannel = requireVoice(interaction);
            if (!voiceChannel) {
                await ctx.replyAndDelete(interaction, '❌ Entre em uma sala de voz primeiro.');
                return;
            }
            const query = interaction.options.getString('query', true).trim();
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            ctrl.setTextChannel(interaction.channelId);
            await ctrl.ensureConnection(voiceChannel);
            const added = await ctrl.enqueue(query, { requestedById: interaction.user.id });
            await ctrl.playNext();
            await ctx.replyAndDelete(interaction, `▶️ Adicionado na fila: ${added.length} item(ns).`);
        }
    },
    {
        name: 'skip',
        data: new SlashCommandBuilder().setName('skip').setDescription('Pular música atual').setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            if (!ctrl.current) {
                await ctx.replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                return;
            }
            ctrl.skip();
            await ctx.replyAndDelete(interaction, '⏭️ Pulando...');
        }
    },
    {
        name: 'stop',
        data: new SlashCommandBuilder().setName('stop').setDescription('Parar e limpar a fila').setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            ctx.musicManager.destroy(interaction.guild.id);
            await ctx.replyAndDelete(interaction, '⏹️ Música parada e fila limpa.');
        }
    },
    {
        name: 'pause',
        data: new SlashCommandBuilder().setName('pause').setDescription('Pausar').setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            if (!ctrl.current) {
                await ctx.replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                return;
            }
            const ok = ctrl.pause();
            await ctx.replyAndDelete(interaction, ok ? '⏸️ Pausado.' : '⚠️ Não consegui pausar.');
        }
    },
    {
        name: 'resume',
        data: new SlashCommandBuilder().setName('resume').setDescription('Retomar').setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            if (!ctrl.current) {
                await ctx.replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                return;
            }
            const ok = ctrl.resume();
            await ctx.replyAndDelete(interaction, ok ? '▶️ Retomado.' : '⚠️ Não consegui retomar.');
        }
    },
    {
        name: 'queue',
        data: new SlashCommandBuilder().setName('queue').setDescription('Ver fila').setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            await ctx.replyAndDelete(interaction, buildQueueText(ctrl));
        }
    },
    {
        name: 'nowplaying',
        data: new SlashCommandBuilder().setName('nowplaying').setDescription('Ver música atual').setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            if (!ctrl.current) {
                await ctx.replyAndDelete(interaction, '📭 Nada tocando agora.');
                return;
            }
            await ctx.replyAndDelete(interaction, `🎶 Tocando agora: ${ctrl.current.title}\n${ctrl.current.url}`);
        }
    },
    {
        name: 'volume',
        data: new SlashCommandBuilder()
            .setName('volume')
            .setDescription('Ajustar volume (0-200)')
            .addIntegerOption((opt) => opt.setName('valor').setDescription('0 a 200').setRequired(true).setMinValue(0).setMaxValue(200))
            .setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (!(await ctx.ensureCanPlayNow(interaction))) return;
            const v = interaction.options.getInteger('valor', true);
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            const vol = ctrl.setVolumePercent(v);
            await ctx.replyAndDelete(interaction, `🔊 Volume ajustado: ${vol}%`);
        }
    },
    {
        name: 'loop',
        data: new SlashCommandBuilder()
            .setName('loop')
            .setDescription('Configurar loop')
            .addStringOption((opt) =>
                opt
                    .setName('modo')
                    .setDescription('off | track | queue')
                    .setRequired(true)
                    .addChoices(
                        { name: 'off', value: LOOP.OFF },
                        { name: 'track', value: LOOP.TRACK },
                        { name: 'queue', value: LOOP.QUEUE }
                    )
            )
            .setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const mode = interaction.options.getString('modo', true);
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            ctrl.setLoopMode(mode);
            await ctx.replyAndDelete(interaction, `🔁 Loop: ${ctrl.loopMode}`);
        }
    },
    {
        name: 'shuffle',
        data: new SlashCommandBuilder().setName('shuffle').setDescription('Embaralhar fila').setDMPermission(false),
        async execute(interaction, ctx) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const ctrl = ctx.musicManager.get(interaction.guild.id);
            if (ctrl.queue.length < 2) {
                await ctx.replyAndDelete(interaction, '⚠️ Fila pequena demais para shuffle.');
                return;
            }
            ctrl.shuffleQueue();
            await ctx.replyAndDelete(interaction, '🔀 Fila embaralhada.');
        }
    }
];

module.exports = { commands };

