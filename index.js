const {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionsBitField,
    AttachmentBuilder,
    REST,
    Routes,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const fs = require('node:fs/promises');
const path = require('node:path');

require('dotenv').config();

const config = require('./config.json');
const { buildCommands } = require('./deploy-commands');
const { commands: musicSlashCommands } = require('./commands/music');
const musicSlashByName = new Map(musicSlashCommands.map((c) => [c.name, c]));

const BOT_TOKEN = String(process.env.TOKEN ?? process.env.DISCORD_TOKEN ?? config.token ?? '').trim();
const APP_CLIENT_ID = String(process.env.CLIENT_ID ?? config.clientId ?? '').trim();
const APP_GUILD_ID = String(process.env.GUILD_ID ?? config.guildId ?? '').trim();

let ffmpegPath = null;
try {
    ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;
} catch {}

let opusAvailable = true;
let opusProvider = '@discordjs/opus';
try {
    require('@discordjs/opus');
} catch {
    try {
        require('opusscript');
        opusProvider = 'opusscript';
    } catch {
        opusAvailable = false;
        opusProvider = null;
    }
}

const {
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    createAudioResource,
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const playdl = require('play-dl');
const { MusicManager, LOOP } = require('./player/musicManager');
const musicLogger = require('./utils/logger');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates]
});

const musicManager = new MusicManager({ client, logger: musicLogger });

const AUTO_DELETE_MS = 10000;
const AGE_VERIFY_DELETE_MS = 10000;
const AGE_VERIFY_PREVIEW_DELETE_MS = 20000;
const AGE_VERIFY_DATA_PATH = path.join(__dirname, 'age-verificacoes.json');
const CHANNEL_INDEX_PATH = path.join(__dirname, 'canais-categorias.json');
let ageVerifyWriteChain = Promise.resolve();
const pendingAgeVerifyByUserId = new Map();
const ticketCooldownByUserId = new Map();
const ticketFarmCooldownByUserId = new Map();
const musicByGuildId = new Map();
const pendingAdminActionByUserId = new Map();
const memberJoinMsByGuildUserKey = new Map();
const setagemRequestsById = new Map();
let ensureMusicPanelRunning = false;
let ensureAdminPanelRunning = false;

const MIX_STYLES = [
    'funk',
    'sertanejo',
    'trap',
    'rap',
    'phonk',
    'pop',
    'rock',
    'metal',
    'reggae',
    'samba',
    'pagode',
    'forró',
    'piseiro',
    'eletrônica',
    'house',
    'techno',
    'lo-fi',
    'jazz',
    'blues',
    'clássica',
    'indie',
    'k-pop',
    'anime openings'
];

const MUSIC_HISTORY_PATH = path.join(__dirname, 'music-history.json');
let musicHistoryWriteChain = Promise.resolve();
let musicHistory = [];

const MUSIC_PANEL_CHANNEL_ID = config.musicPanelChannelId || '1502827526282805279';
const MUSIC_PANEL_CUSTOM_PREFIX = 'musicpanel_';
const COMMANDS_ALLOWED_CHANNEL_ID = config.commandsAllowedChannelId || '1345452100204757033';
const ADMIN_PANEL_CHANNEL_ID = config.adminPanelChannelId || COMMANDS_ALLOWED_CHANNEL_ID;
const ADMIN_PANEL_CUSTOM_PREFIX = 'adminpanel_';
const PAINELADM_COMMAND_CHANNEL_ID = config.painelAdmCommandChannelId || '1502806445203390635';
const VISITOR_ROLE_ID = config.visitorRoleId || '1344513058621624320';
const VERIFIED_EXTRA_ROLE_ID = config.verifiedExtraRoleId || '1502763123780751420';
const WELCOME_CHANNEL_ID = config.welcomeChannelId || '1502749407148376074';
const GOODBYE_CHANNEL_ID = config.goodbyeChannelId || '1502749892882206900';

function getAdminPanelChannelId() {
    const configured = /^\d{17,20}$/.test(String(config.adminPanelChannelId ?? '')) ? String(config.adminPanelChannelId) : null;
    return configured ?? ADMIN_PANEL_CHANNEL_ID;
}

const MUSIC_PANEL_LIBRARY = {
    funk: [
        { label: 'MC Ryan SP - Tubarão Te Amo', query: 'MC Ryan SP Tubarão Te Amo' },
        { label: 'MC Cabelinho - Minha Cura', query: 'MC Cabelinho Minha Cura' },
        { label: 'MC Poze - A Cara do Crime', query: 'MC Poze A Cara do Crime' },
        { label: 'MC Hariel - Maçã Verde', query: 'MC Hariel Maçã Verde' }
    ],
    rock: [
        { label: 'Linkin Park - Numb', query: 'Linkin Park Numb' },
        { label: 'Nirvana - Smells Like Teen Spirit', query: 'Nirvana Smells Like Teen Spirit' },
        { label: 'Queen - Bohemian Rhapsody', query: 'Queen Bohemian Rhapsody' },
        { label: 'System Of A Down - Chop Suey', query: 'System Of A Down Chop Suey' }
    ],
    raptrap: [
        { label: 'Matuê - Máquina do Tempo', query: 'Matuê Máquina do Tempo' },
        { label: 'Teto - Fim de Semana no Rio', query: 'Teto Fim de Semana no Rio' },
        { label: 'WIU - Coração de Gelo', query: 'WIU Coração de Gelo' },
        { label: 'Travis Scott - FE!N', query: 'Travis Scott FEIN' }
    ],
    eletronica: [
        { label: 'Alan Walker - Faded', query: 'Alan Walker Faded' },
        { label: 'Marshmello - Alone', query: 'Marshmello Alone' },
        { label: 'Avicii - Wake Me Up', query: 'Avicii Wake Me Up' },
        { label: 'David Guetta - Titanium', query: 'David Guetta Titanium' }
    ],
    pop: [
        { label: 'The Weeknd - Blinding Lights', query: 'The Weeknd Blinding Lights' },
        { label: 'Dua Lipa - Houdini', query: 'Dua Lipa Houdini' },
        { label: 'Billie Eilish - Happier Than Ever', query: 'Billie Eilish Happier Than Ever' },
        { label: 'Bruno Mars - 24K Magic', query: 'Bruno Mars 24K Magic' }
    ],
    sertanejo: [
        { label: 'Ana Castela - Pipoco', query: 'Ana Castela Pipoco' },
        { label: 'Jorge & Mateus - Sosseguei', query: 'Jorge e Mateus Sosseguei' },
        { label: 'Henrique & Juliano - Liberdade Provisória', query: 'Henrique e Juliano Liberdade Provisoria' },
        { label: 'Gusttavo Lima - Bloqueado', query: 'Gusttavo Lima Bloqueado' }
    ],
    lofi: [
        { label: 'Lofi Girl - beats to relax/study to', query: 'Lofi Girl beats to relax study to' },
        { label: 'Idealism - snowfall', query: 'Idealism snowfall' },
        { label: 'Kupla - Kingdom in Blue', query: 'Kupla Kingdom in Blue' }
    ],
    reggae: [
        { label: 'Bob Marley - Three Little Birds', query: 'Bob Marley Three Little Birds' },
        { label: 'SOJA - True Love', query: 'SOJA True Love' },
        { label: 'Planta e Raiz - Com Certeza', query: 'Planta e Raiz Com Certeza' }
    ],
    classica: [
        { label: 'Beethoven - Moonlight Sonata', query: 'Beethoven Moonlight Sonata' },
        { label: 'Mozart - Lacrimosa', query: 'Mozart Lacrimosa' },
        { label: 'Vivaldi - Four Seasons', query: 'Vivaldi Four Seasons' }
    ],
    geek: [
        { label: 'League of Legends - Legends Never Die', query: 'Legends Never Die League of Legends' },
        { label: 'GTA San Andreas Theme', query: 'GTA San Andreas Theme' },
        { label: 'Minecraft Sweden', query: 'Minecraft Sweden C418' },
        { label: 'Doom Eternal OST', query: 'Doom Eternal OST' }
    ],
    internacional: [
        { label: 'Imagine Dragons - Believer', query: 'Imagine Dragons Believer' },
        { label: 'Coldplay - Viva La Vida', query: 'Coldplay Viva La Vida' },
        { label: 'Eminem - Without Me', query: 'Eminem Without Me' },
        { label: 'Arctic Monkeys - Do I Wanna Know', query: 'Arctic Monkeys Do I Wanna Know' }
    ],
    chill: [
        { label: 'Cigarettes After Sex - Apocalypse', query: 'Cigarettes After Sex Apocalypse' },
        { label: 'Joji - Slow Dancing in the Dark', query: 'Joji Slow Dancing in the Dark' },
        { label: 'Keshi - Limbo', query: 'Keshi Limbo' }
    ],
    phonk: [
        { label: 'Kordhell - Murder In My Mind', query: 'Kordhell Murder In My Mind' },
        { label: 'Dxrk ダーク - RAVE', query: 'Dxrk RAVE' },
        { label: 'MoonDeity - NEON BLADE', query: 'MoonDeity NEON BLADE' }
    ],
    metal: [
        { label: 'Slipknot - Psychosocial', query: 'Slipknot Psychosocial' },
        { label: 'Metallica - Enter Sandman', query: 'Metallica Enter Sandman' },
        { label: 'Bring Me The Horizon - Can You Feel My Heart', query: 'Bring Me The Horizon Can You Feel My Heart' }
    ],
    kpop: [
        { label: 'BTS - Dynamite', query: 'BTS Dynamite' },
        { label: 'BLACKPINK - How You Like That', query: 'BLACKPINK How You Like That' },
        { label: "Stray Kids - GOD'S MENU", query: "Stray Kids God's Menu" }
    ],
    mpb: [
        { label: 'Tim Maia - Descobridor dos Sete Mares', query: 'Tim Maia Descobridor dos Sete Mares' },
        { label: 'Djavan - Oceano', query: 'Djavan Oceano' },
        { label: 'Seu Jorge - Burguesinha', query: 'Seu Jorge Burguesinha' }
    ],
    relax: [
        { label: 'Sons de Chuva para Dormir', query: 'Sons de Chuva para Dormir' },
        { label: 'Música Relaxante para Estudar', query: 'Musica Relaxante para Estudar' },
        { label: 'Piano Relaxante', query: 'Piano Relaxante' }
    ]
};

function newMusicHistoryId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newSetagemRequestId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureCanPlayNow(interaction) {
    const nodeMajor = Number(String(process.versions.node || '').split('.')[0] || 0);
    if (nodeMajor >= 24) {
        const msg =
            '❌ Node.js incompatível para voz.\n' +
            `Node atual: ${process.versions.node}\n` +
            'Use Node LTS 22 (recomendado pelo discord.js/@discordjs/voice) e reinicie o bot.';
        if (interaction?.deferred || interaction?.replied) {
            if (interaction.deferred || interaction.replied) {
    await interaction.editReply({
        content: msg
    }).catch(() => {});
}
            scheduleDeleteReply(interaction);
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        }
        return false;
    }

    if (opusAvailable) return true;
    const msg =
        '❌ Dependência de áudio ausente.\n' +
        'Instale: npm.cmd install\n' +
        'Depois reinicie o bot.\n' +
        'Se ainda não tocar, use Node LTS (22) ou instale Build Tools do Visual Studio para usar @discordjs/opus.';
    if (interaction?.deferred || interaction?.replied) {
        await safeEditReply(interaction, msg);
        scheduleDeleteReply(interaction);
    } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
    }
    return false;
}

function normalizeTitleForList(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getGuildIconUrl(guild) {
    return guild?.iconURL?.({ size: 512, extension: 'png' }) ?? null;
}

function applyGuildBranding(embed, guild) {
    const iconUrl = getGuildIconUrl(guild);
    if (iconUrl) {
        embed.setThumbnail(iconUrl);
        embed.setImage(iconUrl);
    }
    const guildName = guild?.name ?? 'Servidor';
    embed.setFooter({ text: guildName });
    embed.setTimestamp(new Date());
    return embed;
}

async function exportGuildChannelIndex(guild) {
    const channels = [];
    for (const ch of guild.channels.cache.values()) {
        channels.push({
            id: ch.id,
            name: ch.name ?? null,
            type: ch.type ?? null,
            parentId: ch.parentId ?? null,
            position: Number.isFinite(Number(ch.position)) ? Number(ch.position) : null
        });
    }

    channels.sort((a, b) => {
        const pa = a.parentId ?? '';
        const pb = b.parentId ?? '';
        if (pa !== pb) return pa.localeCompare(pb);
        return Number(a.position ?? 0) - Number(b.position ?? 0);
    });

    const payload = {
        guildId: guild.id,
        guildName: guild.name,
        exportedAt: new Date().toISOString(),
        channels
    };

    await fs.writeFile(CHANNEL_INDEX_PATH, JSON.stringify(payload, null, 2), 'utf8');
    return { path: CHANNEL_INDEX_PATH, count: channels.length };
}

async function warmupChannelsFromIndex(guild) {
    try {
        const raw = await fs.readFile(CHANNEL_INDEX_PATH, 'utf8');
        const json = JSON.parse(raw);
        const list = Array.isArray(json?.channels) ? json.channels : [];
        const ids = list.map((c) => String(c?.id ?? '')).filter((id) => /^\d{17,20}$/.test(id));
        const unique = Array.from(new Set(ids));
        for (const id of unique) {
            await guild.channels.fetch(id).catch(() => null);
        }
    } catch {}
}

async function loadGuildChannelIndex(guild) {
    try {
        const raw = await fs.readFile(CHANNEL_INDEX_PATH, 'utf8');
        const json = JSON.parse(raw);
        const list = Array.isArray(json?.channels) ? json.channels : [];
        const channels = [];
        for (const item of list) {
            const id = String(item?.id ?? '');
            if (!/^\d{17,20}$/.test(id)) continue;
            channels.push({
                id,
                name: String(item?.name ?? ''),
                type: item?.type ?? null,
                parentId: /^\d{17,20}$/.test(String(item?.parentId ?? '')) ? String(item.parentId) : null,
                position: Number.isFinite(Number(item?.position)) ? Number(item.position) : 0
            });
        }
        if (channels.length) return channels;
    } catch {}

    const channels = [];
    for (const ch of guild.channels.cache.values()) {
        channels.push({
            id: ch.id,
            name: String(ch.name ?? ''),
            type: ch.type ?? null,
            parentId: ch.parentId ?? null,
            position: Number.isFinite(Number(ch.position)) ? Number(ch.position) : 0
        });
    }
    return channels;
}

function chunkIntoPages(items, pageSize) {
    const size = Math.max(1, Number(pageSize) || 1);
    const pages = [];
    for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
    return pages.length ? pages : [[]];
}

function toSelectLabel(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '—';
    return text.length > 100 ? text.slice(0, 97) + '...' : text;
}

function toSelectDescription(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return undefined;
    return text.length > 100 ? text.slice(0, 97) + '...' : text;
}

function buildChannelIndexView(channels) {
    const byId = new Map();
    for (const c of channels) byId.set(c.id, c);

    const categories = channels
        .filter((c) => Number(c.type) === Number(ChannelType.GuildCategory))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    const categoryNameById = new Map();
    for (const cat of categories) categoryNameById.set(cat.id, cat.name || 'Categoria');

    const selectable = channels
        .filter((c) => Number(c.type) !== Number(ChannelType.GuildCategory))
        .sort((a, b) => {
            const pa = a.parentId ?? '';
            const pb = b.parentId ?? '';
            if (pa !== pb) return pa.localeCompare(pb);
            return (a.position ?? 0) - (b.position ?? 0);
        });

    return { categories, selectable, categoryNameById };
}

async function buildAdminPickerCategoryComponents({ guild, action, ownerId, page = 0, maxValues = 1 }) {
    const channels = await loadGuildChannelIndex(guild);
    const view = buildChannelIndexView(channels);
    const cats = view.categories;
    const pages = chunkIntoPages(cats, 24);
    const safePage = Math.max(0, Math.min(pages.length - 1, Number(page) || 0));
    const options = [{ label: 'Todos os canais', value: 'all', emoji: '📁', description: 'Listar todos os canais' }];
    for (const cat of pages[safePage]) {
        options.push({
            label: toSelectLabel(cat.name || 'Categoria'),
            value: `cat:${cat.id}`,
            emoji: '🗂️'
        });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`ap_cat:${action}:${ownerId}:${safePage}:${Math.max(1, Math.min(5, Number(maxValues) || 1))}`)
        .setPlaceholder('Selecione uma categoria (ou Todos)')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options.slice(0, 25));

    const rowMenu = new ActionRowBuilder().addComponents(menu);

    if (pages.length <= 1) return [rowMenu];

    const prev = new ButtonBuilder()
        .setCustomId(`apnav:cat:${action}:${ownerId}:${safePage}:${Math.max(1, Math.min(5, Number(maxValues) || 1))}:prev`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0);
    const next = new ButtonBuilder()
        .setCustomId(`apnav:cat:${action}:${ownerId}:${safePage}:${Math.max(1, Math.min(5, Number(maxValues) || 1))}:next`)
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pages.length - 1);

    const rowNav = new ActionRowBuilder().addComponents(prev, next);
    return [rowMenu, rowNav];
}

async function buildAdminPickerChannelComponents({ guild, action, ownerId, scope, page = 0, maxValues = 1 }) {
    const channels = await loadGuildChannelIndex(guild);
    const view = buildChannelIndexView(channels);
    const listAll = view.selectable;
    const parentId = scope && scope !== 'all' ? String(scope) : 'all';
    const filtered = parentId === 'all' ? listAll : listAll.filter((c) => String(c.parentId ?? '') === parentId);
    const pages = chunkIntoPages(filtered, 25);
    const safePage = Math.max(0, Math.min(pages.length - 1, Number(page) || 0));

    const options = [];
    for (const ch of pages[safePage]) {
        const catName = ch.parentId ? view.categoryNameById.get(ch.parentId) : null;
        options.push({
            label: toSelectLabel(ch.name || 'canal'),
            value: ch.id,
            description: toSelectDescription(catName ? `Categoria: ${catName}` : undefined)
        });
    }
    if (!options.length) {
        options.push({ label: 'Nenhum canal nessa categoria', value: 'none', description: 'Volte e selecione outra categoria' });
    }

    const safeMax = Math.max(1, Math.min(5, Number(maxValues) || 1));
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`ap_ch:${action}:${ownerId}:${parentId}:${safePage}:${safeMax}`)
        .setPlaceholder('Selecione o(s) canal(is)')
        .setMinValues(1)
        .setMaxValues(Math.min(safeMax, options.length))
        .addOptions(options.slice(0, 25));

    const rowMenu = new ActionRowBuilder().addComponents(menu);

    const back = new ButtonBuilder()
        .setCustomId(`apnav:back:${action}:${ownerId}:${safeMax}`)
        .setLabel('Voltar')
        .setStyle(ButtonStyle.Secondary);

    if (pages.length <= 1) {
        const rowNav = new ActionRowBuilder().addComponents(back);
        return [rowMenu, rowNav];
    }

    const prev = new ButtonBuilder()
        .setCustomId(`apnav:chan:${action}:${ownerId}:${parentId}:${safePage}:${safeMax}:prev`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0);
    const next = new ButtonBuilder()
        .setCustomId(`apnav:chan:${action}:${ownerId}:${parentId}:${safePage}:${safeMax}:next`)
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pages.length - 1);

    const rowNav = new ActionRowBuilder().addComponents(prev, next, back);
    return [rowMenu, rowNav];
}

async function handleAdminPanelChannelTargetsFromIds(interaction, action, selectedIds) {
    if (interaction.channelId !== getAdminPanelChannelId()) {
        await interaction.reply({ content: `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        return;
    }
    if (!canUseCommands(interaction.member)) {
        await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        return;
    }

    const guild = interaction.guild;
    if (!guild) {
        await interaction.update({ content: '⚠️ Servidor inválido.', components: [] }).catch(() => {});
        return;
    }

    const ids = Array.isArray(selectedIds) ? selectedIds : [];
    const targets = [];
    for (const channelId of ids) {
        if (!/^\d{17,20}$/.test(String(channelId))) continue;
        const ch = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
        if (!ch || !ch.isTextBased?.()) continue;
        targets.push(ch);
    }

    if (!targets.length) {
        await interaction.update({ content: '❌ Canal inválido.', components: [] }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        return;
    }

    const reportOk = [];
    const reportFail = [];

    try {
        if (action === 'send_music') {
            for (const ch of targets) {
                try {
                    const res = await ensureMusicPanelInChannel(ch);
                    if (res?.ok) reportOk.push(ch.id);
                    else reportFail.push(ch.id);
                } catch {
                    reportFail.push(ch.id);
                }
            }
            const msg = `✅ Painel de música enviado.\n${reportOk.length ? `Sucesso: ${reportOk.map((c) => `<#${c}>`).join(', ')}` : 'Sucesso: —'}${
                reportFail.length ? `\nFalhou: ${reportFail.map((c) => `<#${c}>`).join(', ')}` : ''
            }`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'send_tickets') {
            for (const ch of targets) {
                try {
                    await ch.send({ embeds: [createTicketPanelEmbed(guild)], components: createTicketPanelRows() });
                    reportOk.push(ch.id);
                } catch {
                    reportFail.push(ch.id);
                }
            }
            const msg = `✅ Painel de tickets enviado.\n${reportOk.length ? `Sucesso: ${reportOk.map((c) => `<#${c}>`).join(', ')}` : 'Sucesso: —'}${
                reportFail.length ? `\nFalhou: ${reportFail.map((c) => `<#${c}>`).join(', ')}` : ''
            }`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'send_ticketfarm') {
            for (const ch of targets) {
                try {
                    await ch.send({ embeds: [createTicketFarmPanelEmbed(guild)], components: createTicketFarmPanelRows() });
                    reportOk.push(ch.id);
                } catch {
                    reportFail.push(ch.id);
                }
            }
            const msg = `✅ Painel TicketFarm enviado.\n${reportOk.length ? `Sucesso: ${reportOk.map((c) => `<#${c}>`).join(', ')}` : 'Sucesso: —'}${
                reportFail.length ? `\nFalhou: ${reportFail.map((c) => `<#${c}>`).join(', ')}` : ''
            }`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'send_verificacao') {
            for (const ch of targets) {
                try {
                    await ch.send({ embeds: [createAgeVerificationEmbed(guild)], components: createAgeVerificationRows() });
                    reportOk.push(ch.id);
                } catch {
                    reportFail.push(ch.id);
                }
            }
            const msg = `✅ Painel de verificação enviado.\n${reportOk.length ? `Sucesso: ${reportOk.map((c) => `<#${c}>`).join(', ')}` : 'Sucesso: —'}${
                reportFail.length ? `\nFalhou: ${reportFail.map((c) => `<#${c}>`).join(', ')}` : ''
            }`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'send_calc') {
            for (const ch of targets) {
                try {
                    await ch.send({ embeds: [createCalcPanelEmbed(guild)], components: createCalcPanelRows() });
                    reportOk.push(ch.id);
                } catch {
                    reportFail.push(ch.id);
                }
            }
            const msg = `✅ Painel de calculadora enviado.\n${reportOk.length ? `Sucesso: ${reportOk.map((c) => `<#${c}>`).join(', ')}` : 'Sucesso: —'}${
                reportFail.length ? `\nFalhou: ${reportFail.map((c) => `<#${c}>`).join(', ')}` : ''
            }`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'send_setagem') {
            for (const ch of targets) {
                try {
                    await ch.send({ embeds: [createSetagemPanelEmbed(guild)], components: createSetagemPanelRows() });
                    reportOk.push(ch.id);
                } catch {
                    reportFail.push(ch.id);
                }
            }
            const msg = `✅ Painel de setagem enviado.\n${reportOk.length ? `Sucesso: ${reportOk.map((c) => `<#${c}>`).join(', ')}` : 'Sucesso: —'}${
                reportFail.length ? `\nFalhou: ${reportFail.map((c) => `<#${c}>`).join(', ')}` : ''
            }`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'setagem_aprovacao') {
            const ch = targets[0];
            await updateSetagemConfig({ approvalChannelId: ch.id });
            await interaction.update({ content: `✅ Canal de aprovação da setagem configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'setagem_painel') {
            const ch = targets[0];
            await updateSetagemConfig({ panelChannelId: ch.id });
            await interaction.update({ content: `✅ Canal do painel de setagem configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'setagem_lista') {
            const ch = targets[0];
            await updateSetagemConfig({ listChannelId: ch.id });
            await interaction.update({ content: `✅ Canal da lista da setagem configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'setagem_logs') {
            const ch = targets[0];
            await updateSetagemConfig({ logChannelId: ch.id });
            await interaction.update({ content: `✅ Canal de logs da setagem configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'verificacao_logs') {
            const ch = targets[0];
            await updateRootConfig({ logVerificacaoId: ch.id });
            await interaction.update({ content: `✅ Canal de logs da verificação configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'music_panel_channel') {
            const ch = targets[0];
            await updateRootConfig({ musicPanelChannelId: ch.id });
            await interaction.update({ content: `✅ Canal do painel de música configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'commands_allowed_channel') {
            const ch = targets[0];
            await updateRootConfig({ commandsAllowedChannelId: ch.id });
            await interaction.update({ content: `✅ Canal permitido para comandos configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'painel_adm_channel') {
            const ch = targets[0];
            await updateRootConfig({ painelAdmCommandChannelId: ch.id });
            await interaction.update({ content: `✅ Canal para comandos do painel ADM configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'welcome_channel') {
            const ch = targets[0];
            await updateRootConfig({ welcomeChannelId: ch.id });
            await interaction.update({ content: `✅ Canal de boas-vindas configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'goodbye_channel') {
            const ch = targets[0];
            await updateRootConfig({ goodbyeChannelId: ch.id });
            await interaction.update({ content: `✅ Canal de despedidas configurado: <#${ch.id}>`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'imagens_seq') {
            const pending = pendingAdminActionByUserId.get(interaction.user.id);
            if (!pending || pending.action !== 'imagens_seq' || !Array.isArray(pending.urls) || !pending.urls.length) {
                await interaction.update({ content: '⚠️ Ação expirada. Abra o formulário novamente.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const urls = pending.urls;
            const titulo = String(pending.title ?? '').trim();
            const mensagem = String(pending.mensagem ?? '').trim();
            pendingAdminActionByUserId.delete(interaction.user.id);

            await interaction.update({ content: '⏳ Enviando imagens...', components: [] }).catch(() => {});

            const delayMs = async (ms) => {
                await new Promise((r) => setTimeout(r, ms));
            };

            const reportOk = [];
            const reportFail = [];

            for (const ch of targets) {
                let sentCount = 0;
                try {
                    for (let i = 0; i < urls.length; i++) {
                        const url = urls[i];
                        const baseTitle = titulo ? titulo.slice(0, 180) : '🖼️ Imagens';
                        const embed = new EmbedBuilder()
                            .setColor(0x111827)
                            .setTitle(`${baseTitle} (${i + 1}/${urls.length})`)
                            .setImage(url);
                        if (i === 0 && mensagem) embed.setDescription(mensagem.slice(0, 3900));
                        applyGuildBranding(embed, guild);
                        await ch.send({ embeds: [embed] });
                        sentCount++;
                        if (i < urls.length - 1) await delayMs(650);
                    }
                    reportOk.push(`${ch.id}:${sentCount}`);
                } catch {
                    reportFail.push(`${ch.id}:${sentCount}`);
                }
            }

            const okText = reportOk.length
                ? reportOk.map((x) => {
                      const [id, count] = String(x).split(':');
                      return `<#${id}> (${count})`;
                  }).join(', ')
                : '—';
            const failText = reportFail.length
                ? reportFail.map((x) => {
                      const [id, count] = String(x).split(':');
                      return `<#${id}> (${count})`;
                  }).join(', ')
                : '';
            const msg = `🖼️ Imagens sequenciais enviadas.\nSucesso: ${okText}${failText ? `\nFalhou: ${failText}` : ''}\nTotal: ${urls.length} imagem(ns).`;
            await interaction.editReply({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, 60000);
            return;
        }

        if (action === 'metas') {
            const pending = pendingAdminActionByUserId.get(interaction.user.id);
            if (!pending || pending.action !== 'metas' || !String(pending.mensagem ?? '').trim()) {
                await interaction.update({ content: '⚠️ Ação expirada. Abra o formulário novamente.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const ch = targets[0];
            pendingAdminActionByUserId.delete(interaction.user.id);
            const embed = createMetasEmbed({
                guild,
                title: pending.title,
                message: pending.mensagem,
                authorTag: pending.authorTag ?? interaction.user.tag,
                authorId: pending.authorId ?? interaction.user.id,
                authorAvatarUrl: pending.authorAvatarUrl ?? getUserAvatarUrl(interaction.user)
            });
            await ch.send({ embeds: [embed] });
            await interaction.update({ content: `✅ Metas enviadas em <#${ch.id}>.`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'regras') {
            const pending = pendingAdminActionByUserId.get(interaction.user.id);
            if (!pending || pending.action !== 'regras' || !String(pending.mensagem ?? '').trim()) {
                await interaction.update({ content: '⚠️ Ação expirada. Abra o formulário novamente.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const ch = targets[0];
            pendingAdminActionByUserId.delete(interaction.user.id);
            const embed = createRegrasEmbed({
                guild,
                title: pending.title,
                message: pending.mensagem,
                authorTag: pending.authorTag ?? interaction.user.tag,
                authorId: pending.authorId ?? interaction.user.id,
                authorAvatarUrl: pending.authorAvatarUrl ?? getUserAvatarUrl(interaction.user)
            });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Regras da City').setStyle(ButtonStyle.Link).setURL(pending.linkCity),
                new ButtonBuilder().setLabel('Regras da Fac').setStyle(ButtonStyle.Link).setURL(pending.linkFac)
            );
            await ch.send({ embeds: [embed], components: [row] });
            await interaction.update({ content: `✅ Regras enviadas em <#${ch.id}>.`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'radio') {
            const pending = pendingAdminActionByUserId.get(interaction.user.id);
            if (!pending || pending.action !== 'radio' || !String(pending.frequencia ?? '').trim() || !String(pending.descricao ?? '').trim()) {
                await interaction.update({ content: '⚠️ Ação expirada. Abra o formulário novamente.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const ch = targets[0];
            pendingAdminActionByUserId.delete(interaction.user.id);
            const embed = createRadioEmbed({
                guild,
                frequencia: pending.frequencia,
                descricao: pending.descricao,
                authorTag: pending.authorTag ?? interaction.user.tag,
                authorId: pending.authorId ?? interaction.user.id,
                authorAvatarUrl: pending.authorAvatarUrl ?? getUserAvatarUrl(interaction.user)
            });
            await ch.send({ embeds: [embed] });
            await interaction.update({ content: `✅ Rádio da fac enviada em <#${ch.id}>.`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'avisogeral') {
            const pending = pendingAdminActionByUserId.get(interaction.user.id);
            if (!pending || pending.action !== 'avisogeral' || !String(pending.descricao ?? '').trim() || !String(pending.mensagem ?? '').trim()) {
                await interaction.update({ content: '⚠️ Ação expirada. Abra o formulário novamente.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const ch = targets[0];
            pendingAdminActionByUserId.delete(interaction.user.id);
            const embed = createAvisoGeralEmbed({
                guild,
                descricao: pending.descricao,
                mensagem: pending.mensagem,
                authorTag: pending.authorTag ?? interaction.user.tag,
                authorId: pending.authorId ?? interaction.user.id,
                authorAvatarUrl: pending.authorAvatarUrl ?? getUserAvatarUrl(interaction.user)
            });
            await ch.send({ embeds: [embed] });
            await interaction.update({ content: `✅ Aviso geral enviado em <#${ch.id}>.`, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'avisocanais') {
            const pending = pendingAdminActionByUserId.get(interaction.user.id);
            if (!pending || pending.action !== 'avisocanais' || !String(pending.mensagem ?? '').trim()) {
                await interaction.update({ content: '⚠️ Ação expirada. Abra o modal novamente.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const mensagem = String(pending.mensagem).trim();
            pendingAdminActionByUserId.delete(interaction.user.id);

            for (const ch of targets) {
                try {
                    await ch.send({ content: mensagem });
                    reportOk.push(ch.id);
                } catch {
                    reportFail.push(ch.id);
                }
            }

            const msg = `📣 Aviso enviado.\n${reportOk.length ? `Sucesso: ${reportOk.map((c) => `<#${c}>`).join(', ')}` : 'Sucesso: —'}${
                reportFail.length ? `\nFalhou: ${reportFail.map((c) => `<#${c}>`).join(', ')}` : ''
            }`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'limparlogs') {
            const pending = pendingAdminActionByUserId.get(interaction.user.id);
            if (!pending || pending.action !== 'limparlogs' || !Number.isFinite(Number(pending.quantidade))) {
                await interaction.update({ content: '⚠️ Ação expirada. Abra o modal novamente.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !canUseCommands(interaction.member)) {
                await interaction.update({ content: '❌ Você não tem permissão para limpar mensagens.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const quantidade = Math.floor(Number(pending.quantidade));
            pendingAdminActionByUserId.delete(interaction.user.id);

            const ch = targets[0];
            if (typeof ch.bulkDelete !== 'function') {
                await interaction.update({ content: `❌ Não dá para limpar mensagens nesse canal: <#${ch.id}>.`, components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            const deleted = await ch.bulkDelete(quantidade, true).catch(() => null);
            const msg = deleted
                ? `🧹 Limpeza concluída em <#${ch.id}>.\nApagadas: ${deleted.size}/${quantidade} (mensagens com mais de 14 dias não podem ser apagadas).`
                : `❌ Não consegui limpar as mensagens em <#${ch.id}>.`;
            await interaction.update({ content: msg, components: [] }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        await interaction.update({ content: '⚠️ Ação inválida.', components: [] }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
    } catch (err) {
        logError('Erro no admin picker', err);
        await interaction.update({ content: '❌ Erro ao executar a ação.', components: [] }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
    }
}

function formatDiscordTimestampMs(ms) {
    if (!Number.isFinite(Number(ms))) return '—';
    return `<t:${Math.floor(Number(ms) / 1000)}:F>`;
}

function formatDurationMs(ms) {
    const total = Math.max(0, Math.floor(Number(ms) || 0));
    const sec = Math.floor(total / 1000);
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const minutes = Math.floor((sec % 3600) / 60);

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
}

function getUserAvatarUrl(user) {
    return user?.displayAvatarURL?.({ size: 512, extension: 'png' }) ?? null;
}

function createWelcomeEmbed({ guild, member, joinedAtMs }) {
    const user = member?.user ?? null;
    const avatarUrl = getUserAvatarUrl(user);
    const embed = new EmbedBuilder()
        .setTitle('👋 Bem-vindo(a) ao servidor!')
        .setColor(0x22c55e)
        .setDescription(
            [
                `${member} acabou de entrar no **${guild?.name ?? 'Servidor'}**.`,
                '',
                '━━━━━━━━━━━━━━━━━━━━',
                'Leia as regras e aproveite a comunidade.',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        );
    embed.addFields(
        { name: 'Usuário', value: `${user?.tag ?? '—'}`, inline: true },
        { name: 'ID', value: `${user?.id ?? '—'}`, inline: true },
        { name: 'Entrada', value: formatDiscordTimestampMs(joinedAtMs), inline: false }
    );
    applyGuildBranding(embed, guild);
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    return embed;
}

function createGoodbyeEmbed({ guild, userId, userTag, joinedAtMs, leftAtMs, avatarUrl }) {
    const duration = joinedAtMs ? formatDurationMs(Number(leftAtMs) - Number(joinedAtMs)) : '—';
    const embed = new EmbedBuilder()
        .setTitle('👋 Adeus!')
        .setColor(0xef4444)
        .setDescription(
            [
                `O usuário <@${userId}> (${userTag}) saiu do servidor.`,
                '',
                '━━━━━━━━━━━━━━━━━━━━',
                'Esperamos te ver novamente.',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        );
    embed.addFields(
        { name: 'Entrada', value: formatDiscordTimestampMs(joinedAtMs), inline: true },
        { name: 'Saída', value: formatDiscordTimestampMs(leftAtMs), inline: true },
        { name: 'Tempo no servidor', value: duration, inline: false }
    );
    applyGuildBranding(embed, guild);
    if (avatarUrl) embed.setImage(avatarUrl);
    return embed;
}

function getVoiceTimeoutHelp() {
    return (
        '❌ Timeout ao entrar na sala de voz.\n' +
        'Possíveis causas:\n' +
        '• Firewall/antivírus bloqueando node.exe (libere em Rede Privada)\n' +
        '• VPN/Proxy ativo\n' +
        '• Canal de voz com permissões/limite\n' +
        'Dica: feche outras instâncias do bot e reinicie.'
    );
}

async function loadMusicHistory() {
    try {
        const raw = await fs.readFile(MUSIC_HISTORY_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) musicHistory = data;
    } catch {
        musicHistory = [];
    }
}

function saveMusicHistory() {
    const snapshot = musicHistory;
    musicHistoryWriteChain = musicHistoryWriteChain
        .then(() => fs.writeFile(MUSIC_HISTORY_PATH, JSON.stringify(snapshot, null, 2), 'utf8'))
        .catch(() => {});
}

function recordPlayedTrack(guildId, track) {
    const url = String(track?.url ?? '').trim();
    const type = playdl.validate(url);
    if (type !== 'yt_video' && type !== 'yt_short' && type !== 'yt_music_video') return;

    const entry = {
        id: newMusicHistoryId(),
        guildId: String(guildId),
        url,
        title: normalizeTitleForList(track?.title || 'Sem título'),
        playedAt: Date.now(),
        playedById: track?.requestedById ? String(track.requestedById) : null
    };

    musicHistory.push(entry);
    if (musicHistory.length > 5000) musicHistory = musicHistory.slice(musicHistory.length - 5000);
    saveMusicHistory();
}

function getGuildMusicHistory(guildId) {
    const id = String(guildId);
    const list = musicHistory.filter((e) => e && String(e.guildId) === id);
    return list.sort((a, b) => Number(b.playedAt || 0) - Number(a.playedAt || 0));
}

function parseYouTubeSearchQueryFromUrl(value) {
    try {
        const u = new URL(String(value));
        const host = String(u.hostname || '').toLowerCase();
        if (!host.endsWith('youtube.com')) return null;
        if (u.pathname !== '/results') return null;
        const q = u.searchParams.get('search_query');
        const query = String(q ?? '').trim();
        return query ? query : null;
    } catch {
        return null;
    }
}

async function youtubeSearchFirstUrl(query) {
    try {
        const results = await withTimeout(playdl.search(query, { limit: 1 }), 15000, 'yt-search');
        const first = Array.isArray(results) ? results[0] : null;
        const url = first?.url;
        if (!url || typeof url !== 'string') return null;
        return { url, title: first?.title || 'Sem título' };
    } catch {
        return null;
    }
}

function parseStyles(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return [];
    return text
        .split(/[,\n;]/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
}

async function buildMixTracks({ styles, total, requestedById, guildName }) {
    const wanted = Math.max(1, Math.min(50, Number(total) || 1));
    const styleList = styles?.length ? styles : MIX_STYLES;
    const cacheByStyle = new Map();
    const indexByStyle = new Map();
    const usedUrls = new Set();
    const tracks = [];

    let guard = 0;
    while (tracks.length < wanted && guard++ < wanted * 15) {
        const style = styleList[tracks.length % styleList.length];

        if (!cacheByStyle.has(style)) {
            const query = `${style} mix`;
            const results = await withTimeout(playdl.search(query, { limit: 10 }), 15000, 'yt-search-mix').catch(() => []);
            cacheByStyle.set(style, Array.isArray(results) ? results : []);
            indexByStyle.set(style, 0);
        }

        const list = cacheByStyle.get(style) ?? [];
        let idx = indexByStyle.get(style) ?? 0;

        let picked = null;
        while (idx < list.length) {
            const item = list[idx++];
            const url = item?.url;
            if (!url || typeof url !== 'string') continue;
            if (usedUrls.has(url)) continue;
            usedUrls.add(url);
            picked = item;
            break;
        }
        indexByStyle.set(style, idx);

        if (!picked) continue;

        tracks.push({
            url: picked.url,
            title: picked.title || 'Sem título',
            requestedById,
            source: 'YouTube',
            guildName
        });
    }

    return tracks;
}

function buildMusicPanelEmbed(guild) {
    const embed = new EmbedBuilder()
        .setTitle('🎵 Central de Música')
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Use o painel abaixo para tocar música na sala de voz.',
                '',
                '📌 Como usar:',
                '• Entre em uma sala de voz',
                '• Use "Play" para colar um link do YouTube/playlist ou escrever o nome da música',
                '• Ou escolha um estilo e uma música no menu',
                '',
                '⚠️ Dica: links de busca do YouTube (/results?search_query=...) também funcionam.',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        )
        .setColor(0x1db954);
    return applyGuildBranding(embed, guild);
}

function buildMusicPanelComponents() {
    const rowMain = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('musicpanel_addlink').setLabel('Play').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('musicpanel_nowplaying').setLabel('Tocando').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('musicpanel_queue').setLabel('Fila').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('musicpanel_shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('musicpanel_loop').setLabel('Loop').setStyle(ButtonStyle.Secondary)
    );

    const rowControls = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('musicpanel_pause').setLabel('Pausar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('musicpanel_resume').setLabel('Retomar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('musicpanel_skip').setLabel('Pular').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('musicpanel_stop').setLabel('Parar').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('musicpanel_volume').setLabel('Volume').setStyle(ButtonStyle.Secondary)
    );

    const categoryOptions = [
        { label: 'Funk', value: 'funk', emoji: '🔥' },
        { label: 'Rock', value: 'rock', emoji: '🎸' },
        { label: 'Rap / Trap', value: 'raptrap', emoji: '🎤' },
        { label: 'Eletrônica', value: 'eletronica', emoji: '🎧' },
        { label: 'Pop', value: 'pop', emoji: '🎶' },
        { label: 'Sertanejo', value: 'sertanejo', emoji: '🇧🇷' },
        { label: 'Lo-Fi', value: 'lofi', emoji: '🎹' },
        { label: 'Reggae', value: 'reggae', emoji: '🌴' },
        { label: 'Clássica', value: 'classica', emoji: '🎻' },
        { label: 'Geek / Games', value: 'geek', emoji: '🎮' },
        { label: 'Internacional', value: 'internacional', emoji: '🌎' },
        { label: 'Chill / Vibe', value: 'chill', emoji: '😎' },
        { label: 'Phonk', value: 'phonk', emoji: '🚗' },
        { label: 'Metal', value: 'metal', emoji: '💀' },
        { label: 'K-POP', value: 'kpop', emoji: '🇰🇷' },
        { label: 'MPB', value: 'mpb', emoji: '🎼' },
        { label: 'Relaxantes', value: 'relax', emoji: '🌊' }
    ];

    const categoryMenu = new StringSelectMenuBuilder()
        .setCustomId('musicpanel_category')
        .setPlaceholder('Escolha um estilo para ver músicas')
        .addOptions(categoryOptions);

    const rowCategory = new ActionRowBuilder().addComponents(categoryMenu);
    const rowLibrary = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('musicpanel_mix').setLabel('Mix').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('musicpanel_lista').setLabel('Lista').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('musicpanel_history').setLabel('Playlist').setStyle(ButtonStyle.Secondary)
    );
    return [rowMain, rowControls, rowCategory, rowLibrary];
}

async function ensureMusicPanelInChannel(channel) {
    if (!channel || !channel.isTextBased?.()) return { ok: false, reason: 'CHANNEL_INVALID' };
    const recent = await channel.messages?.fetch({ limit: 100 }).catch(() => null);
    const panels = [];
    const collect = (batch) => {
        if (!batch) return;
        for (const msg of batch.values()) {
            if (msg.author?.id !== client.user?.id) continue;
            const hasPanel = (msg.components ?? []).some((row) =>
                (row.components ?? []).some((c) => typeof c.customId === 'string' && c.customId.startsWith(MUSIC_PANEL_CUSTOM_PREFIX))
            );
            if (hasPanel) panels.push(msg);
        }
    };
    collect(recent);
    if (panels.length === 0 && recent?.size) {
        let before = recent.last()?.id ?? null;
        const maxPages = 10;
        for (let i = 0; i < maxPages && before; i++) {
            const older = await channel.messages?.fetch({ limit: 100, before }).catch(() => null);
            if (!older || older.size === 0) break;
            collect(older);
            before = older.last()?.id ?? null;
        }
    }

    panels.sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0));
    const primary = panels[0] ?? null;
    const duplicates = panels.slice(1);
    const payload = { embeds: [buildMusicPanelEmbed(channel.guild)], components: buildMusicPanelComponents() };

    if (primary) {
        const edited = await primary.edit(payload).catch(() => null);
        if (!edited) {
            const sent = await channel.send(payload).catch(() => null);
            if (!sent) return { ok: false, reason: 'SEND_FAILED' };
        }
    } else {
        const sent = await channel.send(payload).catch(() => null);
        if (!sent) return { ok: false, reason: 'SEND_FAILED' };
    }

    for (const msg of duplicates) await msg.delete().catch(() => {});
    return { ok: true };
}

async function ensureMusicPanel() {
    if (ensureMusicPanelRunning) return;
    ensureMusicPanelRunning = true;
    try {
    const channelId = MUSIC_PANEL_CHANNEL_ID;
    if (!/^\d{17,20}$/.test(String(channelId))) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const panels = [];
    if (recent) {
        for (const msg of recent.values()) {
            if (msg.author?.id !== client.user?.id) continue;
            const hasMusicPanel = (msg.components ?? []).some((row) =>
                (row.components ?? []).some((c) => typeof c.customId === 'string' && c.customId.startsWith(MUSIC_PANEL_CUSTOM_PREFIX))
            );
            if (hasMusicPanel) panels.push(msg);
        }
    }

    panels.sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0));
    const primary = panels[0] ?? null;
    const duplicates = panels.slice(1);

    const payload = { embeds: [buildMusicPanelEmbed(channel.guild)], components: buildMusicPanelComponents() };
    if (primary) {
        const edited = await primary.edit(payload).catch(() => null);
        if (!edited) {
            await channel.send(payload).catch(() => {});
        }
    } else {
        await channel.send(payload).catch(() => {});
    }

    for (const msg of duplicates) {
        await msg.delete().catch(() => {});
    }
    } finally {
        ensureMusicPanelRunning = false;
    }
}

function buildAdminPanelEmbed(guild) {
    const embed = new EmbedBuilder()
        .setTitle('🧩 Painel Central')
        .setColor(0x111827)
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Use o menu abaixo para executar tudo que o bot faz.',
                '',
                '📌 Fluxo padrão:',
                '• Clique na ação',
                '• Selecione o canal quando for solicitado',
                '• Em "Limpar Msgs", informe a quantidade e escolha o canal',
                '',
                '⚠️ Este painel só funciona a partir do canal configurado.',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        );
    return applyGuildBranding(embed, guild);
}

function buildAdminPanelComponents() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('adminpanel_menu')
        .setPlaceholder('Selecione uma ação')
        .addOptions(
            { label: 'Enviar Painel Música', value: 'adminpanel_send_music', emoji: '🎵' },
            { label: 'Enviar Painel Tickets', value: 'adminpanel_send_tickets', emoji: '🎫' },
            { label: 'Enviar Painel TicketFarm', value: 'adminpanel_send_ticketfarm', emoji: '🌾' },
            { label: 'Enviar Painel Setagem', value: 'adminpanel_send_setagem', emoji: '🧾' },
            { label: 'Enviar Painel Verificação', value: 'adminpanel_send_verificacao', emoji: '✅' },
            { label: 'Enviar Painel Calculadora', value: 'adminpanel_send_calc', emoji: '🧮' },
            { label: 'Limpar Msgs (Bulk Delete)', value: 'adminpanel_limparlogs', emoji: '🧹' },
            { label: 'Cargos (Adicionar/Remover)', value: 'adminpanel_cargos', emoji: '🎭' },
            { label: 'Metas', value: 'adminpanel_metas', emoji: '🎯' },
            { label: 'Regras', value: 'adminpanel_regras', emoji: '📜' },
            { label: 'Imagens Sequenciais', value: 'adminpanel_imagens_seq', emoji: '🖼️' },
            { label: 'Rádio da Fac', value: 'adminpanel_radio', emoji: '📻' },
            { label: 'Aviso em Canais', value: 'adminpanel_avisocanais', emoji: '📢' },
            { label: 'Aviso para User', value: 'adminpanel_avisouser', emoji: '👤' },
            { label: 'Aviso Geral', value: 'adminpanel_avisogeral', emoji: '📣' },
            { label: 'Verificação: Canal de Logs', value: 'adminpanel_verificacao_logs', emoji: '📋' },
            { label: 'Música: Canal do Painel', value: 'adminpanel_music_panel_channel', emoji: '🎵' },
            { label: 'Comandos: Canal Permitido', value: 'adminpanel_commands_allowed_channel', emoji: '⚙️' },
            { label: 'Painel ADM: Canal de Comando', value: 'adminpanel_painel_adm_channel', emoji: '🧩' },
            { label: 'Boas-vindas: Canal', value: 'adminpanel_welcome_channel', emoji: '👋' },
            { label: 'Despedidas: Canal', value: 'adminpanel_goodbye_channel', emoji: '👋' },
            { label: 'Setagem: Canal do Painel', value: 'adminpanel_setagem_painelcanal', emoji: '⚙️' },
            { label: 'Setagem: Canal de Aprovação', value: 'adminpanel_setagem_aprovacao', emoji: '✅' },
            { label: 'Setagem: Canal da Lista', value: 'adminpanel_setagem_lista', emoji: '📋' },
            { label: 'Setagem: Canal de Logs', value: 'adminpanel_setagem_logs', emoji: '🧾' },
            { label: 'Exportar IDs (Canais/Categorias)', value: 'adminpanel_exportar_ids', emoji: '🗂️' },
            { label: 'Atualizar Painel Central', value: 'adminpanel_refresh', emoji: '🔄' }
        );

    const rowMenu = new ActionRowBuilder().addComponents(menu);
    return [rowMenu];
}

async function runAdminPanelAction(interaction, id) {
    if (id === 'adminpanel_refresh') {
        const payload = { embeds: [buildAdminPanelEmbed(interaction.guild)], components: buildAdminPanelComponents() };
        await interaction.message.edit(payload).catch(async () => {
            await ensureAdminPanel().catch(() => {});
        });
        await interaction.reply({ content: '✅ Painel atualizado.', flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        return;
    }

    if (id === 'adminpanel_send_music') {
        await promptAdminChannelSelect(interaction, { action: 'send_music', content: 'Selecione o canal para enviar o painel de música.' });
        return;
    }
    if (id === 'adminpanel_send_tickets') {
        await promptAdminChannelSelect(interaction, { action: 'send_tickets', content: 'Selecione o canal para enviar o painel de tickets.' });
        return;
    }
    if (id === 'adminpanel_send_ticketfarm') {
        await promptAdminChannelSelect(interaction, { action: 'send_ticketfarm', content: 'Selecione o canal para enviar o painel TicketFarm.' });
        return;
    }
    if (id === 'adminpanel_send_verificacao') {
        await promptAdminChannelSelect(interaction, { action: 'send_verificacao', content: 'Selecione o canal para enviar o painel de verificação.' });
        return;
    }
    if (id === 'adminpanel_send_calc') {
        await promptAdminChannelSelect(interaction, { action: 'send_calc', content: 'Selecione o canal para enviar o painel de calculadora.' });
        return;
    }
    if (id === 'adminpanel_send_setagem') {
        await promptAdminChannelSelect(interaction, { action: 'send_setagem', content: 'Selecione o canal para enviar o painel de setagem.' });
        return;
    }
    if (id === 'adminpanel_verificacao_logs') {
        await promptAdminChannelSelect(interaction, { action: 'verificacao_logs', content: 'Selecione o canal de logs da verificação (18+).' });
        return;
    }
    if (id === 'adminpanel_music_panel_channel') {
        await promptAdminChannelSelect(interaction, { action: 'music_panel_channel', content: 'Selecione o canal para o painel de música.' });
        return;
    }
    if (id === 'adminpanel_commands_allowed_channel') {
        await promptAdminChannelSelect(interaction, { action: 'commands_allowed_channel', content: 'Selecione o canal permitido para comandos.' });
        return;
    }
    if (id === 'adminpanel_painel_adm_channel') {
        await promptAdminChannelSelect(interaction, { action: 'painel_adm_channel', content: 'Selecione o canal para comandos do painel ADM.' });
        return;
    }
    if (id === 'adminpanel_welcome_channel') {
        await promptAdminChannelSelect(interaction, { action: 'welcome_channel', content: 'Selecione o canal de boas-vindas.' });
        return;
    }
    if (id === 'adminpanel_goodbye_channel') {
        await promptAdminChannelSelect(interaction, { action: 'goodbye_channel', content: 'Selecione o canal de despedidas.' });
        return;
    }
    if (id === 'adminpanel_setagem_painelcanal') {
        await promptAdminChannelSelect(interaction, { action: 'setagem_painel', content: 'Selecione o canal onde ficará o painel de setagem.' });
        return;
    }
    if (id === 'adminpanel_setagem_aprovacao') {
        await promptAdminChannelSelect(interaction, { action: 'setagem_aprovacao', content: 'Selecione o canal onde a equipe vai aprovar/reprovar as setagens.' });
        return;
    }
    if (id === 'adminpanel_setagem_lista') {
        await promptAdminChannelSelect(interaction, { action: 'setagem_lista', content: 'Selecione o canal para listar as setagens aprovadas.' });
        return;
    }
    if (id === 'adminpanel_setagem_logs') {
        await promptAdminChannelSelect(interaction, { action: 'setagem_logs', content: 'Selecione o canal de logs da setagem.' });
        return;
    }
    if (id === 'adminpanel_exportar_ids') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        try {
            const res = await exportGuildChannelIndex(interaction.guild);
            await warmupChannelsFromIndex(interaction.guild);
            const file = new AttachmentBuilder(res.path, { name: 'canais-categorias.json' });
            await interaction.editReply({
                content: `✅ Exportado: ${res.count} item(ns) (canais + categorias).`,
                files: [file]
            });
            scheduleDeleteReplyMs(interaction, 60000);
        } catch (err) {
            logError('Erro ao exportar IDs de canais/categorias', err);
            await interaction.editReply('❌ Erro ao exportar IDs. Veja o console.').catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        }
        return;
    }

    if (id === 'adminpanel_imagens_seq') {
        const modal = new ModalBuilder().setCustomId('adminpanel_imagens_seq_modal').setTitle('Imagens Sequenciais');
        const inputTitle = new TextInputBuilder()
            .setCustomId('adminpanel_imagens_seq_title')
            .setLabel('Título (opcional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(120);
        const inputMsg = new TextInputBuilder()
            .setCustomId('adminpanel_imagens_seq_msg')
            .setLabel('Mensagem (opcional) — aparece na 1ª imagem')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1500);
        const inputUrls = new TextInputBuilder()
            .setCustomId('adminpanel_imagens_seq_urls')
            .setLabel('Links das imagens (1 por linha)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1900);
        modal.addComponents(
            new ActionRowBuilder().addComponents(inputTitle),
            new ActionRowBuilder().addComponents(inputMsg),
            new ActionRowBuilder().addComponents(inputUrls)
        );
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_avisocanais') {
        const modal = new ModalBuilder().setCustomId('adminpanel_avisocanais_modal').setTitle('Aviso em Canais');
        const input = new TextInputBuilder()
            .setCustomId('adminpanel_aviso_msg')
            .setLabel('Mensagem do aviso')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1900);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_avisouser') {
        const modal = new ModalBuilder().setCustomId('adminpanel_avisouser_modal').setTitle('Aviso para Usuário');
        const inputUser = new TextInputBuilder()
            .setCustomId('adminpanel_avisouser_user')
            .setLabel('ID ou @menção do usuário')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);
        const inputMsg = new TextInputBuilder()
            .setCustomId('adminpanel_avisouser_msg')
            .setLabel('Mensagem')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1900);
        modal.addComponents(new ActionRowBuilder().addComponents(inputUser), new ActionRowBuilder().addComponents(inputMsg));
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_metas') {
        const modal = new ModalBuilder().setCustomId('adminpanel_metas_modal').setTitle('Metas');
        const inputTitle = new TextInputBuilder()
            .setCustomId('adminpanel_metas_title')
            .setLabel('Título (opcional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(80);
        const inputMsg = new TextInputBuilder()
            .setCustomId('adminpanel_metas_msg')
            .setLabel('Mensagem das metas')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1900);
        modal.addComponents(new ActionRowBuilder().addComponents(inputTitle), new ActionRowBuilder().addComponents(inputMsg));
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_regras') {
        const modal = new ModalBuilder().setCustomId('adminpanel_regras_modal').setTitle('Regras');
        const inputTitle = new TextInputBuilder()
            .setCustomId('adminpanel_regras_title')
            .setLabel('Título (opcional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(80);
        const inputMsg = new TextInputBuilder()
            .setCustomId('adminpanel_regras_msg')
            .setLabel('Mensagem das regras')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1900);
        const inputCity = new TextInputBuilder()
            .setCustomId('adminpanel_regras_city')
            .setLabel('Link regras da city')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200);
        const inputFac = new TextInputBuilder()
            .setCustomId('adminpanel_regras_fac')
            .setLabel('Link regras da fac')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200);
        modal.addComponents(
            new ActionRowBuilder().addComponents(inputTitle),
            new ActionRowBuilder().addComponents(inputMsg),
            new ActionRowBuilder().addComponents(inputCity),
            new ActionRowBuilder().addComponents(inputFac)
        );
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_radio') {
        const modal = new ModalBuilder().setCustomId('adminpanel_radio_modal').setTitle('Rádio da Fac');
        const inputFreq = new TextInputBuilder()
            .setCustomId('adminpanel_radio_freq')
            .setLabel('Frequência')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(40);
        const inputDesc = new TextInputBuilder()
            .setCustomId('adminpanel_radio_desc')
            .setLabel('Descrição')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1900);
        modal.addComponents(new ActionRowBuilder().addComponents(inputFreq), new ActionRowBuilder().addComponents(inputDesc));
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_avisogeral') {
        const modal = new ModalBuilder().setCustomId('adminpanel_avisogeral_modal').setTitle('Aviso Geral');
        const inputDesc = new TextInputBuilder()
            .setCustomId('adminpanel_avisogeral_desc')
            .setLabel('Descrição')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(120);
        const inputMsg = new TextInputBuilder()
            .setCustomId('adminpanel_avisogeral_msg')
            .setLabel('Mensagem')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1900);
        modal.addComponents(new ActionRowBuilder().addComponents(inputDesc), new ActionRowBuilder().addComponents(inputMsg));
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_limparlogs') {
        const modal = new ModalBuilder().setCustomId('adminpanel_limparlogs_modal').setTitle('Limpar Mensagens');
        const input = new TextInputBuilder()
            .setCustomId('adminpanel_limpar_qtd')
            .setLabel('Quantidade (1-100)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(3);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id === 'adminpanel_cargos') {
        const modal = new ModalBuilder().setCustomId('adminpanel_cargos_modal').setTitle('Gerenciar Cargos');
        const inputUser = new TextInputBuilder()
            .setCustomId('adminpanel_cargos_user')
            .setLabel('ID ou @menção do usuário')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);
        const inputAdd = new TextInputBuilder()
            .setCustomId('adminpanel_cargos_add')
            .setLabel('Cargo para adicionar (ID ou @cargo)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);
        const inputRemove = new TextInputBuilder()
            .setCustomId('adminpanel_cargos_remove')
            .setLabel('Cargo para remover (opcional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(80);
        modal.addComponents(
            new ActionRowBuilder().addComponents(inputUser),
            new ActionRowBuilder().addComponents(inputAdd),
            new ActionRowBuilder().addComponents(inputRemove)
        );
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    await interaction.reply({ content: '⚠️ Ação inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
    scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
}

async function ensureAdminPanel(options = {}) {
    if (ensureAdminPanelRunning) return;
    ensureAdminPanelRunning = true;
    try {
    const overrideChannelId = /^\d{17,20}$/.test(String(options?.channelId ?? '')) ? String(options.channelId) : null;
    const configuredChannelId = /^\d{17,20}$/.test(String(config.adminPanelChannelId ?? '')) ? String(config.adminPanelChannelId) : null;
    const channelId = overrideChannelId ?? configuredChannelId ?? ADMIN_PANEL_CHANNEL_ID;
    if (!/^\d{17,20}$/.test(String(channelId))) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
        throw new Error(`ADMIN_PANEL_CHANNEL_INVALID:${channelId}`);
    }

    const me = channel.guild?.members?.me ?? (await channel.guild?.members?.fetchMe?.().catch(() => null));
    if (me) {
        const perms = channel.permissionsFor(me);
        const missing = [];
        if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push('Ver Canal');
        if (channel.isThread?.()) {
            if (!perms?.has(PermissionFlagsBits.SendMessagesInThreads)) missing.push('Enviar em Threads');
        } else {
            if (!perms?.has(PermissionFlagsBits.SendMessages)) missing.push('Enviar Mensagens');
        }
        if (!perms?.has(PermissionFlagsBits.EmbedLinks)) missing.push('Inserir Links (Embeds)');
        if (missing.length) throw new Error(`ADMIN_PANEL_MISSING_PERMS:${missing.join(',')}`);
    }

    if (overrideChannelId && overrideChannelId !== configuredChannelId) {
        await updateRootConfig({ adminPanelChannelId: overrideChannelId, adminPanelMessageId: null }).catch(() => {});
    }

    const payload = { embeds: [buildAdminPanelEmbed(channel.guild)], components: buildAdminPanelComponents() };
    const fallbackPayload = { content: '🧩 Painel Central', components: buildAdminPanelComponents() };
    const storedId =
        /^\d{17,20}$/.test(String(config.adminPanelMessageId ?? '')) && (!configuredChannelId || configuredChannelId === channelId)
            ? String(config.adminPanelMessageId)
            : null;
    let primary = null;
    if (storedId) {
        const msg = await channel.messages?.fetch(storedId).catch(() => null);
        if (msg && msg.author?.id === client.user?.id) primary = msg;
        else await updateRootConfig({ adminPanelMessageId: null }).catch(() => {});
    }

    const panels = [];
    const collectPanels = (batch) => {
        if (!batch) return;
        for (const msg of batch.values()) {
            if (msg.author?.id !== client.user?.id) continue;
            const hasAdminPanel = (msg.components ?? []).some((row) =>
                (row.components ?? []).some((c) => typeof c.customId === 'string' && c.customId.startsWith(ADMIN_PANEL_CUSTOM_PREFIX))
            );
            if (hasAdminPanel) panels.push(msg);
        }
    };

    const recent = await channel.messages?.fetch({ limit: 100 }).catch(() => null);
    collectPanels(recent);
    if (panels.length === 0 && recent?.size) {
        let before = recent.last()?.id ?? null;
        const maxPages = 15;
        for (let i = 0; i < maxPages && before; i++) {
            const older = await channel.messages?.fetch({ limit: 100, before }).catch(() => null);
            if (!older || older.size === 0) break;
            collectPanels(older);
            before = older.last()?.id ?? null;
        }
    }
    panels.sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0));

    const recentPrimary = panels[0] ?? null;
    const duplicates = panels.filter((m) => (primary ? m.id !== primary.id : m.id !== recentPrimary?.id));

    if (!primary) primary = recentPrimary;

    const sendPanel = async () => {
        if (channel.type === ChannelType.GuildForum && typeof channel.threads?.create === 'function') {
            const thread = await channel.threads
                .create({
                    name: `Painel Central • ${new Date().toLocaleString('pt-BR')}`,
                    message: payload
                })
                .catch(async (err) => {
                    const threadFallback = await channel.threads
                        .create({
                            name: `Painel Central • ${new Date().toLocaleString('pt-BR')}`,
                            message: fallbackPayload
                        })
                        .catch(() => null);
                    if (threadFallback) return threadFallback;
                    throw err;
                });
            if (!thread) return null;
            const starter = await thread.fetchStarterMessage?.().catch(() => null);
            return starter ?? null;
        }

        let lastErr = null;
        const sent = await channel.send(payload).catch((err) => {
            lastErr = err;
            return null;
        });
        if (sent) return sent;
        const fallbackSent = await channel.send(fallbackPayload).catch((err) => {
            lastErr = err;
            return null;
        });
        if (fallbackSent) return fallbackSent;
        if (lastErr) throw lastErr;
        return null;
    };

    if (primary) {
        let lastErr = null;
        const edited = await primary.edit(payload).catch((err) => {
            lastErr = err;
            return null;
        });
        if (!edited) {
            const editedFallback = await primary.edit(fallbackPayload).catch(() => null);
            if (editedFallback) {
                if (primary.id !== storedId) {
                    await updateRootConfig({ adminPanelMessageId: primary.id, adminPanelChannelId: channelId }).catch(() => {});
                }
            } else {
                if (lastErr) {
                    const code = String(lastErr?.code ?? lastErr?.rawError?.code ?? '');
                    const msg = String(lastErr?.message ?? '').slice(0, 200);
                    throw new Error(`ADMIN_PANEL_EDIT_FAILED:${code}:${msg}`);
                }

                const sent = await sendPanel().catch((err) => {
                    const code = String(err?.code ?? err?.rawError?.code ?? '');
                    const msg = String(err?.message ?? '').slice(0, 200);
                    throw new Error(`ADMIN_PANEL_SEND_FAILED:${code}:${msg}`);
                });
                if (!sent) throw new Error('ADMIN_PANEL_SEND_FAILED::');
                await updateRootConfig({ adminPanelMessageId: sent.id, adminPanelChannelId: channelId }).catch(() => {});
            }
        } else if (primary.id !== storedId) {
            await updateRootConfig({ adminPanelMessageId: primary.id, adminPanelChannelId: channelId }).catch(() => {});
        }
    } else {
        const sent = await sendPanel().catch((err) => {
            const code = String(err?.code ?? err?.rawError?.code ?? '');
            const msg = String(err?.message ?? '').slice(0, 200);
            throw new Error(`ADMIN_PANEL_SEND_FAILED:${code}:${msg}`);
        });
        if (!sent) throw new Error('ADMIN_PANEL_SEND_FAILED::');
        await updateRootConfig({ adminPanelMessageId: sent.id, adminPanelChannelId: channelId }).catch(() => {});
    }

    for (const msg of duplicates) await msg.delete().catch(() => {});
    return { channelId, messageId: (primary?.id ?? config.adminPanelMessageId) || null };
    } finally {
        ensureAdminPanelRunning = false;
    }
}

function buildAdminChannelSelect({ ownerId, action, maxValues }) {
    return new ChannelSelectMenuBuilder()
        .setCustomId(`adminpanel_channel:${action}:${ownerId}`)
        .setPlaceholder('Selecione o canal')
        .setMinValues(1)
        .setMaxValues(maxValues);
}

async function promptAdminChannelSelect(interaction, { action, content, maxValues = 1 }) {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: '⚠️ Servidor inválido.', flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        return;
    }
    const components = await buildAdminPickerCategoryComponents({
        guild,
        action,
        ownerId: interaction.user.id,
        page: 0,
        maxValues
    });
    await interaction.reply({ content, components, flags: MessageFlags.Ephemeral }).catch(() => {});
    scheduleDeleteReplyMs(interaction, 60000);
}

function getMusicState(guildId) {
    const existing = musicByGuildId.get(guildId);
    if (existing) return existing;

    const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
    });

    const state = {
        queue: [],
        player,
        connection: null,
        current: null,
        voiceChannelId: null,
        disconnectTimer: null,
        lastError: null
    };

    player.on(AudioPlayerStatus.Idle, () => {
        void playNextInGuild(guildId);
    });

    player.on('error', (err) => {
        state.lastError = String(err?.message ?? 'Erro no player');
        logError(`AudioPlayer error (guild ${guildId})`, err);
        void playNextInGuild(guildId);
    });

    musicByGuildId.set(guildId, state);
    return state;
}

async function connectToVoice({ guild, voiceChannel }) {
    const music = getMusicState(guild.id);
    if (music.connection && music.voiceChannelId === voiceChannel.id) return music.connection;

    if (music.connection) {
        try {
            music.connection.destroy();
        } catch {}
        music.connection = null;
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (me) {
        const perms = voiceChannel.permissionsFor(me);
        const canConnect = perms?.has(PermissionFlagsBits.Connect);
        const canSpeak = perms?.has(PermissionFlagsBits.Speak);
        if (!canConnect || !canSpeak) throw new Error('SEM_PERMISSAO_VOICE');
        if (voiceChannel.type === ChannelType.GuildVoice) {
            const limit = Number(voiceChannel.userLimit ?? 0);
            if (limit > 0 && voiceChannel.members.size >= limit) {
                const canBypassLimit =
                    perms?.has(PermissionFlagsBits.MoveMembers) ||
                    perms?.has(PermissionFlagsBits.Administrator);
                if (!canBypassLimit) throw new Error('SALA_CHEIA');
            }
        }
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false
    });

    connection.subscribe(music.player);
    music.connection = connection;
    music.voiceChannelId = voiceChannel.id;

    connection.on('stateChange', (oldState, newState) => {
        logInfo(`Voice state (guild ${guild.id}): ${oldState.status} -> ${newState.status}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5000)
            ]);
        } catch {
            try {
                connection.destroy();
            } catch {}
        }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
        logWarn(`Voice destruída (guild ${guild.id})`);
    });
    connection.on(VoiceConnectionStatus.Ready, () => {
        logInfo(`Voice pronta (guild ${guild.id})`);
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 45000);
    } catch (err) {
        logWarn('Primeiro timeout ao conectar na sala de voz, tentando rejoin...');
        try {
            connection.rejoin({ channelId: voiceChannel.id, selfDeaf: false });
            await entersState(connection, VoiceConnectionStatus.Ready, 45000);
        } catch (err2) {
            logError('Timeout ao conectar na sala de voz', err2);
            try {
                connection.destroy();
            } catch {}
            music.connection = null;
            music.voiceChannelId = null;
            throw new Error('VOICE_TIMEOUT');
        }
    }

    if (voiceChannel.type === ChannelType.GuildStageVoice) {
        if (me?.voice) {
            await me.voice.setSuppressed(false).catch(() => {});
            await me.voice.setRequestToSpeak(true).catch(() => {});
        }
    }

    return connection;
}

async function enqueueFromLink({ link, requestedById, guildName }) {
    const resolved = String(link ?? '').trim();
    const type = playdl.validate(resolved);
    if (!type) {
        const q = parseYouTubeSearchQueryFromUrl(resolved) ?? resolved;
        if (!q) throw new Error('LINK_INVALIDO');
        const found = await youtubeSearchFirstUrl(q);
        if (!found) throw new Error('LINK_INVALIDO');
        return [
            {
                url: found.url,
                title: found.title,
                requestedById,
                source: 'YouTube',
                guildName
            }
        ];
    }

    if (type === 'yt_playlist' || type === 'yt_music_playlist') {
        const playlist = await withTimeout(playdl.playlist_info(resolved, { incomplete: true }), 20000, 'yt-playlist').catch(() => null);
        if (!playlist) throw new Error('LINK_INVALIDO');
        const videos = await withTimeout(playlist.all_videos(), 30000, 'yt-playlist-videos').catch(() => []);
        return videos.map((v) => ({
            url: v.url,
            title: v.title || 'Sem título',
            requestedById,
            source: 'YouTube',
            guildName
        }));
    }

    if (type === 'yt_video' || type === 'yt_short' || type === 'yt_music_video') {
        const info = await withTimeout(playdl.video_info(resolved), 20000, 'yt-video-info').catch(() => null);
        if (!info) throw new Error('LINK_INVALIDO');
        const v = info?.video_details;
        return [
            {
                url: resolved,
                title: v?.title || 'Sem título',
                requestedById,
                source: 'YouTube',
                guildName
            }
        ];
    }

    throw new Error('LINK_NAO_SUPORTADO');
}

async function createAudioResourceFromTrack(track) {
    let url = track.url;

    try {
        const stream = await withTimeout(playdl.stream(url), 30000, 'yt-stream');
        return createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: false });
    } catch (err) {
        const ytType = playdl.validate(url);
        if (ytType === 'yt_video' || ytType === 'yt_short' || ytType === 'yt_music_video') {
            const info = await withTimeout(playdl.video_info(url), 20000, 'yt-video-info-stream').catch(() => null);
            if (!info) throw err;
            const stream = await withTimeout(playdl.stream_from_info(info), 30000, 'yt-stream-from-info');
            return createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: false });
        }
        throw err;
    }
}

async function playNextInGuild(guildId) {
    const music = musicByGuildId.get(guildId);
    if (!music) return;

    if (music.disconnectTimer) {
        clearTimeout(music.disconnectTimer);
        music.disconnectTimer = null;
    }

    if (!music.queue || music.queue.length === 0) {
        music.current = null;
        music.disconnectTimer = setTimeout(() => {
            try {
                if (!music.current && (!music.queue || music.queue.length === 0)) {
                    music.connection?.destroy();
                    music.connection = null;
                    music.voiceChannelId = null;
                }
            } catch {}
            music.disconnectTimer = null;
        }, 300000);
        return;
    }

    try {
        const next = music.queue[0];
        const resource = await createAudioResourceFromTrack(next);
        music.queue.shift();
        music.current = next;
        music.lastError = null;
        music.player.play(resource);
        recordPlayedTrack(guildId, next);
    } catch (err) {
        const peek = music.queue?.[0];
        const url = peek?.url ? String(peek.url) : '';
        const message = String(err?.message ?? err ?? 'Falha ao tocar');
        music.lastError = message.slice(0, 300);
        logError(`Falha ao tocar: ${url}`, err);
        if (music.queue && music.queue.length) music.queue.shift();
        music.current = null;
        await playNextInGuild(guildId);
    }
}

async function autoDeployCommands() {
    try {
        const commands = buildCommands();
        if (!BOT_TOKEN || !APP_CLIENT_ID || !APP_GUILD_ID) {
            logWarn('Auto-deploy de comandos ignorado (TOKEN/CLIENT_ID/GUILD_ID ausente)');
            return;
        }
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        await rest.put(Routes.applicationGuildCommands(APP_CLIENT_ID, APP_GUILD_ID), { body: commands });
        logInfo('Comandos sincronizados (auto-deploy)');
    } catch (err) {
        logError('Falha no auto-deploy de comandos', err);
    }
}

function formatTimestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function logInfo(message) {
    console.log(`[${formatTimestamp()}] INFO  ${message}`);
}

function logWarn(message) {
    console.warn(`[${formatTimestamp()}] WARN  ${message}`);
}

const errorBuckets = new Map();

function isCommonDiscordError(err) {
    const code = Number(err?.code ?? err?.rawError?.code ?? NaN);
    if (!Number.isFinite(code)) return false;
    return code === 10003 || code === 10008 || code === 50001 || code === 50013 || code === 50035;
}

function errKey(err) {
    const code = String(err?.code ?? err?.rawError?.code ?? err?.name ?? '');
    const msg = String(err?.message ?? err ?? '').slice(0, 180);
    return `${code}:${msg}`;
}

function logError(message, err) {
    const windowMs = 60000;
    const key = `${message}:${errKey(err)}`;
    const now = Date.now();
    const prev = errorBuckets.get(key) ?? { lastAt: 0, suppressed: 0 };
    if (now - prev.lastAt < windowMs) {
        prev.suppressed++;
        errorBuckets.set(key, prev);
        return;
    }
    const suppressed = prev.suppressed;
    prev.lastAt = now;
    prev.suppressed = 0;
    errorBuckets.set(key, prev);

    console.error(`[${formatTimestamp()}] ERROR ${message}${suppressed ? ` (suprimido ${suppressed})` : ''}`);
    if (!err) return;
    if (isCommonDiscordError(err)) {
        const code = String(err?.code ?? err?.rawError?.code ?? '');
        const status = String(err?.status ?? '');
        const emsg = String(err?.message ?? err ?? '');
        console.error(`${code ? `code=${code} ` : ''}${status ? `status=${status} ` : ''}${emsg}`.trim());
        return;
    }
    console.error(err);
}

client.once('clientReady', () => {
    const tag = client.user?.tag ?? 'desconhecido';
    logInfo(`Online como ${tag}`);
    logInfo(`Node ${process.versions.node} | NODE_ENV=${String(process.env.NODE_ENV ?? 'production')}`);
    void ensureAdminPanel().catch((err) => logError('Falha ao garantir Painel Central', err));
    const guildId = String(APP_GUILD_ID ?? '').trim();
    if (/^\d{17,20}$/.test(guildId)) {
        void client.guilds.fetch(guildId).then((g) => warmupChannelsFromIndex(g)).catch(() => {});
    }
});

client.on('guildMemberAdd', async (member) => {
    try {
        const joinMs = Number(member.joinedTimestamp) || Date.now();
        memberJoinMsByGuildUserKey.set(`${member.guild.id}:${member.id}`, joinMs);

        const roleId = VISITOR_ROLE_ID;
        if (/^\d{17,20}$/.test(String(roleId))) {
            const role = member.guild.roles.cache.get(roleId) ?? (await member.guild.roles.fetch(roleId).catch(() => null));
            if (role) {
                await member.roles.add(role, 'Auto: visitante').catch((err) => logError(`Falha ao adicionar cargo ${roleId}`, err));
            }
        }

        const chId = WELCOME_CHANNEL_ID;
        if (!/^\d{17,20}$/.test(String(chId))) return;
        const channel = await client.channels.fetch(chId).catch(() => null);
        if (!channel || !channel.isTextBased?.()) {
            logWarn(`Canal de boas-vindas inválido: ${chId}`);
            return;
        }

        await channel
            .send({ embeds: [createWelcomeEmbed({ guild: member.guild, member, joinedAtMs: joinMs })] })
            .catch((err) => logError(`Falha ao enviar boas-vindas no canal ${chId}`, err));
    } catch (err) {
        logError('Erro no guildMemberAdd', err);
    }
});

client.on('guildMemberRemove', async (member) => {
    try {
        const userId = member.user?.id;
        if (!userId) return;

        const key = `${member.guild.id}:${userId}`;
        const joinedAtMs =
            memberJoinMsByGuildUserKey.get(key) ??
            (Number(member.joinedTimestamp) || (member.joinedAt ? Number(member.joinedAt.getTime()) : null));
        memberJoinMsByGuildUserKey.delete(key);

        const leftAtMs = Date.now();
        const avatarUrl = getUserAvatarUrl(member.user);

        const byeId = GOODBYE_CHANNEL_ID;
        if (/^\d{17,20}$/.test(String(byeId))) {
            const byeChannel = await member.guild.channels.fetch(byeId).catch(() => null);
            if (!byeChannel || !byeChannel.isTextBased?.()) {
                logWarn(`Canal de adeus inválido: ${byeId}`);
            } else {
                const payload = {
                    content: `📤 <@${userId}> saiu do servidor.`,
                    embeds: [
                        createGoodbyeEmbed({
                            guild: member.guild,
                            userId,
                            userTag: member.user.tag,
                            joinedAtMs,
                            leftAtMs,
                            avatarUrl
                        })
                    ]
                };
                await byeChannel.send(payload).then(() => logInfo(`Adeus enviado em #${byeChannel.id} | ${member.user.tag} (${userId})`)).catch((err) => {
                    logError(`Falha ao enviar adeus no canal ${byeId}`, err);
                });
            }
        } else {
            logWarn(`GOODBYE_CHANNEL_ID inválido: ${String(byeId)}`);
        }

        const channelsToDelete = [];
        for (const ch of member.guild.channels.cache.values()) {
            if (ch.type !== ChannelType.GuildText) continue;
            if (!ch.topic) continue;

            const ticketMeta = parseTicketTopic(ch.topic);
            if (ticketMeta['ticket.userId'] === userId) channelsToDelete.push({ channel: ch, kind: 'ticket', meta: ticketMeta });

            const farmMeta = parseFarmTopic(ch.topic);
            if (farmMeta && farmMeta['farm.userId'] === userId) channelsToDelete.push({ channel: ch, kind: 'farm', meta: farmMeta });
        }

        if (!channelsToDelete.length) return;

        logInfo(`Auto-delete | Usuario saiu: ${member.user.tag} (${userId}) | Canais: ${channelsToDelete.length}`);

        for (const item of channelsToDelete) {
            const ch = item.channel;
            try {
                if (item.kind === 'ticket') {
                    const openerId = item.meta['ticket.userId'];
                    const typeKey = item.meta['ticket.type'] ?? 'suporte';
                    const claimedById = item.meta['ticket.claimedBy'] || null;
                    const transcriptText = await withTimeout(buildTranscriptTxt(ch).catch(() => null), 8000, 'transcript(auto-delete)');
                    await sendTicketLog({
                        guild: member.guild,
                        channel: ch,
                        openerId,
                        closerId: null,
                        claimedById,
                        typeKey,
                        action: 'Deletado (usuário saiu)',
                        transcriptText
                    });
                } else if (item.kind === 'farm') {
                    const openerId = item.meta['farm.userId'];
                    const playerName = item.meta['farm.playerName'] || '';
                    const playerId = item.meta['farm.playerId'] || '';
                    const transcriptText = await withTimeout(buildTranscriptTxt(ch).catch(() => null), 8000, 'transcript-farm(auto-delete)');
                    await sendTicketFarmLog({
                        guild: member.guild,
                        channel: ch,
                        action: 'Deletado (usuário saiu)',
                        actorId: null,
                        openerId,
                        playerName,
                        playerId,
                        transcriptText
                    });
                }
            } catch (err) {
                logError(`Falha ao logar auto-delete (${item.kind})`, err);
            }

            ch.delete('Auto-delete: usuário saiu do servidor').catch((err) => logError('Falha ao deletar canal automaticamente', err));
        }
    } catch (err) {
        logError('Erro no guildMemberRemove', err);
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    musicManager.handleVoiceStateUpdate(oldState, newState);
});

client.on('error', (err) => {
    logError('Client error', err);
});

client.on('shardError', (err) => {
    logError('Shard error', err);
});

client.on('shardDisconnect', (event, shardId) => {
    const code = event?.code ?? event?.closeCode ?? '—';
    logWarn(`Shard desconectou (shard ${shardId}) | code=${code}`);
});

client.on('shardReconnecting', (shardId) => {
    logInfo(`Shard reconectando... (shard ${shardId})`);
});

client.on('shardResume', (shardId) => {
    logInfo(`Shard retomou conexão (shard ${shardId})`);
});

function getRoleLabel(guild, roleId) {
    const role = guild.roles.cache.get(roleId);
    return role ? `<@&${roleId}>` : roleId;
}

function parseIdList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v).trim()).filter((v) => /^\d{17,20}$/.test(v));
}

function createLogEmbed({ title, color, guild, executorId, executorTag, targetId, targetTag, fields }) {
    const embed = new EmbedBuilder().setTitle(title).setColor(color);
    applyGuildBranding(embed, guild);

    embed.addFields(
        { name: 'Executor', value: `<@${executorId}> (${executorTag})`, inline: false },
        { name: 'Usuário', value: `<@${targetId}> (${targetTag})`, inline: false },
        ...fields
    );

    return embed;
}

async function sendLog(logChannel, embed) {
    if (!logChannel?.isTextBased()) return;
    await logChannel.send({ embeds: [embed] });
}

process.on('unhandledRejection', (reason) => {
    logError('UnhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
    logError('UncaughtException', err);
    setTimeout(() => process.exit(1), 200);
});

function getAdminRoleIds() {
    const ids = [];
    if (Array.isArray(config.adminRoles)) ids.push(...config.adminRoles);
    if (typeof config.adminRole === 'string') ids.push(config.adminRole);
    return ids
        .map((v) => String(v).trim())
        .filter((v) => /^\d{17,20}$/.test(v));
}

function canUseCommands(member) {
    const adminRoleIds = getAdminRoleIds();
    if (adminRoleIds.length > 0) return adminRoleIds.some((id) => member.roles.cache.has(id));
    return (
        member.permissions.has(PermissionFlagsBits.ManageRoles) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.Administrator)
    );
}

function getSetagemConfig() {
    const raw = config.setagem ?? {};
    const panelChannelId = /^\d{17,20}$/.test(String(raw.panelChannelId ?? '')) ? String(raw.panelChannelId) : null;
    const approvalChannelId = /^\d{17,20}$/.test(String(raw.approvalChannelId ?? '')) ? String(raw.approvalChannelId) : null;
    const listChannelId = /^\d{17,20}$/.test(String(raw.listChannelId ?? '')) ? String(raw.listChannelId) : null;
    const logChannelId = /^\d{17,20}$/.test(String(raw.logChannelId ?? '')) ? String(raw.logChannelId) : null;
    return { panelChannelId, approvalChannelId, listChannelId, logChannelId };
}

async function updateSetagemConfig(patch) {
    const configPath = path.join(__dirname, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const json = JSON.parse(raw);
    const prev = json.setagem ?? {};
    const next = { ...prev, ...patch };
    json.setagem = next;
    await fs.writeFile(configPath, JSON.stringify(json, null, 2), 'utf8');
    config.setagem = next;
    return getSetagemConfig();
}

async function updateRootConfig(patch) {
    const configPath = path.join(__dirname, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const json = JSON.parse(raw);
    for (const [key, value] of Object.entries(patch ?? {})) {
        if (value === null) {
            delete json[key];
            delete config[key];
        } else {
            json[key] = value;
            config[key] = value;
        }
    }
    await fs.writeFile(configPath, JSON.stringify(json, null, 2), 'utf8');
    return json;
}

function getTicketConfig() {
    const raw = config.ticket ?? {};
    const categories = raw.categories ?? {};
    const normalizeCategory = (key) => {
        const item = categories[key] ?? {};
        const categoryId = String(item.categoryId ?? '').trim();
        const validCategoryId = /^\d{17,20}$/.test(categoryId) ? categoryId : null;
        return {
            key,
            categoryId: validCategoryId,
            label: String(item.label ?? key),
            emoji: String(item.emoji ?? '🎫'),
            viewerRoles: parseIdList(item.viewerRoles)
        };
    };

    return {
        staffRoles: parseIdList(raw.staffRoles),
        cooldownSeconds: Number.isFinite(Number(raw.cooldownSeconds)) ? Math.max(0, Number(raw.cooldownSeconds)) : 60,
        logChannel: /^\d{17,20}$/.test(String(raw.logChannel ?? '')) ? String(raw.logChannel) : config.logChannel,
        categories: {
            suporte: normalizeCategory('suporte'),
            denuncia: normalizeCategory('denuncia')
        }
    };
}

function getTicketViewerRoles(ticket, typeKey) {
    const category = ticket.categories[typeKey];
    if (category?.viewerRoles?.length) return category.viewerRoles;
    return ticket.staffRoles;
}

function canUseTicketStaff(member, typeKey) {
    const ticket = getTicketConfig();
    const roles = typeKey ? getTicketViewerRoles(ticket, typeKey) : ticket.staffRoles;
    if (roles.length > 0) return roles.some((id) => member.roles.cache.has(id));
    return member.permissions.has(PermissionFlagsBits.ManageChannels) || member.permissions.has(PermissionFlagsBits.Administrator);
}

function getTicketFarmConfig() {
    const raw = config.ticketFarm ?? {};
    const categoryId = /^\d{17,20}$/.test(String(raw.categoryId ?? '')) ? String(raw.categoryId) : null;
    return {
        categoryId,
        viewerRoles: parseIdList(raw.viewerRoles),
        adminRoles: parseIdList(raw.adminRoles),
        cooldownSeconds: Number.isFinite(Number(raw.cooldownSeconds)) ? Math.max(0, Number(raw.cooldownSeconds)) : 10,
        logChannel: /^\d{17,20}$/.test(String(raw.logChannel ?? '')) ? String(raw.logChannel) : config.logChannel
    };
}

function canUseTicketFarmViewer(member) {
    const farm = getTicketFarmConfig();
    if (farm.viewerRoles.length > 0) return farm.viewerRoles.some((id) => member.roles.cache.has(id));
    return member.permissions.has(PermissionFlagsBits.ManageChannels) || member.permissions.has(PermissionFlagsBits.Administrator);
}

function canUseTicketFarmAdmin(member) {
    const farm = getTicketFarmConfig();
    if (farm.adminRoles.length > 0) return farm.adminRoles.some((id) => member.roles.cache.has(id));
    const adminRoleIds = getAdminRoleIds();
    if (adminRoleIds.length > 0) return adminRoleIds.some((id) => member.roles.cache.has(id));
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function createTicketFarmPanelEmbed(guild) {
    const embed = new EmbedBuilder()
        .setTitle('🌾 TicketFarm • Registro de Farms')
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Clique no botão abaixo para abrir um TicketFarm e registrar seus baús/prints.',
                '',
                '📌 Instruções:',
                '• Preencha Nome/ID do player e Nº do baú',
                '• Envie prints no canal sempre que precisar',
                '• Este ticket fica aberto por tempo indeterminado',
                '• Só ADM pode fechar/deletar',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        )
        .setColor(0x7c3aed);
    return applyGuildBranding(embed, guild);
}

function createTicketFarmPanelRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticketfarm_open').setLabel('TicketFarm').setStyle(ButtonStyle.Primary).setEmoji('🌾')
        )
    ];
}

function createAgeVerificationEmbed(guild) {
    const embed = new EmbedBuilder()
        .setTitle('✅ Verificação • 18+')
        .setColor(0x16a34a)
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Para liberar o acesso aos canais principais, confirme que você possui **18 anos ou mais**.',
                '',
                '📌 Antes de continuar:',
                '• Leia a **Política de Privacidade**',
                '• Leia o **Termo de Responsabilidade**',
                '',
                '🧾 Como funciona:',
                '• Clique em **Confirmo minha idade**',
                '• Preencha o formulário com seus dados',
                '• Aguarde a confirmação do sistema',
                '',
                '⚠️ Se você não cumprir o requisito **18+**, não prossiga.',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        );
    return applyGuildBranding(embed, guild);
}

function createAgeVerificationRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verificar_idade').setLabel('Confirmo minha idade').setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setLabel('Política de Privacidade')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.com/channels/1336078347305746462/1501716670941495317'),
            new ButtonBuilder()
                .setLabel('Termo de Responsabilidade')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.com/channels/1336078347305746462/1501716910444908594')
        )
    ];
}

function createCalcPanelEmbed(guild) {
    const embed = new EmbedBuilder()
        .setTitle('🧮 Calculadora • Painel')
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Abra a calculadora no botão abaixo.',
                '',
                '📌 Dicas:',
                '• Use para contas rápidas',
                '• Funciona no celular e PC',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        )
        .setColor(0x0ea5e9);
    return applyGuildBranding(embed, guild);
}

function createCalcPanelRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Abrir Calculadora')
                .setStyle(ButtonStyle.Link)
                .setURL('https://updatefram.github.io/comandonorte/')
        )
    ];
}

function createSetagemPanelEmbed(guild) {
    const embed = new EmbedBuilder()
        .setTitle('🧩 Setagem • Pedido')
        .setColor(0x0ea5e9)
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Clique no botão abaixo para solicitar sua setagem.',
                '',
                '📌 Você vai preencher:',
                '• ID no RP',
                '• Nome no RP',
                '• Celular no RP',
                '• Nome do Recrutador',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        );
    return applyGuildBranding(embed, guild);
}

function createSetagemPanelRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setagem_pedir').setLabel('Pedir Setagem').setStyle(ButtonStyle.Primary).setEmoji('📝')
        )
    ];
}

function createSetagemApprovalEmbed({ guild, req, status, decidedByTag, decidedRoleId }) {
    const base = new EmbedBuilder()
        .setTitle('🧩 Pedido de Setagem')
        .setColor(status === 'approved' ? 0x22c55e : status === 'rejected' ? 0xef4444 : 0x0ea5e9)
        .setDescription(`Solicitação de <@${req.requesterId}> (${req.requesterTag})`)
        .addFields(
            { name: 'ID no RP', value: req.rpId, inline: true },
            { name: 'Nome no RP', value: req.rpNome, inline: true },
            { name: 'Celular no RP', value: req.rpCel, inline: true },
            { name: 'Recrutador', value: req.recrutador, inline: false },
            { name: 'Pedido em', value: formatDiscordTimestampMs(req.requestedAtMs), inline: false }
        );
    applyGuildBranding(base, guild);
    if (req.avatarUrl) base.setThumbnail(req.avatarUrl);

    if (status === 'approved') {
        base.addFields(
            { name: 'Status', value: '✅ Aprovado', inline: true },
            { name: 'Aprovado por', value: decidedByTag ?? '—', inline: true },
            { name: 'Cargo', value: decidedRoleId ? `<@&${decidedRoleId}>` : '—', inline: false }
        );
    } else if (status === 'rejected') {
        base.addFields(
            { name: 'Status', value: '❌ Reprovado', inline: true },
            { name: 'Reprovado por', value: decidedByTag ?? '—', inline: true }
        );
    } else {
        base.addFields({ name: 'Status', value: '⏳ Pendente', inline: true });
    }

    return base;
}

function formatMetasText(value) {
    const raw = String(value ?? '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '—';
    const lines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    if (!lines.length) return '—';
    if (lines.length === 1) return lines[0].slice(0, 1800);
    const out = [];
    for (const line of lines.slice(0, 40)) {
        const cleaned = line.replace(/^[•\-\*\u2022]+\s*/g, '').trim();
        out.push(`• ${cleaned}`);
    }
    return out.join('\n').slice(0, 1800);
}

function createMetasEmbed({ guild, title, message, authorTag, authorId, authorAvatarUrl }) {
    const t = String(title ?? '').trim();
    const embed = new EmbedBuilder()
        .setTitle(t ? `🎯 Metas • ${t}` : '🎯 Metas')
        .setColor(0xf59e0b)
        .setDescription(formatMetasText(message));
    applyGuildBranding(embed, guild);
    embed.addFields({ name: 'Por', value: `<@${authorId}> (${authorTag})`, inline: false });
    if (authorAvatarUrl) embed.setThumbnail(authorAvatarUrl);
    return embed;
}

function isValidHttpUrl(value) {
    try {
        const u = new URL(String(value));
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function createRegrasEmbed({ guild, title, message, authorTag, authorId, authorAvatarUrl }) {
    const t = String(title ?? '').trim();
    const embed = new EmbedBuilder()
        .setTitle(t ? `📜 Regras • ${t}` : '📜 Regras')
        .setColor(0x3b82f6)
        .setDescription(formatMetasText(message));
    applyGuildBranding(embed, guild);
    embed.addFields({ name: 'Por', value: `<@${authorId}> (${authorTag})`, inline: false });
    if (authorAvatarUrl) embed.setThumbnail(authorAvatarUrl);
    return embed;
}

function createRadioEmbed({ guild, frequencia, descricao, authorTag, authorId, authorAvatarUrl }) {
    const freq = String(frequencia ?? '').trim();
    const desc = String(descricao ?? '').trim();
    const embed = new EmbedBuilder()
        .setTitle('📻 Rádio da Fac')
        .setColor(0x22c55e)
        .setDescription('━━━━━━━━━━━━━━━━━━━━');
    applyGuildBranding(embed, guild);
    embed.addFields(
        { name: '📡 Frequência', value: freq || '—', inline: true },
        { name: '📝 Descrição', value: formatMetasText(desc), inline: false },
        { name: 'Por', value: `<@${authorId}> (${authorTag})`, inline: false }
    );
    if (authorAvatarUrl) embed.setThumbnail(authorAvatarUrl);
    return embed;
}

function createAvisoGeralEmbed({ guild, descricao, mensagem, authorTag, authorId, authorAvatarUrl }) {
    const desc = String(descricao ?? '').trim();
    const msg = String(mensagem ?? '').trim();
    const embed = new EmbedBuilder()
        .setTitle('📣 Aviso Geral')
        .setColor(0xef4444)
        .setDescription(desc ? `━━━━━━━━━━━━━━━━━━━━\n${desc}` : '━━━━━━━━━━━━━━━━━━━━')
        .addFields({ name: '📌 Mensagem', value: formatMetasText(msg), inline: false }, { name: 'Por', value: `<@${authorId}> (${authorTag})`, inline: false });
    applyGuildBranding(embed, guild);
    if (authorAvatarUrl) embed.setThumbnail(authorAvatarUrl);
    return embed;
}

function parseBirthDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    let year;
    let month;
    let day;

    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const brCompact = raw.match(/^(\d{2})(\d{2})(\d{4})$/);
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (br) {
        day = Number(br[1]);
        month = Number(br[2]);
        year = Number(br[3]);
    } else if (brCompact) {
        day = Number(brCompact[1]);
        month = Number(brCompact[2]);
        year = Number(brCompact[3]);
    } else if (iso) {
        year = Number(iso[1]);
        month = Number(iso[2]);
        day = Number(iso[3]);
    } else {
        return null;
    }

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }

    return date;
}

function getAgeYears(birthDate, now = new Date()) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    const d = now.getUTCDate();

    const by = birthDate.getUTCFullYear();
    const bm = birthDate.getUTCMonth() + 1;
    const bd = birthDate.getUTCDate();

    let age = y - by;
    if (m < bm || (m === bm && d < bd)) age -= 1;
    return age;
}

function birthDateToIsoDate(birthDate) {
    const y = birthDate.getUTCFullYear();
    const m = String(birthDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(birthDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function birthDateToBrDate(birthDate) {
    const d = String(birthDate.getUTCDate()).padStart(2, '0');
    const m = String(birthDate.getUTCMonth() + 1).padStart(2, '0');
    const y = birthDate.getUTCFullYear();
    return `${d}/${m}/${y}`;
}

function createAgeCheckEmbed({ guild, fullName, birthDate, age, isEligible }) {
    const statusLabel = isEligible ? '🟢 Liberado (18+)' : '🔴 Não liberado (menor de 18)';
    const embed = new EmbedBuilder()
        .setTitle('Resultado da Verificação')
        .setColor(isEligible ? 0x22c55e : 0xef4444)
        .setDescription(statusLabel)
        .addFields(
            { name: 'Nome', value: fullName || '—', inline: false },
            { name: 'Nascimento', value: birthDateToBrDate(birthDate), inline: true },
            { name: 'Idade', value: `${age}`, inline: true }
        );
    return applyGuildBranding(embed, guild);
}

function createAgeCheckConfirmRow({ isEligible }) {
    if (!isEligible) {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verificar_idade_cancelar').setLabel('Fechar').setStyle(ButtonStyle.Secondary)
            )
        ];
    }

    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verificar_idade_confirmar').setLabel('Confirmar e liberar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('verificar_idade_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
    ];
}

async function saveAgeVerificationRecord({ guildId, userId, userTag, fullName, birthDate, age }) {
    const record = {
        guildId: String(guildId),
        userId: String(userId),
        userTag: String(userTag),
        fullName: String(fullName),
        birthDate: birthDateToIsoDate(birthDate),
        age: Number(age),
        verifiedAt: new Date().toISOString()
    };

    ageVerifyWriteChain = ageVerifyWriteChain.catch(() => {}).then(async () => {
        let items = [];
        try {
            const raw = await fs.readFile(AGE_VERIFY_DATA_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) items = parsed;
        } catch (err) {
            if (err?.code !== 'ENOENT') throw err;
        }

        items = items.filter((r) => r && r.userId !== record.userId);
        items.push(record);
        await fs.writeFile(AGE_VERIFY_DATA_PATH, JSON.stringify(items, null, 2), 'utf8');
    });

    return ageVerifyWriteChain;
}

async function sendAgeVerificationLog({ guild, userId, userTag, fullName, birthDate, age }) {
    const logChannelId = String(config.logVerificacaoId ?? '').trim();
    if (!/^\d{17,20}$/.test(logChannelId)) return;

    const logChannel = guild.channels.cache.get(logChannelId) ?? (await guild.channels.fetch(logChannelId).catch(() => null));
    if (!logChannel?.isTextBased()) return;

    const isEligible = Number(age) >= 18;
    const embed = new EmbedBuilder()
        .setTitle('📋 Log • Verificação de Idade')
        .setColor(isEligible ? 0x22c55e : 0xef4444)
        .addFields(
            { name: 'Usuário', value: `<@${userId}> (${userTag})`, inline: false },
            { name: 'Nome', value: fullName || '—', inline: false },
            { name: 'Nascimento', value: birthDateToBrDate(birthDate), inline: true },
            { name: 'Idade', value: `${age}`, inline: true },
            { name: 'Status', value: isEligible ? '🟢 Liberado (18+)' : '🔴 Não liberado', inline: true }
        );
    applyGuildBranding(embed, guild);

    await logChannel.send({ embeds: [embed] }).catch(() => {});
}

function createTicketFarmIntroEmbed({ guild, openerId, openerTag, playerName, playerId, claimedById, isClosed }) {
    const embed = new EmbedBuilder()
        .setTitle('🌾 TicketFarm')
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Envie prints/arquivos aqui quando quiser.',
                'Este canal fica aberto por tempo indeterminado.',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        )
        .addFields(
            { name: '👤 Autor', value: `<@${openerId}> (${openerTag})`, inline: false },
            { name: '🎮 Player', value: playerName || '—', inline: true },
            { name: '🆔 ID', value: playerId || '—', inline: true },
            { name: '👨‍💼 Atendente', value: claimedById ? `<@${claimedById}>` : '—', inline: true },
            { name: '📌 Status', value: isClosed ? '🔒 Fechado (ADM)' : '🟢 Aberto', inline: true }
        )
        .setColor(isClosed ? 0x0ea5e9 : 0x7c3aed);
    return applyGuildBranding(embed, guild);
}

function createTicketFarmActionRows({ isClosed }) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticketfarm_claim').setLabel('Assumir').setStyle(ButtonStyle.Secondary).setEmoji('👨‍💼').setDisabled(Boolean(isClosed)),
            new ButtonBuilder().setCustomId('ticketfarm_close').setLabel('Fechar (ADM)').setStyle(ButtonStyle.Secondary).setEmoji('🔒').setDisabled(Boolean(isClosed)),
            new ButtonBuilder().setCustomId('ticketfarm_delete').setLabel('Deletar (ADM)').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
        )
    ];
}

function parseFarmTopic(topic) {
    const meta = parseTicketTopic(topic);
    if (!meta['farm.userId']) return null;
    return meta;
}

function isFarmChannel(channel) {
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    return Boolean(parseFarmTopic(channel.topic));
}

async function sendTicketFarmLog({ guild, channel, action, actorId, openerId, playerName, playerId, transcriptText }) {
    const farm = getTicketFarmConfig();
    const logChannel = farm.logChannel ? guild.channels.cache.get(farm.logChannel) : null;
    if (!logChannel?.isTextBased()) return;

    const embed = new EmbedBuilder()
        .setTitle('🌾 Log • TicketFarm')
        .setColor(0x7c3aed)
        .addFields(
            { name: '🧾 Ação', value: action, inline: true },
            { name: '📍 Canal', value: `<#${channel.id}>`, inline: true },
            { name: '👤 Autor', value: openerId ? `<@${openerId}>` : '—', inline: true },
            { name: '👮 Por', value: actorId ? `<@${actorId}>` : '—', inline: true },
            { name: '🎮 Player', value: playerName || '—', inline: true },
            { name: '🆔 ID', value: playerId || '—', inline: true }
        );
    applyGuildBranding(embed, guild);

    const files = [];
    if (transcriptText) files.push(new AttachmentBuilder(Buffer.from(transcriptText, 'utf8'), { name: `transcript-farm-${channel.id}.txt` }));
    await logChannel.send({ embeds: [embed], files });
}

async function trySendDM(user, content) {
    try {
        await user.send({ content });
        return true;
    } catch {
        return false;
    }
}

function normalizeReplyPayload(content) {
    if (typeof content === 'string') {
        return { content };
    }

    if (content && typeof content === 'object') {
        return content;
    }

    return {
        content: String(content ?? '')
    };
}

function scheduleDeleteReply(interaction) {
    scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
}

function scheduleDeleteReplyMs(interaction, ms = AUTO_DELETE_MS) {
    const delay = Number.isFinite(Number(ms)) ? Number(ms) : AUTO_DELETE_MS;

    setTimeout(() => {
        try {
            if (!interaction?.deferred && !interaction?.replied) return;

            interaction.deleteReply().catch((err) => {
                const code = Number(err?.code ?? 0);

                if (code === 10008 || code === 10062) return;

                console.error('Erro ao apagar resposta:', err);
            });
        } catch {}
    }, delay);
}

async function safeInteractionReply(interaction, content, options = {}) {
    const payload = normalizeReplyPayload(content);

    if (options.ephemeral !== false) {
        payload.flags = payload.flags ?? MessageFlags.Ephemeral;
    }

    try {
        if (interaction?.deferred || interaction?.replied) {
            return await interaction.editReply(payload);
        }

        return await interaction.reply(payload);
    } catch (err) {
        const code = Number(err?.code ?? 0);

        if (code === 10062) {
            console.error('Interação expirada antes da resposta:', interaction?.customId ?? interaction?.commandName ?? 'desconhecida');
            return null;
        }

        if (code === 40060) {
            try {
                return await interaction.editReply(payload);
            } catch {
                return null;
            }
        }

        console.error('Erro ao responder interação:', err);
        return null;
    }
}

async function replyAndDelete(interaction, content) {
    await safeInteractionReply(interaction, content);
    scheduleDeleteReply(interaction);
}

async function replyAndDeleteMs(interaction, content, ms = AUTO_DELETE_MS) {
    await safeInteractionReply(interaction, content);
    scheduleDeleteReplyMs(interaction, ms);
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms)
        )
    ]);
}

async function safeSetTopic(channel, topic, label) {
    try {
        await withTimeout(channel.setTopic(topic), 25000, `setTopic(${label})`);
        return true;
    } catch (err) {
        return false;
    }
}

async function findTicketControlMessage(channel, preferredMessageId, customIdPrefix = 'ticket_') {
    if (preferredMessageId) {
        const msg = await channel.messages.fetch(preferredMessageId).catch(() => null);
        if (msg) return msg;
    }

    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!recent) return null;

    for (const msg of recent.values()) {
        if (msg.author.id !== channel.client.user.id) continue;
        if (!msg.components?.length) continue;
        const hasTicketButtons = msg.components.some((row) =>
            row.components?.some((c) => typeof c.customId === 'string' && c.customId.startsWith(customIdPrefix))
        );
        if (hasTicketButtons) return msg;
    }

    return null;
}

function isTicketLocked(channel, openerId) {
    if (!openerId) return false;
    const overwrite = channel.permissionOverwrites.cache.get(openerId);
    if (!overwrite) return false;
    const denied = new PermissionsBitField(overwrite.deny);
    return denied.has(PermissionFlagsBits.SendMessages);
}

function formatDM({ title, guildName, details, executorTag }) {
    const lines = [];
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`${title}`);
    lines.push(`Servidor: ${guildName}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    for (const line of details) lines.push(line);
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Ação por: ${executorTag}`);
    lines.push(`OBS: Se você acha que foi removido injustamente, abra um ticket.`);
    return lines.join('\n');
}

function formatDateTime(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function createTicketPanelEmbed(guild) {
    const embed = new EmbedBuilder()
        .setTitle('🎫 Sistema de Suporte')
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Selecione uma categoria abaixo para abrir seu atendimento.',
                '',
                '📌 Regras rápidas:',
                '• Um ticket por usuário',
                '• Evite spam (cooldown ativo)',
                '• Descreva o problema com detalhes',
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        )
        .setColor(0x7c3aed);
    return applyGuildBranding(embed, guild);
}

function createTicketPanelRows() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_open:suporte|suporte').setLabel('Suporte').setStyle(ButtonStyle.Primary).setEmoji('📩'),
        new ButtonBuilder().setCustomId('ticket_open:denuncia|denuncia').setLabel('Denúncia').setStyle(ButtonStyle.Secondary).setEmoji('🚨')
    );
    return [row];
}

function sanitizeChannelName(input) {
    return (
        String(input)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40) || 'usuario'
    );
}

function parseTicketTopic(topic) {
    const result = {};
    if (!topic) return result;
    for (const part of String(topic).split(';')) {
        const [k, ...rest] = part.split('=');
        if (!k || rest.length === 0) continue;
        result[k.trim()] = rest.join('=').trim();
    }
    return result;
}

function buildTicketTopic(meta) {
    const parts = [];
    for (const [k, v] of Object.entries(meta)) {
        if (v === undefined || v === null || v === '') continue;
        parts.push(`${k}=${v}`);
    }
    return parts.join(';').slice(0, 1024);
}

function isTicketChannel(channel) {
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    const meta = parseTicketTopic(channel.topic);
    return Boolean(meta['ticket.userId']);
}

async function findOpenTicketChannelForUser(guild, userId) {
    const channels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText && Boolean(c.topic));
    for (const ch of channels.values()) {
        const meta = parseTicketTopic(ch.topic);
        if (meta['ticket.userId'] !== userId) continue;
        if (isTicketLocked(ch, userId)) continue;
        if ((meta['ticket.status'] ?? 'open') === 'open') return ch;
    }
    return null;
}

function createTicketIntroEmbed({ guild, typeLabel, typeEmoji, openerId, openerTag, claimedById, status }) {
    const statusLabel = status === 'closed' ? '🔒 Fechado' : '🟢 Aberto';
    const claimedLabel = claimedById ? `<@${claimedById}>` : '—';
    const isDenuncia = String(typeLabel).toLowerCase().includes('denún') || String(typeLabel).toLowerCase().includes('denun');
    const embed = new EmbedBuilder()
        .setTitle(`${typeEmoji} Ticket de ${typeLabel}`)
        .setDescription(
            [
                '━━━━━━━━━━━━━━━━━━━━',
                'Bem-vindo(a) ao atendimento!',
                'Descreva seu caso com o máximo de detalhes possível.',
                ...(isDenuncia ? ['','🔒 OBS: Sua denúncia é tratada com sigilo total.'] : []),
                '━━━━━━━━━━━━━━━━━━━━'
            ].join('\n')
        )
        .addFields(
            { name: '👤 Autor', value: `<@${openerId}> (${openerTag})`, inline: false },
            { name: '👨‍💼 Atendente', value: claimedLabel, inline: true },
            { name: '📌 Status', value: statusLabel, inline: true }
        )
        .setColor(0x2563eb);
    return applyGuildBranding(embed, guild);
}

function createTicketActionRows({ isClosed }) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar Ticket').setStyle(ButtonStyle.Secondary).setEmoji('🔒').setDisabled(Boolean(isClosed)),
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Assumir').setStyle(ButtonStyle.Primary).setEmoji('👨‍💼').setDisabled(Boolean(isClosed)),
        new ButtonBuilder().setCustomId('ticket_delete').setLabel('Deletar').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
    );
    return [row];
}

function createConfirmRow({ confirmId, cancelId, confirmLabel }) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(ButtonStyle.Danger).setEmoji('✅'),
        new ButtonBuilder().setCustomId(cancelId).setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji('❌')
    );
}

async function buildTranscriptTxt(channel) {
    const lines = [];
    lines.push(`Ticket Transcript`);
    lines.push(`Servidor: ${channel.guild.name}`);
    lines.push(`Canal: #${channel.name} (${channel.id})`);
    lines.push(`Gerado em: ${formatDateTime(new Date())}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);

    let lastId = null;
    let fetchedTotal = 0;
    while (fetchedTotal < 3000) {
        const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
        if (!batch.size) break;
        const messages = Array.from(batch.values());
        lastId = messages[messages.length - 1].id;
        fetchedTotal += messages.length;
        for (const msg of messages) {
            const ts = formatDateTime(msg.createdAt);
            const author = `${msg.author.tag} (${msg.author.id})`;
            const content = msg.content ? msg.content.replace(/\r?\n/g, '\\n') : '';
            const attachments = msg.attachments.size ? ` attachments=${msg.attachments.map((a) => a.url).join(' ')}` : '';
            lines.push(`[${ts}] ${author}: ${content}${attachments}`);
        }
        if (batch.size < 100) break;
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    return lines.reverse().join('\n');
}

async function sendTicketLog({ guild, channel, openerId, closerId, claimedById, typeKey, action, transcriptText }) {
    const ticket = getTicketConfig();
    const logChannelId = ticket.logChannel;
    const logChannel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
    if (!logChannel?.isTextBased()) return;

    const category = ticket.categories[typeKey] ?? { label: typeKey, emoji: '🎫' };
    const embed = new EmbedBuilder()
        .setTitle('📌 Log de Ticket')
        .setColor(0x7c3aed)
        .addFields(
            { name: '🎫 Tipo', value: `${category.emoji} ${category.label}`, inline: true },
            { name: '📍 Canal', value: `<#${channel.id}>`, inline: true },
            { name: '🧾 Ação', value: action, inline: true },
            { name: '👤 Abriu', value: openerId ? `<@${openerId}>` : '—', inline: false },
            { name: '👨‍💼 Assumiu', value: claimedById ? `<@${claimedById}>` : '—', inline: true },
            { name: '🔒 Fechou', value: closerId ? `<@${closerId}>` : '—', inline: true }
        );
    applyGuildBranding(embed, guild);

    const files = [];
    if (transcriptText) {
        const buffer = Buffer.from(transcriptText, 'utf8');
        files.push(new AttachmentBuilder(buffer, { name: `transcript-${channel.id}.txt` }));
    }

    await logChannel.send({ embeds: [embed], files });
}

client.on('interactionCreate', async (interaction) => {
    try {
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'verificar_idade_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const fullName = interaction.fields.getTextInputValue('age_full_name')?.trim() ?? '';
                const birthRaw = interaction.fields.getTextInputValue('age_birth_date')?.trim() ?? '';

                if (fullName.length < 5) {
                    await replyAndDeleteMs(interaction, '❌ Informe seu nome completo.', AGE_VERIFY_DELETE_MS);
                    return;
                }

                const birthDate = parseBirthDate(birthRaw);
                if (!birthDate) {
                    await replyAndDeleteMs(interaction, '❌ Data de nascimento inválida. Use DD/MM/AAAA (ex.: 31/12/2000).', AGE_VERIFY_DELETE_MS);
                    return;
                }

                const now = new Date();
                if (birthDate.getTime() > now.getTime()) {
                    await replyAndDeleteMs(interaction, '❌ Data de nascimento inválida (no futuro).', AGE_VERIFY_DELETE_MS);
                    return;
                }

                const age = getAgeYears(birthDate, now);
                const isEligible = age >= 18;

                pendingAgeVerifyByUserId.set(interaction.user.id, {
                    fullName,
                    birthDateIso: birthDateToIsoDate(birthDate),
                    age,
                    createdAt: Date.now()
                });

                const embed = createAgeCheckEmbed({
                    guild: interaction.guild,
                    fullName,
                    birthDate,
                    age,
                    isEligible
                });

                const components = createAgeCheckConfirmRow({ isEligible });
                await interaction.editReply({ embeds: [embed], components });
                scheduleDeleteReplyMs(interaction, AGE_VERIFY_PREVIEW_DELETE_MS);

                if (!isEligible) {
                    await trySendDM(
                        interaction.user,
                        `❌ NÃO LIBERADO\n\nSua verificação de idade não foi aprovada. Você precisa ter 18 anos ou mais para acessar os canais principais.\n\nSe você digitou a data incorretamente, faça a verificação novamente.`
                    );
                }
            } catch (err) {
                const isMissingPermissions =
                    (typeof err?.code === 'number' && err.code === 50013) ||
                    (typeof err?.status === 'number' && err.status === 403) ||
                    (typeof err?.rawError?.code === 'number' && err.rawError.code === 50013);

                const message = isMissingPermissions
                    ? '❌ Sem permissão para atribuir/remover cargos. Verifique se o bot tem "Gerenciar Cargos" e se o cargo do bot está acima dos cargos envolvidos.'
                    : '❌ Erro ao concluir a verificação. Tente novamente.';

                if (interaction.deferred || interaction.replied) {
                    await replyAndDeleteMs(interaction, message, AGE_VERIFY_DELETE_MS).catch(() => {});
                } else {
                    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
                    scheduleDeleteReplyMs(interaction, AGE_VERIFY_DELETE_MS);
                }
                logError('Erro no modal verificar_idade_modal', err);
            }
            return;
        }

        if (interaction.customId === 'musicpanel_addlink_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (!(await ensureCanPlayNow(interaction))) return;

                const link = interaction.fields.getTextInputValue('musicpanel_link')?.trim() ?? '';
                if (!link) {
                    await replyAndDelete(interaction, '❌ Informe um link ou o nome da música.');
                    return;
                }

                const voiceChannel = interaction.member?.voice?.channel ?? null;
                if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
                    await replyAndDelete(interaction, '❌ Entre em uma sala de voz primeiro.');
                    return;
                }

                const ctrl = musicManager.get(interaction.guild.id);
                ctrl.setTextChannel(interaction.channelId);
                await ctrl.ensureConnection(voiceChannel);

                const tracks = await ctrl.enqueue(link, { requestedById: interaction.user.id });
                await ctrl.playNext();

                await replyAndDelete(interaction, `▶️ Adicionado na fila: ${tracks.length} item(ns).`);
            } catch (err) {
                const code = String(err?.message ?? '');
                const isTimeout = typeof err?.message === 'string' && err.message.startsWith('Timeout:');
                if (isTimeout) {
                    await replyAndDelete(interaction, '⏳ O YouTube demorou para responder. Tente novamente.');
                    return;
                }
                if (code === 'QUERY_VAZIA') {
                    await replyAndDelete(interaction, '❌ Informe um link ou nome da música.');
                    return;
                }
                if (code === 'NAO_ENCONTRADO') {
                    await replyAndDelete(interaction, '❌ Não encontrei resultados para essa busca.');
                    return;
                }
                if (code === 'TIPO_NAO_SUPORTADO') {
                    await replyAndDelete(interaction, '❌ Link não suportado. Use vídeo/playlist do YouTube ou nome da música.');
                    return;
                }
                if (code === 'SEM_PERMISSAO_VOICE') {
                    await replyAndDeleteMs(interaction, '❌ Sem permissão para entrar/falar na sala de voz.', 20000);
                    return;
                }
                if (code === 'SALA_CHEIA') {
                    await replyAndDeleteMs(interaction, '❌ A sala de voz está cheia. Escolha outra sala.', 20000);
                    return;
                }
                if (code === 'VOICE_TIMEOUT') {
                    await replyAndDeleteMs(interaction, getVoiceTimeoutHelp(), 25000);
                    return;
                }
                if (code === 'DESTROYED') {
                    await replyAndDelete(interaction, '⚠️ O player foi reiniciado. Tente novamente.');
                    return;
                }
                if (code === 'STREAM_FALHOU') {
                    await replyAndDeleteMs(interaction, '❌ Não consegui abrir o áudio desse link. Tente outro vídeo/playlist.', 20000);
                    return;
                }
                const msg = String(err?.message ?? '');
                const isUserError =
                    msg.includes('Sign in') ||
                    msg.includes('private video') ||
                    msg.includes('unavailable') ||
                    msg.includes('Video unavailable') ||
                    msg.includes('This video is not available') ||
                    msg.includes('age-restricted');
                if (isUserError) {
                    await replyAndDeleteMs(interaction, '❌ Esse vídeo não está disponível para tocar (restrito/privado/indisponível).', 20000);
                    return;
                }
                logError('Erro no modal musicpanel_addlink_modal', err);
                await replyAndDeleteMs(interaction, '❌ Erro ao adicionar o link. Tente novamente.', 20000);
            }
            return;
        }

        if (interaction.customId === 'musicpanel_volume_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (!(await ensureCanPlayNow(interaction))) return;
                const raw = interaction.fields.getTextInputValue('musicpanel_volume_value')?.trim() ?? '';
                const value = Number(raw);
                if (!Number.isFinite(value)) {
                    await replyAndDelete(interaction, '❌ Informe um número válido (0 a 200).');
                    return;
                }
                const ctrl = musicManager.get(interaction.guild.id);
                const vol = ctrl.setVolumePercent(value);
                await replyAndDelete(interaction, `🔊 Volume ajustado: ${vol}%`);
            } catch (err) {
                logError('Erro no modal musicpanel_volume_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao ajustar volume.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_imagens_seq_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const title = interaction.fields.getTextInputValue('adminpanel_imagens_seq_title')?.trim() ?? '';
                const mensagem = interaction.fields.getTextInputValue('adminpanel_imagens_seq_msg')?.trim() ?? '';
                const raw = interaction.fields.getTextInputValue('adminpanel_imagens_seq_urls')?.trim() ?? '';

                const matches = raw.match(/https?:\/\/\S+/gi) ?? [];
                const urls = matches
                    .map((u) => String(u).trim().replace(/^<+/, '').replace(/>+$/, ''))
                    .filter((u) => /^https?:\/\/\S+$/i.test(u));

                const unique = Array.from(new Set(urls)).slice(0, 15);
                if (!unique.length) {
                    await replyAndDelete(interaction, '❌ Informe pelo menos 1 link de imagem (http/https).');
                    return;
                }

                pendingAdminActionByUserId.set(interaction.user.id, {
                    action: 'imagens_seq',
                    title,
                    mensagem,
                    urls: unique
                });

                const components = await buildAdminPickerCategoryComponents({
                    guild: interaction.guild,
                    action: 'imagens_seq',
                    ownerId: interaction.user.id,
                    page: 0,
                    maxValues: 1
                });
                await interaction.editReply({
                    content: `Selecione a categoria (ou Todos) para escolher o canal.\nImagens: ${unique.length}/15`,
                    components
                });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no adminpanel_imagens_seq_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao preparar imagens sequenciais.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_avisocanais_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const mensagem = interaction.fields.getTextInputValue('adminpanel_aviso_msg')?.trim() ?? '';
                if (!mensagem) {
                    await replyAndDelete(interaction, '❌ Informe a mensagem.');
                    return;
                }

                pendingAdminActionByUserId.set(interaction.user.id, { action: 'avisocanais', mensagem });
                const components = await buildAdminPickerCategoryComponents({
                    guild: interaction.guild,
                    action: 'avisocanais',
                    ownerId: interaction.user.id,
                    page: 0,
                    maxValues: 5
                });
                await interaction.editReply({ content: 'Selecione a categoria (ou Todos) para escolher canais.', components });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no adminpanel_avisocanais_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao preparar aviso.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_limparlogs_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para limpar mensagens.');
                    return;
                }

                const raw = interaction.fields.getTextInputValue('adminpanel_limpar_qtd')?.trim() ?? '';
                const quantidade = Number(raw);
                if (!Number.isFinite(quantidade) || quantidade < 1 || quantidade > 100) {
                    await replyAndDelete(interaction, '❌ Quantidade inválida (1-100).');
                    return;
                }

                pendingAdminActionByUserId.set(interaction.user.id, { action: 'limparlogs', quantidade: Math.floor(quantidade) });
                const components = await buildAdminPickerCategoryComponents({
                    guild: interaction.guild,
                    action: 'limparlogs',
                    ownerId: interaction.user.id,
                    page: 0,
                    maxValues: 1
                });
                await interaction.editReply({ content: 'Selecione a categoria (ou Todos) para escolher o canal da limpeza.', components });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no adminpanel_limparlogs_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao preparar limpeza.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_metas_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const title = interaction.fields.getTextInputValue('adminpanel_metas_title')?.trim() ?? '';
                const mensagem = interaction.fields.getTextInputValue('adminpanel_metas_msg')?.trim() ?? '';
                if (!mensagem) {
                    await replyAndDelete(interaction, '❌ Informe a mensagem das metas.');
                    return;
                }

                pendingAdminActionByUserId.set(interaction.user.id, {
                    action: 'metas',
                    title,
                    mensagem,
                    authorId: interaction.user.id,
                    authorTag: interaction.user.tag,
                    authorAvatarUrl: getUserAvatarUrl(interaction.user)
                });
                const components = await buildAdminPickerCategoryComponents({
                    guild: interaction.guild,
                    action: 'metas',
                    ownerId: interaction.user.id,
                    page: 0,
                    maxValues: 1
                });
                await interaction.editReply({ content: 'Selecione a categoria (ou Todos) para escolher o canal das metas.', components });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no adminpanel_metas_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao preparar metas.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_regras_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const title = interaction.fields.getTextInputValue('adminpanel_regras_title')?.trim() ?? '';
                const mensagem = interaction.fields.getTextInputValue('adminpanel_regras_msg')?.trim() ?? '';
                const linkCity = interaction.fields.getTextInputValue('adminpanel_regras_city')?.trim() ?? '';
                const linkFac = interaction.fields.getTextInputValue('adminpanel_regras_fac')?.trim() ?? '';

                if (!mensagem) {
                    await replyAndDelete(interaction, '❌ Informe a mensagem das regras.');
                    return;
                }
                if (!isValidHttpUrl(linkCity) || !isValidHttpUrl(linkFac)) {
                    await replyAndDelete(interaction, '❌ Links inválidos. Use links completos começando com http:// ou https://');
                    return;
                }

                pendingAdminActionByUserId.set(interaction.user.id, {
                    action: 'regras',
                    title,
                    mensagem,
                    linkCity,
                    linkFac,
                    authorId: interaction.user.id,
                    authorTag: interaction.user.tag,
                    authorAvatarUrl: getUserAvatarUrl(interaction.user)
                });
                const components = await buildAdminPickerCategoryComponents({
                    guild: interaction.guild,
                    action: 'regras',
                    ownerId: interaction.user.id,
                    page: 0,
                    maxValues: 1
                });
                await interaction.editReply({ content: 'Selecione a categoria (ou Todos) para escolher o canal das regras.', components });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no adminpanel_regras_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao preparar regras.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_radio_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const frequencia = interaction.fields.getTextInputValue('adminpanel_radio_freq')?.trim() ?? '';
                const descricao = interaction.fields.getTextInputValue('adminpanel_radio_desc')?.trim() ?? '';

                if (!frequencia || frequencia.length < 2) {
                    await replyAndDelete(interaction, '❌ Informe a frequência.');
                    return;
                }
                if (!descricao || descricao.length < 5) {
                    await replyAndDelete(interaction, '❌ Informe a descrição.');
                    return;
                }

                pendingAdminActionByUserId.set(interaction.user.id, {
                    action: 'radio',
                    frequencia,
                    descricao,
                    authorId: interaction.user.id,
                    authorTag: interaction.user.tag,
                    authorAvatarUrl: getUserAvatarUrl(interaction.user)
                });
                const components = await buildAdminPickerCategoryComponents({
                    guild: interaction.guild,
                    action: 'radio',
                    ownerId: interaction.user.id,
                    page: 0,
                    maxValues: 1
                });
                await interaction.editReply({ content: 'Selecione a categoria (ou Todos) para escolher o canal da rádio.', components });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no adminpanel_radio_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao preparar rádio.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_avisogeral_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const descricao = interaction.fields.getTextInputValue('adminpanel_avisogeral_desc')?.trim() ?? '';
                const mensagem = interaction.fields.getTextInputValue('adminpanel_avisogeral_msg')?.trim() ?? '';
                if (!descricao || descricao.length < 3) {
                    await replyAndDelete(interaction, '❌ Informe uma descrição.');
                    return;
                }
                if (!mensagem || mensagem.length < 3) {
                    await replyAndDelete(interaction, '❌ Informe a mensagem.');
                    return;
                }

                pendingAdminActionByUserId.set(interaction.user.id, {
                    action: 'avisogeral',
                    descricao,
                    mensagem,
                    authorId: interaction.user.id,
                    authorTag: interaction.user.tag,
                    authorAvatarUrl: getUserAvatarUrl(interaction.user)
                });
                const components = await buildAdminPickerCategoryComponents({
                    guild: interaction.guild,
                    action: 'avisogeral',
                    ownerId: interaction.user.id,
                    page: 0,
                    maxValues: 1
                });
                await interaction.editReply({ content: 'Selecione a categoria (ou Todos) para escolher o canal do aviso geral.', components });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no adminpanel_avisogeral_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao preparar aviso geral.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_avisouser_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const rawUser = interaction.fields.getTextInputValue('adminpanel_avisouser_user')?.trim() ?? '';
                const mensagem = interaction.fields.getTextInputValue('adminpanel_avisouser_msg')?.trim() ?? '';
                const match = rawUser.match(/\d{17,20}/);
                const userId = match ? match[0] : null;
                if (!userId || !mensagem) {
                    await replyAndDelete(interaction, '❌ Informe o usuário e a mensagem.');
                    return;
                }

                const user = await client.users.fetch(userId).catch(() => null);
                if (!user) {
                    await replyAndDelete(interaction, '❌ Usuário inválido.');
                    return;
                }

                const ok = await trySendDM(user, mensagem);
                await replyAndDelete(interaction, ok ? `✅ Enviado no privado de <@${userId}>.` : `⚠️ Não consegui enviar DM para <@${userId}>.`);
            } catch (err) {
                logError('Erro no adminpanel_avisouser_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao enviar DM.');
            }
            return;
        }

        if (interaction.customId === 'adminpanel_cargos_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (interaction.channelId !== getAdminPanelChannelId()) {
                    await replyAndDelete(interaction, `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`);
                    return;
                }
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão.');
                    return;
                }

                const rawUser = interaction.fields.getTextInputValue('adminpanel_cargos_user')?.trim() ?? '';
                const rawAdd = interaction.fields.getTextInputValue('adminpanel_cargos_add')?.trim() ?? '';
                const rawRemove = interaction.fields.getTextInputValue('adminpanel_cargos_remove')?.trim() ?? '';

                const userId = rawUser.match(/\d{17,20}/)?.[0] ?? null;
                const addRoleId = rawAdd.match(/\d{17,20}/)?.[0] ?? null;
                const removeRoleId = rawRemove.match(/\d{17,20}/)?.[0] ?? null;

                if (!userId || !addRoleId) {
                    await replyAndDelete(interaction, '❌ Informe o usuário e o cargo para adicionar.');
                    return;
                }

                const target = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!target) {
                    await replyAndDelete(interaction, '❌ Usuário não encontrado no servidor.');
                    return;
                }

                const addRole = interaction.guild.roles.cache.get(addRoleId) ?? null;
                const removeRole = removeRoleId ? interaction.guild.roles.cache.get(removeRoleId) : null;
                if (!addRole) {
                    await replyAndDelete(interaction, '❌ Cargo para adicionar inválido.');
                    return;
                }

                const log = interaction.guild.channels.cache.get(config.logChannel);
                const executorTag = interaction.user.tag;
                const targetTag = target.user.tag;

                let removed = false;
                if (removeRole && target.roles.cache.has(removeRole.id)) {
                    await target.roles.remove(removeRole).catch(() => {});
                    removed = true;
                }

                await target.roles.add(addRole);

                const dmSent = await trySendDM(
                    target.user,
                    formatDM({
                        title: '🧩 Cargos Atualizados',
                        guildName: interaction.guild.name,
                        details: [
                            `👤 Você: <@${userId}>`,
                            ...(removed ? [`➖ Removido: @${removeRole.name}`] : []),
                            `➕ Adicionado: @${addRole.name}`
                        ],
                        executorTag
                    })
                );

                await sendLog(
                    log,
                    createLogEmbed({
                        title: '🧩 Cargos Atualizados',
                        color: 0x3b82f6,
                        guild: interaction.guild,
                        executorId: interaction.user.id,
                        executorTag,
                        targetId: userId,
                        targetTag,
                        fields: [
                            ...(removed ? [{ name: 'Removido', value: getRoleLabel(interaction.guild, removeRole.id), inline: false }] : []),
                            { name: 'Adicionado', value: getRoleLabel(interaction.guild, addRole.id), inline: false },
                            { name: 'DM', value: dmSent ? '✅ Enviado' : '⚠️ Falhou', inline: true }
                        ]
                    })
                );

                logInfo(`Cargos | Executor: ${executorTag} | Usuario: ${targetTag} | Add: ${addRole.name} (${addRole.id}) | Remove: ${removeRole?.name ?? '—'} | DM: ${dmSent ? 'ok' : 'falhou'}`);
                await replyAndDelete(
                    interaction,
                    `✅ Cargos atualizados.\nUsuário: <@${userId}>\nAdicionado: ${getRoleLabel(interaction.guild, addRole.id)}${
                        removed ? `\nRemovido: ${getRoleLabel(interaction.guild, removeRole.id)}` : ''
                    }\nDM: ${dmSent ? 'Enviado' : 'Falhou'}`
                );
            } catch (err) {
                logError('Erro no adminpanel_cargos_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao atualizar cargos.');
            }
            return;
        }

        if (interaction.customId === 'setagem_pedir_modal') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const setagem = getSetagemConfig();
                if (!setagem.approvalChannelId) {
                    await replyAndDelete(interaction, '❌ Setagem não configurada: canal de aprovação não definido no Painel Central.');
                    return;
                }

                const rpId = interaction.fields.getTextInputValue('setagem_rp_id')?.trim() ?? '';
                const rpNome = interaction.fields.getTextInputValue('setagem_rp_nome')?.trim() ?? '';
                const rpCel = interaction.fields.getTextInputValue('setagem_rp_cel')?.trim() ?? '';
                const recrutador = interaction.fields.getTextInputValue('setagem_recrutador')?.trim() ?? '';

                if (!rpId || !rpNome || !rpCel || !recrutador) {
                    await replyAndDelete(interaction, '❌ Preencha todos os campos.');
                    return;
                }

                const guild = interaction.guild;
                const approvalChannel = await client.channels.fetch(setagem.approvalChannelId).catch(() => null);
                if (!approvalChannel || !approvalChannel.isTextBased?.()) {
                    await replyAndDelete(interaction, '❌ Canal de aprovação inválido. Configure novamente no Painel Central.');
                    return;
                }

                const requestId = newSetagemRequestId();
                const requestedAtMs = Date.now();
                const user = interaction.user;
                const avatarUrl = getUserAvatarUrl(user);

                const embed = new EmbedBuilder()
                    .setTitle('🧩 Pedido de Setagem')
                    .setColor(0x0ea5e9)
                    .setDescription(`Solicitação enviada por <@${user.id}> (${user.tag})`)
                    .addFields(
                        { name: 'ID no RP', value: rpId, inline: true },
                        { name: 'Nome no RP', value: rpNome, inline: true },
                        { name: 'Celular no RP', value: rpCel, inline: true },
                        { name: 'Recrutador', value: recrutador, inline: false },
                        { name: 'Pedido em', value: formatDiscordTimestampMs(requestedAtMs), inline: false }
                    );
                applyGuildBranding(embed, guild);
                if (avatarUrl) embed.setThumbnail(avatarUrl);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`setagem_aprovar:${requestId}`).setLabel('Aprovar').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`setagem_reprovar:${requestId}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger)
                );

                const sent = await approvalChannel.send({ embeds: [embed], components: [row] });

                setagemRequestsById.set(requestId, {
                    id: requestId,
                    guildId: guild.id,
                    requesterId: user.id,
                    requesterTag: user.tag,
                    avatarUrl,
                    rpId,
                    rpNome,
                    rpCel,
                    recrutador,
                    requestedAtMs,
                    approvalChannelId: sent.channel.id,
                    approvalMessageId: sent.id,
                    status: 'pending',
                    decidedById: null,
                    decidedAtMs: null,
                    decidedRoleId: null
                });

                await replyAndDelete(interaction, '✅ Pedido enviado! Aguarde a equipe aprovar/reprovar.');
            } catch (err) {
                logError('Erro no setagem_pedir_modal', err);
                await replyAndDelete(interaction, '❌ Erro ao enviar pedido de setagem.');
            }
            return;
        }

        if (interaction.customId !== 'ticketfarm_modal') return;

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const farm = getTicketFarmConfig();
            if (!farm.categoryId) {
                await replyAndDelete(interaction, '❌ TicketFarm não configurado: categoryId ausente no config.json');
                return;
            }

            const parent = await interaction.guild.channels.fetch(farm.categoryId).catch(() => null);
            if (!parent || parent.type !== ChannelType.GuildCategory) {
                await replyAndDelete(interaction, '❌ categoryId do TicketFarm inválido (não é uma categoria)');
                return;
            }

            const now = Date.now();
            const last = ticketFarmCooldownByUserId.get(interaction.user.id) ?? 0;
            const cooldownMs = farm.cooldownSeconds * 1000;
            const remaining = last + cooldownMs - now;
            if (cooldownMs > 0 && remaining > 0) {
                await replyAndDelete(interaction, `⏳ Aguarde ${Math.ceil(remaining / 1000)}s para abrir outro TicketFarm.`);
                return;
            }

            const playerName = interaction.fields.getTextInputValue('farm_player_name')?.trim() ?? '';
            const playerId = interaction.fields.getTextInputValue('farm_player_id')?.trim() ?? '';

            const base = `farm-${sanitizeChannelName(interaction.user.username)}-${sanitizeChannelName(playerName || 'player')}`;
            let name = base.slice(0, 90);
            let i = 2;
            while (interaction.guild.channels.cache.some((c) => c.type === ChannelType.GuildText && c.name === name)) {
                name = `${base}-${i++}`.slice(0, 90);
            }

            const overwrites = [
                { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ];

            const allowRoleIds = new Set([...(farm.viewerRoles ?? []), ...(farm.adminRoles ?? [])]);
            for (const roleId of allowRoleIds) {
                overwrites.push({
                    id: roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                });
            }

            const meta = {
                'farm.userId': interaction.user.id,
                'farm.status': 'open',
                'farm.createdAt': String(Date.now()),
                'farm.playerName': playerName,
                'farm.playerId': playerId,
                'farm.claimedBy': ''
            };
            await interaction.editReply('⏳ Criando canal do TicketFarm...');
            const channel = await interaction.guild.channels.create({
                name,
                type: ChannelType.GuildText,
                parent: parent.id,
                permissionOverwrites: overwrites,
                topic: buildTicketTopic(meta)
            });

            const introEmbed = createTicketFarmIntroEmbed({
                guild: interaction.guild,
                openerId: interaction.user.id,
                openerTag: interaction.user.tag,
                playerName,
                playerId,
                claimedById: null,
                isClosed: false
            });

            const introMsg = await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [introEmbed],
                components: createTicketFarmActionRows({ isClosed: false })
            });
            void introMsg;

            ticketFarmCooldownByUserId.set(interaction.user.id, now);
            await replyAndDelete(interaction, `✅ TicketFarm criado: <#${channel.id}>`);
        } catch (err) {
            logError('Erro no modal TicketFarm', err);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply('❌ Erro ao criar TicketFarm. Veja o console.');
                } else {
                    await interaction.reply({ content: '❌ Erro ao criar TicketFarm. Veja o console.', flags: MessageFlags.Ephemeral });
                }
            } catch {}
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        const supportedCommands = new Set(['paineladm', ...musicSlashByName.keys()]);
        if (!supportedCommands.has(interaction.commandName)) return;

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (interaction.commandName === 'paineladm') {
                if (!canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para abrir o Painel Central');
                    return;
                }

                if (interaction.channelId !== PAINELADM_COMMAND_CHANNEL_ID) {
                    await replyAndDelete(interaction, `❌ Use este comando apenas no canal <#${PAINELADM_COMMAND_CHANNEL_ID}>.`);
                    return;
                }

                const targetChannel = interaction.options.getChannel('canal', true);
                if (!targetChannel || !targetChannel.isTextBased?.()) {
                    await replyAndDelete(interaction, '❌ Canal inválido');
                    return;
                }

                try {
                    await ensureAdminPanel({ channelId: targetChannel.id });
                    await replyAndDelete(interaction, `✅ Painel Central enviado/atualizado em <#${targetChannel.id}>`);
                } catch (err) {
                    const code = String(err?.message ?? '');
                    if (code.startsWith('ADMIN_PANEL_CHANNEL_INVALID:')) {
                        await replyAndDelete(interaction, '❌ O bot não tem acesso a esse canal (Missing Access) ou o canal é inválido.');
                        return;
                    }
                    if (code.startsWith('ADMIN_PANEL_MISSING_PERMS:')) {
                        const missing = code.split(':')[1] ?? '';
                        await replyAndDelete(interaction, `❌ Falta permissão do bot no canal: ${missing || '—'}`);
                        return;
                    }
                    if (code.startsWith('ADMIN_PANEL_SEND_FAILED')) {
                        const parts = code.split(':');
                        const apiCode = parts[1] ?? '';
                        const apiMsg = parts.slice(2).join(':').trim();
                        const extra = apiCode || apiMsg ? `\nCódigo: ${apiCode || '—'}\nMotivo: ${apiMsg || '—'}` : '';
                        await replyAndDelete(interaction, `❌ Não consegui enviar a mensagem no canal.${extra}`);
                        return;
                    }
                    if (code.startsWith('ADMIN_PANEL_EDIT_FAILED')) {
                        const parts = code.split(':');
                        const apiCode = parts[1] ?? '';
                        const apiMsg = parts.slice(2).join(':').trim();
                        const extra = apiCode || apiMsg ? `\nCódigo: ${apiCode || '—'}\nMotivo: ${apiMsg || '—'}` : '';
                        await replyAndDelete(interaction, `❌ Não consegui atualizar a mensagem do painel.${extra}`);
                        return;
                    }
                    logError('Erro no /paineladm', err);
                    await replyAndDelete(interaction, '❌ Erro ao enviar o Painel Central. Veja o console.');
                }
                return;
            }

            const musicCmd = musicSlashByName.get(interaction.commandName) ?? null;
            if (musicCmd) {
                await musicCmd.execute(interaction, { musicManager, ensureCanPlayNow, replyAndDelete });
                return;
            }

            if (interaction.commandName === 'limparlogs') {
                const canal = interaction.options.getChannel('canal', true);
                const quantidade = interaction.options.getInteger('quantidade', true);

                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para limpar mensagens');
                    return;
                }

                if (!canal || canal.type !== ChannelType.GuildText) {
                    await replyAndDelete(interaction, '❌ Canal inválido');
                    return;
                }

                const deleted = await canal.bulkDelete(quantidade, true);
                await replyAndDelete(interaction, `🧹 Limpeza concluída em <#${canal.id}>.\nApagadas: ${deleted.size}/${quantidade} (mensagens com mais de 14 dias não podem ser apagadas).`);
                return;
            }

            if (interaction.commandName === 'ticketpainel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para enviar o painel');
                    return;
                }

                const channel = interaction.options.getChannel('canal') ?? interaction.channel;
                if (!channel || channel.type !== ChannelType.GuildText) {
                    await replyAndDelete(interaction, '❌ Canal inválido');
                    return;
                }

                await channel.send({ embeds: [createTicketPanelEmbed(interaction.guild)], components: createTicketPanelRows() });
                await replyAndDelete(interaction, `✅ Painel enviado em <#${channel.id}>`);
                return;
            }

            if (interaction.commandName === 'ticketfarmpainel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para enviar o painel');
                    return;
                }

                const channel = interaction.options.getChannel('canal') ?? interaction.channel;
                if (!channel || channel.type !== ChannelType.GuildText) {
                    await replyAndDelete(interaction, '❌ Canal inválido');
                    return;
                }

                await channel.send({ embeds: [createTicketFarmPanelEmbed(interaction.guild)], components: createTicketFarmPanelRows() });
                await replyAndDelete(interaction, `✅ Painel TicketFarm enviado em <#${channel.id}>`);
                return;
            }

            if (interaction.commandName === 'verificacao') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para enviar o painel de verificação');
                    return;
                }

                const configuredChannelId = String(config.canalVerificacaoId ?? '').trim();
                const channel =
                    (/^\d{17,20}$/.test(configuredChannelId) ? interaction.guild.channels.cache.get(configuredChannelId) : null) ??
                    interaction.channel;
                if (!channel || channel.type !== ChannelType.GuildText) {
                    await replyAndDelete(interaction, '❌ Canal inválido');
                    return;
                }

                await channel.send({ embeds: [createAgeVerificationEmbed(interaction.guild)], components: createAgeVerificationRows() });
                await replyAndDelete(interaction, `✅ Painel de verificação enviado em <#${channel.id}>`);
                return;
            }

            if (interaction.commandName === 'painelcalc') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para enviar o painel');
                    return;
                }

                if (interaction.channelId !== COMMANDS_ALLOWED_CHANNEL_ID) {
                    await replyAndDelete(interaction, `❌ Use este comando apenas no canal <#${COMMANDS_ALLOWED_CHANNEL_ID}>.`);
                    return;
                }

                const targetChannel = interaction.options.getChannel('canal', true);
                if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
                    await replyAndDelete(interaction, '❌ Canal inválido');
                    return;
                }

                await targetChannel.send({ embeds: [createCalcPanelEmbed(interaction.guild)], components: createCalcPanelRows() });
                await replyAndDelete(interaction, `✅ Painel enviado em <#${targetChannel.id}>`);
                return;
            }

            if (interaction.commandName === 'aviso') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para enviar avisos');
                    return;
                }

                const mensagem = interaction.options.getString('mensagem', true).trim();
                if (!mensagem) {
                    await replyAndDelete(interaction, '❌ Informe a mensagem do aviso');
                    return;
                }

                const channels = [];
                const seen = new Set();
                for (let i = 1; i <= 5; i++) {
                    const ch = interaction.options.getChannel(`canal${i}`);
                    if (!ch) continue;
                    if (ch.type !== ChannelType.GuildText) continue;
                    if (seen.has(ch.id)) continue;
                    seen.add(ch.id);
                    channels.push(ch);
                }

                if (!channels.length) {
                    await replyAndDelete(interaction, '❌ Selecione pelo menos 1 canal válido');
                    return;
                }

                const ok = [];
                const fail = [];
                for (const ch of channels) {
                    try {
                        await ch.send({ content: mensagem });
                        ok.push(ch.id);
                    } catch (err) {
                        fail.push(ch.id);
                        logError(`Falha ao enviar aviso no canal ${ch.id}`, err);
                    }
                }

                const lines = [];
                lines.push('📣 Aviso enviado.');
                lines.push(`✅ Sucesso: ${ok.length ? ok.map((id) => `<#${id}>`).join(', ') : '—'}`);
                if (fail.length) lines.push(`⚠️ Falhou: ${fail.map((id) => `<#${id}>`).join(', ')}`);
                await replyAndDelete(interaction, lines.join('\n'));
                return;
            }

            if (interaction.commandName === 'avisouser') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !canUseCommands(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Você não tem permissão para enviar avisos');
                    return;
                }

                const user = interaction.options.getUser('usuario', true);
                const mensagem = interaction.options.getString('mensagem', true).trim();
                if (!mensagem) {
                    await replyAndDelete(interaction, '❌ Informe a mensagem do aviso');
                    return;
                }

                const dmSent = await trySendDM(user, mensagem);
                await replyAndDelete(interaction, `📩 Aviso enviado para <@${user.id}>.\nDM: ${dmSent ? '✅ Enviado' : '⚠️ Falhou'}`);
                return;
            }

            if (interaction.commandName === 'play') {
                if (!(await ensureCanPlayNow(interaction))) return;
                const link = interaction.options.getString('link', true).trim();
                const voiceChannel = interaction.member?.voice?.channel ?? null;
                if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
                    await replyAndDelete(interaction, '❌ Entre em uma sala de voz primeiro.');
                    return;
                }

                try {
                    await connectToVoice({ guild: interaction.guild, voiceChannel });
                } catch (err) {
                    const code = String(err?.message ?? '');
                    if (code === 'SEM_PERMISSAO_VOICE') {
                        await replyAndDelete(interaction, '❌ Sem permissão para conectar/falar nessa sala de voz.');
                        return;
                    }
                    if (code === 'SALA_CHEIA') {
                        await replyAndDelete(interaction, '❌ A sala de voz está cheia (limite de usuários).');
                        return;
                    }
                    if (code === 'VOICE_TIMEOUT') {
                        await replyAndDelete(interaction, getVoiceTimeoutHelp());
                        return;
                    }
                    logError('Falha ao entrar na sala de voz', err);
                    await replyAndDelete(interaction, '❌ Não consegui entrar na sala de voz.');
                    return;
                }

                let tracks;
                try {
                    tracks = await enqueueFromLink({ link, requestedById: interaction.user.id, guildName: interaction.guild.name });
                } catch (err) {
                    const code = String(err?.message ?? '');
                    if (code === 'LINK_INVALIDO') {
                        await replyAndDelete(interaction, '❌ Link inválido.');
                        return;
                    }
                    if (code === 'LINK_NAO_SUPORTADO') {
                        await replyAndDelete(interaction, '❌ Link não suportado. Use vídeo/playlist do YouTube (ou Spotify).');
                        return;
                    }
                    logError('Falha ao processar link do /play', err);
                    await replyAndDelete(interaction, '❌ Erro ao processar o link. Tente outro link.');
                    return;
                }

                const music = getMusicState(interaction.guild.id);
                music.queue.push(...tracks);

                if (music.player.state.status === AudioPlayerStatus.Idle && !music.current) {
                    await playNextInGuild(interaction.guild.id);
                }

                const warn = !music.current && music.lastError ? `\n⚠️ Não tocou: ${music.lastError}` : '';
                await replyAndDelete(interaction, `▶️ Adicionado na fila: ${tracks.length} item(ns).\nSala: <#${voiceChannel.id}>${warn}`);
                return;
            }

            if (interaction.commandName === 'skip') {
                const music = musicByGuildId.get(interaction.guild.id);
                if (!music?.current) {
                    await replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                    return;
                }

                music.player.stop(true);
                await replyAndDelete(interaction, '⏭️ Pulando...');
                return;
            }

            if (interaction.commandName === 'stop') {
                const music = musicByGuildId.get(interaction.guild.id);
                if (!music) {
                    await replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                    return;
                }

                music.queue = [];
                music.current = null;
                try {
                    music.player.stop(true);
                } catch {}
                try {
                    music.connection?.destroy();
                } catch {}
                music.connection = null;
                music.voiceChannelId = null;

                await replyAndDelete(interaction, '⏹️ Música parada e fila limpa.');
                return;
            }

            if (interaction.commandName === 'pause') {
                const music = musicByGuildId.get(interaction.guild.id);
                if (!music?.current) {
                    await replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                    return;
                }
                const ok = music.player.pause();
                await replyAndDelete(interaction, ok ? '⏸️ Pausado.' : '⚠️ Não consegui pausar.');
                return;
            }

            if (interaction.commandName === 'resume') {
                const music = musicByGuildId.get(interaction.guild.id);
                if (!music?.current) {
                    await replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                    return;
                }
                const ok = music.player.unpause();
                await replyAndDelete(interaction, ok ? '▶️ Retomado.' : '⚠️ Não consegui retomar.');
                return;
            }

            if (interaction.commandName === 'queue') {
                const music = musicByGuildId.get(interaction.guild.id);
                if (!music?.current && (!music?.queue || music.queue.length === 0)) {
                    const extra = music?.lastError ? `\n⚠️ Último erro: ${music.lastError}` : '';
                    await replyAndDelete(interaction, `📭 Fila vazia.${extra}`);
                    return;
                }

                const lines = [];
                if (music.lastError) lines.push(`⚠️ Último erro: ${music.lastError}`);
                if (music.current) lines.push(`🎶 Tocando agora: ${music.current.title}`);
                const upcoming = (music.queue ?? []).slice(0, 10);
                if (upcoming.length) {
                    lines.push('🗒️ Próximas:');
                    for (let i = 0; i < upcoming.length; i++) lines.push(`${i + 1}. ${upcoming[i].title}`);
                }
                if ((music.queue?.length ?? 0) > 10) lines.push(`… e mais ${music.queue.length - 10} na fila`);
                await replyAndDelete(interaction, lines.join('\n'));
                return;
            }

            if (interaction.commandName === 'mix') {
                if (!(await ensureCanPlayNow(interaction))) return;
                const voiceChannel = interaction.member?.voice?.channel ?? null;
                if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
                    await replyAndDelete(interaction, '❌ Entre em uma sala de voz primeiro.');
                    return;
                }

                const quantidade = interaction.options.getInteger('quantidade') ?? 30;
                const estilosRaw = interaction.options.getString('estilos') ?? '';
                const styles = parseStyles(estilosRaw);

                try {
                    await connectToVoice({ guild: interaction.guild, voiceChannel });
                } catch (err) {
                    const code = String(err?.message ?? '');
                    if (code === 'SEM_PERMISSAO_VOICE') {
                        await replyAndDelete(interaction, '❌ Sem permissão para conectar/falar nessa sala de voz.');
                        return;
                    }
                    if (code === 'SALA_CHEIA') {
                        await replyAndDelete(interaction, '❌ A sala de voz está cheia (limite de usuários).');
                        return;
                    }
                    if (code === 'VOICE_TIMEOUT') {
                        await replyAndDelete(interaction, getVoiceTimeoutHelp());
                        return;
                    }
                    logError('Falha ao entrar na sala de voz', err);
                    await replyAndDelete(interaction, '❌ Não consegui entrar na sala de voz.');
                    return;
                }

                let tracks = [];
                try {
                    tracks = await buildMixTracks({
                        styles,
                        total: quantidade,
                        requestedById: interaction.user.id,
                        guildName: interaction.guild.name
                    });
                } catch (err) {
                    logError('Falha ao montar mix', err);
                    await replyAndDelete(interaction, '❌ Erro ao buscar músicas no YouTube. Tente novamente.');
                    return;
                }

                if (!tracks.length) {
                    await replyAndDelete(interaction, '⚠️ Não achei resultados para montar a lista. Tente outros estilos.');
                    return;
                }

                const music = getMusicState(interaction.guild.id);
                music.queue.push(...tracks);

                if (music.player.state.status === AudioPlayerStatus.Idle && !music.current) {
                    await playNextInGuild(interaction.guild.id);
                }

                const label = styles.length ? styles.join(', ') : 'vários estilos';
                await replyAndDelete(interaction, `🎶 Mix adicionado na fila: ${tracks.length} música(s).\nEstilos: ${label}`);
                return;
            }

            if (interaction.commandName === 'lista') {
                const page = interaction.options.getInteger('pagina') ?? 1;
                const perPage = 20;
                const history = getGuildMusicHistory(interaction.guild.id);
                if (!history.length) {
                    await replyAndDelete(interaction, '📭 Ainda não foi tocado nenhum link do YouTube.');
                    return;
                }

                const totalPages = Math.max(1, Math.ceil(history.length / perPage));
                const safePage = Math.max(1, Math.min(totalPages, page));
                const start = (safePage - 1) * perPage;
                const items = history.slice(start, start + perPage);

                const lines = [];
                lines.push(`📃 Lista (YouTube) • Página ${safePage}/${totalPages} • Total: ${history.length}`);
                lines.push('━━━━━━━━━━━━━━━━━━━━');
                let counter = start + 1;
                for (const item of items) {
                    const title = normalizeTitleForList(item.title) || 'Sem título';
                    const line = `${counter++}. ${title}\n${item.url}`;
                    const preview = lines.concat([line]).join('\n');
                    if (preview.length > 1900) break;
                    lines.push(line);
                }

                await replyAndDelete(interaction, lines.join('\n'));
                return;
            }

            if (interaction.commandName === 'musicaplaylist') {
                const page = interaction.options.getInteger('pagina') ?? 1;
                const perPage = 25;
                const history = getGuildMusicHistory(interaction.guild.id);
                if (!history.length) {
                    await replyAndDelete(interaction, '📭 Ainda não foi tocado nenhum link do YouTube.');
                    return;
                }

                const totalPages = Math.max(1, Math.ceil(history.length / perPage));
                const safePage = Math.max(1, Math.min(totalPages, page));
                const start = (safePage - 1) * perPage;
                const items = history.slice(start, start + perPage);

                const options = items.map((item) => {
                    const title = normalizeTitleForList(item.title) || 'Sem título';
                    const label = title.length > 100 ? title.slice(0, 97) + '...' : title;
                    const when = item.playedAt ? formatDateTime(new Date(Number(item.playedAt))) : '';
                    const descRaw = when ? `Tocou em ${when}` : item.url;
                    const description = descRaw.length > 100 ? descRaw.slice(0, 97) + '...' : descRaw;
                    return { label, description, value: String(item.id) };
                });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`musicaplaylist:${interaction.guild.id}:${interaction.user.id}`)
                    .setPlaceholder('Escolha uma música para tocar de novo')
                    .addOptions(options);

                const row = new ActionRowBuilder().addComponents(menu);
                await interaction.editReply({
                    content: `🎧 Selecione uma música (Página ${safePage}/${totalPages})`,
                    components: [row]
                });
                scheduleDeleteReplyMs(interaction, 60000);
                return;
            }

            if (!canUseCommands(interaction.member)) {
                await replyAndDelete(interaction, '❌ Você não tem permissão para usar esses comandos');
                return;
            }

            const user = interaction.options.getUser('usuario', true);
            const target =
                interaction.options.getMember('usuario') ??
                (await interaction.guild.members.fetch(user.id));

            const log = interaction.guild.channels.cache.get(config.logChannel);
            const executorTag = interaction.user.tag;
            const targetTag = target.user.tag;
            const selectedRole = interaction.options.getRole('cargo', true);
            const roleLabel = getRoleLabel(interaction.guild, selectedRole.id);
            const roleName = `@${selectedRole.name}`;

            if (interaction.commandName === 'adicionarcargo') {
                await target.roles.add(selectedRole);
                const dmSent = await trySendDM(
                    target.user,
                    formatDM({
                        title: '✅ Cargo Adicionado',
                        guildName: interaction.guild.name,
                        details: [`👤 Você: <@${user.id}>`, `➕ Cargo: ${roleName}`],
                        executorTag
                    })
                );

                await sendLog(
                    log,
                    createLogEmbed({
                        title: '➕ Cargo Adicionado',
                        color: 0x22c55e,
                        guild: interaction.guild,
                        executorId: interaction.user.id,
                        executorTag,
                        targetId: user.id,
                        targetTag,
                        fields: [
                            { name: 'Cargo', value: roleLabel, inline: false },
                            { name: 'DM', value: dmSent ? '✅ Enviado' : '⚠️ Falhou', inline: true }
                        ]
                    })
                );

                logInfo(`Adicionar cargo | Executor: ${executorTag} | Usuario: ${targetTag} | Cargo: ${selectedRole.name} (${selectedRole.id}) | DM: ${dmSent ? 'ok' : 'falhou'}`);
                await replyAndDelete(interaction, `➕ Cargo adicionado.\nUsuario: <@${user.id}>\nCargo: ${roleLabel}\nDM: ${dmSent ? 'Enviado' : 'Falhou'}`);
                return;
            }

            if (interaction.commandName === 'removercargo') {
                if (!target.roles.cache.has(selectedRole.id)) {
                    await replyAndDelete(interaction, `⚠️ O usuário não possui o cargo ${roleLabel}`);
                    return;
                }

                await target.roles.remove(selectedRole);
                const dmSent = await trySendDM(
                    target.user,
                    formatDM({
                        title: '🗑️ Cargo Removido',
                        guildName: interaction.guild.name,
                        details: [`👤 Você: <@${user.id}>`, `➖ Cargo: ${roleName}`],
                        executorTag
                    })
                );

                await sendLog(
                    log,
                    createLogEmbed({
                        title: '➖ Cargo Removido',
                        color: 0xef4444,
                        guild: interaction.guild,
                        executorId: interaction.user.id,
                        executorTag,
                        targetId: user.id,
                        targetTag,
                        fields: [
                            { name: 'Cargo', value: roleLabel, inline: false },
                            { name: 'DM', value: dmSent ? '✅ Enviado' : '⚠️ Falhou', inline: true }
                        ]
                    })
                );

                logInfo(`Remover cargo | Executor: ${executorTag} | Usuario: ${targetTag} | Cargo: ${selectedRole.name} (${selectedRole.id}) | DM: ${dmSent ? 'ok' : 'falhou'}`);
                await replyAndDelete(interaction, `➖ Cargo removido.\nUsuario: <@${user.id}>\nCargo: ${roleLabel}\nDM: ${dmSent ? 'Enviado' : 'Falhou'}`);
                return;
            }

            if (interaction.commandName === 'setarcargo') {
                const roleToRemove = interaction.options.getRole('remover');
                const removeLabel = roleToRemove ? getRoleLabel(interaction.guild, roleToRemove.id) : null;
                const removeName = roleToRemove ? `@${roleToRemove.name}` : null;

                if (roleToRemove && target.roles.cache.has(roleToRemove.id)) {
                    await target.roles.remove(roleToRemove);
                }

                await target.roles.add(selectedRole);
                const dmSent = await trySendDM(
                    target.user,
                    formatDM({
                        title: '🧩 Cargos Atualizados',
                        guildName: interaction.guild.name,
                        details: [
                            `👤 Você: <@${user.id}>`,
                            ...(removeName ? [`➖ Removido: ${removeName}`] : []),
                            `➕ Adicionado: ${roleName}`
                        ],
                        executorTag
                    })
                );

                await sendLog(
                    log,
                    createLogEmbed({
                        title: '🧩 Cargos Atualizados',
                        color: 0x3b82f6,
                        guild: interaction.guild,
                        executorId: interaction.user.id,
                        executorTag,
                        targetId: user.id,
                        targetTag,
                        fields: [
                            ...(removeLabel ? [{ name: 'Removido', value: removeLabel, inline: false }] : []),
                            { name: 'Adicionado', value: roleLabel, inline: false },
                            { name: 'DM', value: dmSent ? '✅ Enviado' : '⚠️ Falhou', inline: true }
                        ]
                    })
                );

                logInfo(`Setar cargo | Executor: ${executorTag} | Usuario: ${targetTag} | Remover: ${roleToRemove ? `${roleToRemove.name} (${roleToRemove.id})` : '-'} | Adicionar: ${selectedRole.name} (${selectedRole.id}) | DM: ${dmSent ? 'ok' : 'falhou'}`);
                await replyAndDelete(interaction, `🧩 Cargo setado.\nUsuario: <@${user.id}>\n${removeLabel ? `Removido: ${removeLabel}\n` : ''}Adicionado: ${roleLabel}\nDM: ${dmSent ? 'Enviado' : 'Falhou'}`);
                return;
            }
        } catch (err) {
            logError(`Erro no comando: ${interaction.commandName}`, err);

            const isMissingPermissions =
                (typeof err?.code === 'number' && err.code === 50013) ||
                (typeof err?.status === 'number' && err.status === 403) ||
                (typeof err?.rawError?.code === 'number' && err.rawError.code === 50013);

            const message = isMissingPermissions
                ? '❌ Sem permissão para gerenciar esse cargo. Dê ao bot "Gerenciar Cargos" e coloque o cargo do bot acima do cargo que você está tentando adicionar/remover.'
                : '❌ Erro ao executar o comando. Veja o console do bot.';

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(message);
                    scheduleDeleteReply(interaction);
                } else {
                    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
                    scheduleDeleteReply(interaction);
                }
            } catch (replyErr) {
                logError('Falha ao responder a interação', replyErr);
            }
            return;
        }
    }

    if (interaction.isStringSelectMenu()) {
        const id = interaction.customId;
        if (id === 'adminpanel_menu') {
            const picked = String(interaction.values?.[0] ?? '');
            if (!picked || !picked.startsWith(ADMIN_PANEL_CUSTOM_PREFIX)) {
                await interaction.reply({ content: '⚠️ Opção inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            if (interaction.channelId !== getAdminPanelChannelId()) {
                await interaction.reply({ content: `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            if (!canUseCommands(interaction.member)) {
                await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            await runAdminPanelAction(interaction, picked);
            return;
        }

        if (id.startsWith('ap_cat:')) {
            const parts = id.split(':');
            const action = parts[1] ?? '';
            const ownerUserId = parts[2] ?? '';
            const page = Number(parts[3] ?? 0);
            const maxValues = Number(parts[4] ?? 1);
            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({ content: '❌ Só quem iniciou a ação pode selecionar.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            if (interaction.channelId !== getAdminPanelChannelId()) {
                await interaction.reply({ content: `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            if (!canUseCommands(interaction.member)) {
                await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            const value = String(interaction.values?.[0] ?? '');
            const scope = value === 'all' ? 'all' : value.startsWith('cat:') ? value.slice(4) : 'all';
            const components = await buildAdminPickerChannelComponents({
                guild: interaction.guild,
                action,
                ownerId: ownerUserId,
                scope,
                page: 0,
                maxValues
            });
            await interaction.update({ content: 'Selecione o(s) canal(is).', components }).catch(() => {});
            return;
        }

        if (id.startsWith('ap_ch:')) {
            const parts = id.split(':');
            const action = parts[1] ?? '';
            const ownerUserId = parts[2] ?? '';
            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({ content: '❌ Só quem iniciou a ação pode selecionar.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            const selected = Array.isArray(interaction.values) ? interaction.values : [];
            const cleaned = selected.filter((v) => /^\d{17,20}$/.test(String(v)));
            if (!cleaned.length) {
                await interaction.update({ content: '❌ Canal inválido.', components: [] }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            await handleAdminPanelChannelTargetsFromIds(interaction, action, cleaned);
            return;
        }

        if (id === 'musicpanel_category') {
            const categoryKey = String(interaction.values?.[0] ?? '');
            const list = MUSIC_PANEL_LIBRARY[categoryKey] ?? null;
            if (!Array.isArray(list) || list.length === 0) {
                await interaction.reply({ content: '⚠️ Categoria vazia.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const options = list.slice(0, 25).map((item, idx) => {
                const label = normalizeTitleForList(item.label);
                return {
                    label: label.length > 100 ? label.slice(0, 97) + '...' : label,
                    value: String(idx)
                };
            });

            const menu = new StringSelectMenuBuilder()
                .setCustomId(`musicpanel_track:${categoryKey}:${interaction.guild.id}:${interaction.user.id}`)
                .setPlaceholder('Escolha uma música')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(menu);
            await interaction.reply({ content: '🎶 Escolha uma música para tocar:', components: [row], flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, 60000);
            return;
        }

        if (id.startsWith('musicpanel_track:')) {
            const parts = id.split(':');
            const categoryKey = parts[1] ?? '';
            const guildId = parts[2] ?? '';
            const ownerUserId = parts[3] ?? '';

            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({ content: '❌ Só quem abriu o menu pode selecionar.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            if (interaction.guild?.id !== guildId) {
                await interaction.update({ content: '⚠️ Menu inválido.', components: [] }).catch(() => {});
                return;
            }

            const idx = Number(interaction.values?.[0] ?? -1);
            const list = MUSIC_PANEL_LIBRARY[categoryKey] ?? [];
            const item = Number.isInteger(idx) && idx >= 0 && idx < list.length ? list[idx] : null;
            if (!item) {
                await interaction.update({ content: '⚠️ Não achei essa música.', components: [] }).catch(() => {});
                return;
            }

            await interaction.update({ content: '⏳ Buscando no YouTube e adicionando na fila...', components: [] }).catch(() => {});
            if (!(await ensureCanPlayNow(interaction))) return;

            const voiceChannel = interaction.member?.voice?.channel ?? null;
            if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
                await interaction.editReply('❌ Entre em uma sala de voz primeiro.').catch(() => {});
                return;
            }

            const found = await youtubeSearchFirstUrl(item.query);
            if (!found) {
                await interaction.editReply('⚠️ Não consegui buscar no YouTube agora. Tente novamente ou use um link direto do vídeo.').catch(() => {});
                return;
            }

            const track = {
                url: found.url,
                title: found.title,
                requestedById: interaction.user.id,
                source: 'YouTube',
                guildName: interaction.guild.name
            };

            const ctrl = musicManager.get(interaction.guild.id);
            ctrl.setTextChannel(interaction.channelId);
            await ctrl.ensureConnection(voiceChannel);
            ctrl.queue.push({ url: track.url, title: track.title, requestedById: track.requestedById });
            await ctrl.playNext();

            await interaction.editReply(`✅ Adicionado na fila: ${normalizeTitleForList(track.title)}`).catch(() => {});
            return;
        }

        if (!id.startsWith('musicaplaylist:')) return;

        const parts = id.split(':');
        const guildId = parts[1] ?? '';
        const ownerUserId = parts[2] ?? '';
        if (!guildId || !ownerUserId) return;

        if (interaction.user.id !== ownerUserId) {
            await interaction.reply({ content: '❌ Só quem abriu o menu pode selecionar.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        const selectedId = String(interaction.values?.[0] ?? '');
        const history = getGuildMusicHistory(guildId);
        const entry = history.find((e) => String(e.id) === selectedId) ?? null;
        if (!entry) {
            await interaction.update({ content: '⚠️ Não achei esse item na lista.', components: [] }).catch(() => {});
            return;
        }

        await interaction.update({ content: '⏳ Adicionando na fila...', components: [] }).catch(() => {});
        if (!(await ensureCanPlayNow(interaction))) return;

        const voiceChannel = interaction.member?.voice?.channel ?? null;
        if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
            await interaction.editReply('❌ Entre em uma sala de voz primeiro.').catch(() => {});
            return;
        }

        const track = {
            url: entry.url,
            title: entry.title || 'Sem título',
            requestedById: interaction.user.id,
            source: 'YouTube',
            guildName: interaction.guild.name
        };

        const ctrl = musicManager.get(interaction.guild.id);
        ctrl.setTextChannel(interaction.channelId);
        await ctrl.ensureConnection(voiceChannel);
        ctrl.queue.push({ url: track.url, title: track.title, requestedById: track.requestedById });
        await ctrl.playNext();

        await interaction.editReply(`✅ Adicionado na fila: ${normalizeTitleForList(track.title)}`).catch(() => {});
        return;
    }

    if (interaction.isChannelSelectMenu()) {
        const id = interaction.customId;
        if (!id.startsWith('adminpanel_channel:')) return;

        const parts = id.split(':');
        const action = parts[1] ?? '';
        const ownerUserId = parts[2] ?? '';

        if (interaction.channelId !== getAdminPanelChannelId()) {
            await interaction.reply({ content: `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`, flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (interaction.user.id !== ownerUserId) {
            await interaction.reply({ content: '❌ Só quem iniciou a ação pode selecionar.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }
        const selectedIds = Array.isArray(interaction.values) ? interaction.values : [];
        await handleAdminPanelChannelTargetsFromIds(interaction, action, selectedIds);
        return;
    }

    if (interaction.isRoleSelectMenu()) {
        const id = interaction.customId;
        if (!id.startsWith('setagem_role:')) return;

        try {
            if (!canUseCommands(interaction.member)) {
                await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const parts = id.split(':');
            const requestId = parts[1] ?? '';
            const ownerUserId = parts[2] ?? '';

            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({ content: '❌ Só quem iniciou a aprovação pode selecionar o cargo.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }

            const req = requestId ? setagemRequestsById.get(requestId) : null;
            if (!req || req.status !== 'pending') {
                await interaction.update({ content: '⚠️ Pedido inválido ou já finalizado.', components: [] }).catch(() => {});
                return;
            }

            const roleId = String(interaction.values?.[0] ?? '').trim();
            if (!/^\d{17,20}$/.test(roleId)) {
                await interaction.update({ content: '❌ Cargo inválido.', components: [] }).catch(() => {});
                return;
            }

            await interaction.update({ content: '⏳ Aprovando e aplicando cargo...', components: [] }).catch(() => {});

            const guild = interaction.guild;
            const member = await guild.members.fetch(req.requesterId).catch(() => null);
            if (!member) {
                await interaction.editReply('❌ Não achei o usuário no servidor.').catch(() => {});
                return;
            }

            const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
            if (!role) {
                await interaction.editReply('❌ Não achei esse cargo no servidor.').catch(() => {});
                return;
            }

            const memberRoleId = String(config.cargoMembroId ?? '').trim();
            const extraRoleId = /^\d{17,20}$/.test(memberRoleId) ? memberRoleId : null;
            const extraRole = extraRoleId ? guild.roles.cache.get(extraRoleId) ?? (await guild.roles.fetch(extraRoleId).catch(() => null)) : null;
            const removeRoleId = String(VERIFIED_EXTRA_ROLE_ID ?? '').trim();
            const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
            if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
                await interaction.editReply('❌ Sem permissão para atribuir/remover cargos. Dê ao bot a permissão "Gerenciar Cargos".').catch(() => {});
                return;
            }

            if (role.position >= me.roles.highest.position) {
                await interaction.editReply('❌ Não consigo gerenciar o cargo selecionado. Coloque o cargo do bot acima desse cargo na hierarquia.').catch(() => {});
                return;
            }
            if (extraRole && extraRole.position >= me.roles.highest.position) {
                await interaction.editReply('❌ Não consigo gerenciar o cargo de membro. Coloque o cargo do bot acima desse cargo na hierarquia.').catch(() => {});
                return;
            }

            if (/^\d{17,20}$/.test(removeRoleId)) {
                const removeRole =
                    guild.roles.cache.get(removeRoleId) ?? (await guild.roles.fetch(removeRoleId).catch(() => null));
                if (removeRole && removeRole.position >= me.roles.highest.position) {
                    await interaction
                        .editReply(`❌ Não consigo remover o cargo <@&${removeRoleId}>. Coloque o cargo do bot acima dele na hierarquia.`)
                        .catch(() => {});
                    return;
                }
            }

            if (!member.roles.cache.has(roleId)) {
                await member.roles.add(roleId, 'Setagem aprovada').catch((err) => logError(`Falha ao adicionar cargo setagem ${roleId}`, err));
            }
            if (extraRoleId && extraRole && !member.roles.cache.has(extraRoleId)) {
                await member.roles.add(extraRoleId, 'Setagem aprovada (cargo membro)').catch((err) => logError(`Falha ao adicionar cargo membro ${extraRoleId}`, err));
            }
            if (/^\d{17,20}$/.test(removeRoleId) && member.roles.cache.has(removeRoleId)) {
                await member.roles.remove(removeRoleId, 'Setagem aprovada (remover cargo pós-verificação)').catch((err) => logError(`Falha ao remover cargo ${removeRoleId}`, err));
            }

            req.status = 'approved';
            req.decidedById = interaction.user.id;
            req.decidedAtMs = Date.now();
            req.decidedRoleId = roleId;

            const embed = createSetagemApprovalEmbed({
                guild,
                req,
                status: 'approved',
                decidedByTag: interaction.user.tag,
                decidedRoleId: roleId
            });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`setagem_aprovar:${req.id}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId(`setagem_reprovar:${req.id}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            const approvalChannel = await client.channels.fetch(req.approvalChannelId).catch(() => null);
            if (approvalChannel && approvalChannel.isTextBased?.()) {
                const msg = await approvalChannel.messages.fetch(req.approvalMessageId).catch(() => null);
                if (msg) await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
            }

            const setagem = getSetagemConfig();
            if (setagem.listChannelId) {
                const listChannel = await client.channels.fetch(setagem.listChannelId).catch(() => null);
                if (listChannel && listChannel.isTextBased?.()) {
                    const listEmbed = new EmbedBuilder()
                        .setTitle('✅ Setagem Aprovada')
                        .setColor(0x22c55e)
                        .setDescription(`<@${req.requesterId}> • ${req.requesterTag}`)
                        .addFields(
                            { name: 'ID no RP', value: req.rpId, inline: true },
                            { name: 'Nome no RP', value: req.rpNome, inline: true },
                            { name: 'Celular no RP', value: req.rpCel, inline: true },
                            { name: 'Recrutador', value: req.recrutador, inline: false },
                            { name: 'Cargo', value: `<@&${roleId}>`, inline: false },
                            { name: 'Aprovado por', value: interaction.user.tag, inline: false }
                        );
                    applyGuildBranding(listEmbed, guild);
                    if (req.avatarUrl) listEmbed.setThumbnail(req.avatarUrl);
                    await listChannel.send({ embeds: [listEmbed] }).catch(() => {});
                }
            }

            if (setagem.logChannelId) {
                const logChannel = await client.channels.fetch(setagem.logChannelId).catch(() => null);
                if (logChannel && logChannel.isTextBased?.()) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('✅ Setagem Aprovada')
                        .setColor(0x22c55e)
                        .setDescription(`<@${req.requesterId}> • ${req.requesterTag}`)
                        .addFields({ name: 'Cargo', value: `<@&${roleId}>`, inline: false }, { name: 'Aprovado por', value: interaction.user.tag, inline: false });
                    applyGuildBranding(logEmbed, guild);
                    if (req.avatarUrl) logEmbed.setThumbnail(req.avatarUrl);
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }

            const okMsg = await interaction
                .followUp({ content: `✅ Aprovado. Cargo aplicado: <@&${roleId}>`, flags: MessageFlags.Ephemeral, fetchReply: true })
                .catch(() => null);
            if (okMsg?.id) scheduleDeleteWebhookMessage(interaction, okMsg.id, AUTO_DELETE_MS);
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        } catch (err) {
            logError('Erro ao aprovar setagem (role select)', err);
            const errMsg = await interaction
                .followUp({
                    content: '❌ Erro ao aprovar/aplicar cargo. Verifique permissões do bot e hierarquia de cargos.',
                    flags: MessageFlags.Ephemeral,
                    fetchReply: true
                })
                .catch(() => null);
            if (errMsg?.id) scheduleDeleteWebhookMessage(interaction, errMsg.id, AUTO_DELETE_MS);
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        }
        return;
    }

    if (!interaction.isButton()) return;

    const id = interaction.customId;

    if (id.startsWith('apnav:')) {
        const parts = id.split(':');
        const kind = parts[1] ?? '';
        if (kind === 'back') {
            const action = parts[2] ?? '';
            const ownerUserId = parts[3] ?? '';
            const maxValues = Number(parts[4] ?? 1);
            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({ content: '❌ Só quem iniciou a ação pode navegar.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            if (!canUseCommands(interaction.member)) {
                await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            const components = await buildAdminPickerCategoryComponents({
                guild: interaction.guild,
                action,
                ownerId: ownerUserId,
                page: 0,
                maxValues
            });
            await interaction.update({ content: 'Selecione a categoria (ou Todos) para escolher canais.', components }).catch(() => {});
            return;
        }

        if (kind === 'cat') {
            const action = parts[2] ?? '';
            const ownerUserId = parts[3] ?? '';
            const page = Number(parts[4] ?? 0);
            const maxValues = Number(parts[5] ?? 1);
            const dir = parts[6] ?? '';
            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({ content: '❌ Só quem iniciou a ação pode navegar.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            if (!canUseCommands(interaction.member)) {
                await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            const nextPage = dir === 'next' ? page + 1 : Math.max(0, page - 1);
            const components = await buildAdminPickerCategoryComponents({
                guild: interaction.guild,
                action,
                ownerId: ownerUserId,
                page: nextPage,
                maxValues
            });
            await interaction.update({ content: 'Selecione a categoria (ou Todos) para escolher canais.', components }).catch(() => {});
            return;
        }

        if (kind === 'chan') {
            const action = parts[2] ?? '';
            const ownerUserId = parts[3] ?? '';
            const scope = parts[4] ?? 'all';
            const page = Number(parts[5] ?? 0);
            const maxValues = Number(parts[6] ?? 1);
            const dir = parts[7] ?? '';
            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({ content: '❌ Só quem iniciou a ação pode navegar.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            if (!canUseCommands(interaction.member)) {
                await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
                return;
            }
            const nextPage = dir === 'next' ? page + 1 : Math.max(0, page - 1);
            const components = await buildAdminPickerChannelComponents({
                guild: interaction.guild,
                action,
                ownerId: ownerUserId,
                scope,
                page: nextPage,
                maxValues
            });
            await interaction.update({ content: 'Selecione o(s) canal(is).', components }).catch(() => {});
            return;
        }
    }

    if (id.startsWith(ADMIN_PANEL_CUSTOM_PREFIX)) {
        if (interaction.channelId !== getAdminPanelChannelId()) {
            await interaction.reply({ content: `❌ Use apenas no canal <#${getAdminPanelChannelId()}>.`, flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }
        if (!canUseCommands(interaction.member)) {
            await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }
        await runAdminPanelAction(interaction, id);
        return;
    }

    if (id.startsWith(MUSIC_PANEL_CUSTOM_PREFIX)) {
      if (id === 'musicpanel_addlink') {
    try {
        if (interaction.replied || interaction.deferred) return;

        const modal = new ModalBuilder()
            .setCustomId('musicpanel_addlink_modal')
            .setTitle('Adicionar link de música');

        const input = new TextInputBuilder()
            .setCustomId('musicpanel_link')
            .setLabel('Link do YouTube ou nome da música')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(2000);

        modal.addComponents(new ActionRowBuilder().addComponents(input));

        await interaction.showModal(modal);
    } catch (err) {
        const code = Number(err?.code ?? err?.rawError?.code ?? 0);

        if (code === 10062 || code === 40060) {
            console.log('Interação do botão musicpanel_addlink expirou ou já foi respondida.');
            return;
        }

        logError('Falha ao abrir modal musicpanel_addlink', err);
    }

    return;
}

        if (id === 'musicpanel_mix') {
            try {
                try {
    if (interaction.replied || interaction.deferred) return;

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });
} catch (err) {
    const code = Number(err?.code ?? err?.rawError?.code ?? 0);

    if (code === 10062 || code === 40060) {
        console.log('Modal musicpanel_addlink_modal expirou ou já foi respondido.');
        return;
    }

    throw err;
}
                if (!(await ensureCanPlayNow(interaction))) return;
                const voiceChannel = interaction.member?.voice?.channel ?? null;
                if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
                    await replyAndDelete(interaction, '❌ Entre em uma sala de voz primeiro.');
                    return;
                }

                const tracks = await buildMixTracks({
                    styles: [],
                    total: 30,
                    requestedById: interaction.user.id,
                    guildName: interaction.guild.name
                });

                const ctrl = musicManager.get(interaction.guild.id);
                ctrl.setTextChannel(interaction.channelId);
                await ctrl.ensureConnection(voiceChannel);
                ctrl.queue.push(...tracks.map((t) => ({ url: t.url, title: t.title, requestedById: t.requestedById })));
                await ctrl.playNext();
                await replyAndDelete(interaction, `🎶 Mix adicionado na fila: ${tracks.length} música(s).`);
            } catch (err) {
                const isTimeout = typeof err?.message === 'string' && err.message.startsWith('Timeout:');
                if (isTimeout) {
                    await interaction.editReply('⏳ O YouTube demorou para responder. Tente novamente.').catch(() => {});
                    scheduleDeleteReply(interaction);
                    return;
                }
                logError('Erro no musicpanel_mix', err);
                await interaction.editReply('❌ Erro ao montar mix. Tente novamente.').catch(() => {});
                scheduleDeleteReply(interaction);
            }
            return;
        }

        if (id === 'musicpanel_nowplaying') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const ctrl = musicManager.get(interaction.guild.id);
            if (!ctrl.current) {
                await replyAndDelete(interaction, '📭 Nada tocando agora.');
                return;
            }
            await replyAndDelete(interaction, `🎶 Tocando agora: ${ctrl.current.title}\n${ctrl.current.url}`);
            return;
        }

        if (id === 'musicpanel_queue') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const ctrl = musicManager.get(interaction.guild.id);
            if (!ctrl.current && ctrl.queue.length === 0) {
                await replyAndDelete(interaction, '📭 Fila vazia.');
                return;
            }

            const lines = [];
            if (ctrl.current) lines.push(`🎶 Tocando agora: ${ctrl.current.title}`);
            const upcoming = (ctrl.queue ?? []).slice(0, 10);
            if (upcoming.length) {
                lines.push('🗒️ Próximas:');
                for (let i = 0; i < upcoming.length; i++) lines.push(`${i + 1}. ${upcoming[i].title}`);
            }
            if ((ctrl.queue?.length ?? 0) > 10) lines.push(`… e mais ${ctrl.queue.length - 10} na fila`);
            await replyAndDelete(interaction, lines.join('\n'));
            return;
        }

        if (id === 'musicpanel_lista') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const perPage = 20;
            const history = getGuildMusicHistory(interaction.guild.id);
            if (!history.length) {
                await replyAndDelete(interaction, '📭 Ainda não foi tocado nenhum link do YouTube.');
                return;
            }

            const totalPages = Math.max(1, Math.ceil(history.length / perPage));
            const safePage = 1;
            const start = (safePage - 1) * perPage;
            const items = history.slice(start, start + perPage);

            const lines = [];
            lines.push(`📃 Lista (YouTube) • Página ${safePage}/${totalPages} • Total: ${history.length}`);
            lines.push('━━━━━━━━━━━━━━━━━━━━');
            let counter = start + 1;
            for (const item of items) {
                const title = normalizeTitleForList(item.title) || 'Sem título';
                const line = `${counter++}. ${title}\n${item.url}`;
                const preview = lines.concat([line]).join('\n');
                if (preview.length > 1900) break;
                lines.push(line);
            }

            await replyAndDelete(interaction, lines.join('\n'));
            return;
        }

        if (id === 'musicpanel_history') {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const perPage = 25;
                const history = getGuildMusicHistory(interaction.guild.id);
                if (!history.length) {
                    await replyAndDelete(interaction, '📭 Ainda não foi tocado nenhum link do YouTube.');
                    return;
                }

                const safePage = 1;
                const start = (safePage - 1) * perPage;
                const items = history.slice(start, start + perPage);
                const options = items.map((item) => {
                    const title = normalizeTitleForList(item.title) || 'Sem título';
                    const label = title.length > 100 ? title.slice(0, 97) + '...' : title;
                    const when = item.playedAt ? formatDateTime(new Date(Number(item.playedAt))) : '';
                    const descRaw = when ? `Tocou em ${when}` : item.url;
                    const description = descRaw.length > 100 ? descRaw.slice(0, 97) + '...' : descRaw;
                    return { label, description, value: String(item.id) };
                });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`musicaplaylist:${interaction.guild.id}:${interaction.user.id}`)
                    .setPlaceholder('Escolha uma música para tocar de novo')
                    .addOptions(options);

                const row = new ActionRowBuilder().addComponents(menu);
                await interaction.editReply({ content: `🎧 Selecione uma música (Página 1)`, components: [row] });
                scheduleDeleteReplyMs(interaction, 60000);
            } catch (err) {
                logError('Erro no musicpanel_history', err);
                await interaction.editReply('❌ Erro ao abrir playlist.').catch(() => {});
                scheduleDeleteReply(interaction);
            }
            return;
        }

        if (id === 'musicpanel_shuffle') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const ctrl = musicManager.get(interaction.guild.id);
            if (ctrl.queue.length < 2) {
                await replyAndDelete(interaction, '⚠️ Fila pequena demais para shuffle.');
                return;
            }
            ctrl.shuffleQueue();
            await replyAndDelete(interaction, '🔀 Fila embaralhada.');
            return;
        }

        if (id === 'musicpanel_loop') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const ctrl = musicManager.get(interaction.guild.id);
            const next =
                ctrl.loopMode === LOOP.OFF ? LOOP.TRACK : ctrl.loopMode === LOOP.TRACK ? LOOP.QUEUE : LOOP.OFF;
            ctrl.setLoopMode(next);
            await replyAndDelete(interaction, `🔁 Loop: ${ctrl.loopMode}`);
            return;
        }

        if (id === 'musicpanel_volume') {
            const modal = new ModalBuilder().setCustomId('musicpanel_volume_modal').setTitle('Volume');
            const input = new TextInputBuilder()
                .setCustomId('musicpanel_volume_value')
                .setLabel('Volume (0 a 200)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(3);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal).catch(async (err) => {
                logError('Falha ao abrir modal musicpanel_volume', err);
                await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            });
            return;
        }

        if (id === 'musicpanel_pause' || id === 'musicpanel_resume' || id === 'musicpanel_skip' || id === 'musicpanel_stop') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const ctrl = musicManager.get(interaction.guild.id);
            if (!ctrl.current && id !== 'musicpanel_stop') {
                await replyAndDelete(interaction, '⚠️ Não tem música tocando.');
                return;
            }

            if (id === 'musicpanel_pause') {
                const ok = ctrl.pause();
                await replyAndDelete(interaction, ok ? '⏸️ Pausado.' : '⚠️ Não consegui pausar.');
                return;
            }
            if (id === 'musicpanel_resume') {
                const ok = ctrl.resume();
                await replyAndDelete(interaction, ok ? '▶️ Retomado.' : '⚠️ Não consegui retomar.');
                return;
            }
            if (id === 'musicpanel_skip') {
                ctrl.skip();
                await replyAndDelete(interaction, '⏭️ Pulando...');
                return;
            }
            if (id === 'musicpanel_stop') {
                musicManager.destroy(interaction.guild.id);
                await replyAndDelete(interaction, '⏹️ Música parada e fila limpa.');
                return;
            }
        }

        return;
    }

    if (id === 'setagem_pedir') {
        const modal = new ModalBuilder().setCustomId('setagem_pedir_modal').setTitle('Pedir Setagem');
        const inputRpId = new TextInputBuilder()
            .setCustomId('setagem_rp_id')
            .setLabel('ID no RP')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(40);
        const inputRpNome = new TextInputBuilder()
            .setCustomId('setagem_rp_nome')
            .setLabel('Nome no RP')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);
        const inputRpCel = new TextInputBuilder()
            .setCustomId('setagem_rp_cel')
            .setLabel('Celular no RP')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(40);
        const inputRecrutador = new TextInputBuilder()
            .setCustomId('setagem_recrutador')
            .setLabel('Nome do Recrutador')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);
        modal.addComponents(
            new ActionRowBuilder().addComponents(inputRpId),
            new ActionRowBuilder().addComponents(inputRpNome),
            new ActionRowBuilder().addComponents(inputRpCel),
            new ActionRowBuilder().addComponents(inputRecrutador)
        );
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
        });
        return;
    }

    if (id.startsWith('setagem_aprovar:') || id.startsWith('setagem_reprovar:')) {
        if (!canUseCommands(interaction.member)) {
            await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        const [action, requestId] = id.split(':');
        const req = requestId ? setagemRequestsById.get(requestId) : null;
        if (!req || req.status !== 'pending') {
            await interaction.reply({ content: '⚠️ Pedido inválido ou já finalizado.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }

        if (action === 'setagem_reprovar') {
            req.status = 'rejected';
            req.decidedById = interaction.user.id;
            req.decidedAtMs = Date.now();

            const embed = createSetagemApprovalEmbed({
                guild: interaction.guild,
                req,
                status: 'rejected',
                decidedByTag: interaction.user.tag,
                decidedRoleId: null
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`setagem_aprovar:${req.id}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId(`setagem_reprovar:${req.id}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            await interaction.update({ embeds: [embed], components: [row] }).catch(async () => {
                await interaction.reply({ content: '✅ Reprovado.', flags: MessageFlags.Ephemeral }).catch(() => {});
                scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            });

            const setagem = getSetagemConfig();
            if (setagem.logChannelId) {
                const logChannel = await client.channels.fetch(setagem.logChannelId).catch(() => null);
                if (logChannel && logChannel.isTextBased?.()) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('❌ Setagem Reprovada')
                        .setColor(0xef4444)
                        .setDescription(`<@${req.requesterId}> • ${req.requesterTag}`)
                        .addFields({ name: 'Reprovado por', value: interaction.user.tag, inline: false });
                    applyGuildBranding(logEmbed, interaction.guild);
                    if (req.avatarUrl) logEmbed.setThumbnail(req.avatarUrl);
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }
            return;
        }

        const menu = new RoleSelectMenuBuilder()
            .setCustomId(`setagem_role:${req.id}:${interaction.user.id}`)
            .setPlaceholder('Selecione o cargo para dar ao usuário')
            .setMinValues(1)
            .setMaxValues(1);
        const row = new ActionRowBuilder().addComponents(menu);
        await interaction.reply({ content: `Selecione o cargo para aprovar <@${req.requesterId}>.`, components: [row], flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleDeleteReplyMs(interaction, 60000);
        return;
    }

    if (id === 'verificar_idade') {
        const modal = new ModalBuilder().setCustomId('verificar_idade_modal').setTitle('Verificação de Idade (18+)');
        const inputFullName = new TextInputBuilder()
            .setCustomId('age_full_name')
            .setLabel('Nome completo')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);
        const inputBirthDate = new TextInputBuilder()
            .setCustomId('age_birth_date')
            .setLabel('Data de nascimento (DD/MM/AAAA)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10)
            .setPlaceholder('Ex: 31/12/2000');
        modal.addComponents(
            new ActionRowBuilder().addComponents(inputFullName),
            new ActionRowBuilder().addComponents(inputBirthDate)
        );
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: '❌ Não consegui abrir o formulário. Tente novamente.', flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AGE_VERIFY_DELETE_MS);
        });
        return;
    }

    if (id === 'verificar_idade_cancelar') {
        pendingAgeVerifyByUserId.delete(interaction.user.id);
        await interaction.reply({ content: '✅ Cancelado.', flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleDeleteReplyMs(interaction, AGE_VERIFY_DELETE_MS);
        return;
    }

    if (id === 'verificar_idade_confirmar') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const pending = pendingAgeVerifyByUserId.get(interaction.user.id) ?? null;
            pendingAgeVerifyByUserId.delete(interaction.user.id);
            if (!pending) {
                await replyAndDeleteMs(interaction, '⚠️ Sua confirmação expirou. Clique em "Confirmo minha idade" e preencha o formulário novamente.', AGE_VERIFY_DELETE_MS);
                return;
            }
            if (Date.now() - pending.createdAt > AGE_VERIFY_PREVIEW_DELETE_MS) {
                await replyAndDeleteMs(interaction, '⚠️ Sua confirmação expirou. Clique em "Confirmo minha idade" e preencha o formulário novamente.', AGE_VERIFY_DELETE_MS);
                return;
            }

            const birthDate = new Date(`${pending.birthDateIso}T00:00:00.000Z`);
            if (Number.isNaN(birthDate.getTime())) {
                await replyAndDeleteMs(interaction, '❌ Erro ao validar a data de nascimento. Preencha o formulário novamente.', AGE_VERIFY_DELETE_MS);
                return;
            }

            const age = Number(pending.age);
            if (!Number.isFinite(age) || age < 18) {
                await replyAndDeleteMs(interaction, '❌ Você precisa ter 18 anos ou mais para ser verificado.', AGE_VERIFY_DELETE_MS);
                await trySendDM(
                    interaction.user,
                    `❌ NÃO LIBERADO\n\nSua verificação de idade não foi aprovada. Você precisa ter 18 anos ou mais para acessar os canais principais.`
                );
                return;
            }

            const verifiedRoleId = String(config.cargoVerificadoId ?? '').trim();
            const extraRoleId = String(VERIFIED_EXTRA_ROLE_ID ?? '').trim();

            if (!/^\d{17,20}$/.test(verifiedRoleId)) {
                await replyAndDeleteMs(interaction, '❌ Cargo de verificado não configurado (cargoVerificadoId) no config.json', AGE_VERIFY_DELETE_MS);
                return;
            }

            const [verifiedRole, extraRole] = await Promise.all([
                interaction.guild.roles.fetch(verifiedRoleId).catch(() => null),
                /^\d{17,20}$/.test(extraRoleId) ? interaction.guild.roles.fetch(extraRoleId).catch(() => null) : Promise.resolve(null)
            ]);

            if (!verifiedRole) {
                await replyAndDeleteMs(interaction, '❌ Cargo de “Verificado” não encontrado. Verifique o ID configurado (cargoVerificadoId).', AGE_VERIFY_DELETE_MS);
                return;
            }
            if (/^\d{17,20}$/.test(extraRoleId) && !extraRole) {
                await replyAndDeleteMs(interaction, `❌ Cargo extra não encontrado: ${extraRoleId}`, AGE_VERIFY_DELETE_MS);
                return;
            }
            const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
            if (!me) {
                await replyAndDeleteMs(interaction, '❌ Não consegui validar as permissões do bot. Tente novamente.', AGE_VERIFY_DELETE_MS);
                return;
            }

            if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                await replyAndDeleteMs(interaction, '❌ Sem permissão para atribuir/remover cargos. Dê ao bot a permissão "Gerenciar Cargos".', AGE_VERIFY_DELETE_MS);
                return;
            }

            if (verifiedRole.position >= me.roles.highest.position) {
                await replyAndDeleteMs(
                    interaction,
                    '❌ Não consigo gerenciar o cargo “Verificado”. Coloque o cargo do bot acima desse cargo na hierarquia do servidor.',
                    AGE_VERIFY_DELETE_MS
                );
                return;
            }
            if (extraRole && extraRole.position >= me.roles.highest.position) {
                await replyAndDeleteMs(
                    interaction,
                    `❌ Não consigo gerenciar o cargo extra. Coloque o cargo do bot acima do cargo <@&${extraRoleId}> na hierarquia do servidor.`,
                    AGE_VERIFY_DELETE_MS
                );
                return;
            }

            const member = interaction.member;
            if (!member || !member.roles) {
                await replyAndDeleteMs(interaction, '❌ Não consegui identificar seu membro no servidor. Tente novamente.', AGE_VERIFY_DELETE_MS);
                return;
            }

            const visitorRoleId = String(config.cargoVisitanteId ?? '').trim();
            const visitorRole = /^\d{17,20}$/.test(visitorRoleId) ? await interaction.guild.roles.fetch(visitorRoleId).catch(() => null) : null;
            if (/^\d{17,20}$/.test(visitorRoleId) && !visitorRole) {
                await replyAndDeleteMs(interaction, '❌ Cargo de “Visitante” não encontrado. Verifique o ID configurado (cargoVisitanteId).', AGE_VERIFY_DELETE_MS);
                return;
            }
            if (visitorRole && visitorRole.position >= me.roles.highest.position) {
                await replyAndDeleteMs(
                    interaction,
                    '❌ Não consigo gerenciar o cargo “Visitante”. Coloque o cargo do bot acima desse cargo na hierarquia do servidor.',
                    AGE_VERIFY_DELETE_MS
                );
                return;
            }

            const ops = [];
            if (!member.roles.cache.has(verifiedRoleId)) ops.push(member.roles.add(verifiedRoleId, 'Verificação de idade (18+)'));
            if (extraRole && !member.roles.cache.has(extraRoleId)) ops.push(member.roles.add(extraRoleId, 'Verificação de idade (18+)'));
            if (visitorRole && member.roles.cache.has(visitorRoleId)) ops.push(member.roles.remove(visitorRoleId, 'Verificação de idade (18+)'));

            if (ops.length) await Promise.all(ops);

            await saveAgeVerificationRecord({
                guildId: interaction.guildId,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                fullName: pending.fullName,
                birthDate,
                age
            }).catch((err) => logError('Falha ao salvar verificação de idade', err));

            await sendAgeVerificationLog({
                guild: interaction.guild,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                fullName: pending.fullName,
                birthDate,
                age
            }).catch((err) => logError('Falha ao enviar log de verificação de idade', err));

            await replyAndDeleteMs(interaction, '✅ Verificação concluída. Acesso liberado.', AGE_VERIFY_DELETE_MS);
            await trySendDM(
                interaction.user,
                `✅ LIBERADO\n\nSua verificação foi aprovada e seu acesso foi liberado.`
            );
        } catch (err) {
            logError('Erro no botão verificar_idade_confirmar', err);
            await replyAndDeleteMs(interaction, '❌ Erro ao concluir a verificação. Tente novamente.', AGE_VERIFY_DELETE_MS);
        }
        return;
    }

    if (id === 'ticketfarm_open') {
        const farm = getTicketFarmConfig();
        const now = Date.now();
        const last = ticketFarmCooldownByUserId.get(interaction.user.id) ?? 0;
        const cooldownMs = farm.cooldownSeconds * 1000;
        const remaining = last + cooldownMs - now;
        if (cooldownMs > 0 && remaining > 0) {
            await interaction.reply({ content: `⏳ Aguarde ${Math.ceil(remaining / 1000)}s para abrir outro TicketFarm.`, flags: MessageFlags.Ephemeral }).catch(() => {});
            setTimeout(() => interaction.deleteReply().catch(() => {}), AUTO_DELETE_MS);
            return;
        }

        const modal = new ModalBuilder().setCustomId('ticketfarm_modal').setTitle('🌾 Abrir TicketFarm');
        const inputName = new TextInputBuilder()
            .setCustomId('farm_player_name')
            .setLabel('Nome do player')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(64);
        const inputId = new TextInputBuilder()
            .setCustomId('farm_player_id')
            .setLabel('ID do player')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(32);
        modal.addComponents(
            new ActionRowBuilder().addComponents(inputName),
            new ActionRowBuilder().addComponents(inputId)
        );
        await interaction.showModal(modal).catch(() => {});
        return;
    }

    if (id.startsWith('ticketfarm_')) {
        try {
            await withTimeout(interaction.deferReply({ flags: MessageFlags.Ephemeral }), 5000, 'deferReply(ticketfarm)');
            logInfo(`TicketFarm button | ${id} | Usuario: ${interaction.user.tag} | Canal: ${interaction.channel?.id ?? '-'}`);

            const channel = interaction.channel;
            if (!channel || channel.type !== ChannelType.GuildText || !isFarmChannel(channel)) {
                await replyAndDelete(interaction, '❌ Este botão só funciona dentro de um TicketFarm');
                return;
            }

            const meta = parseFarmTopic(channel.topic);
            const openerId = meta['farm.userId'];
            const status = meta['farm.status'] ?? 'open';
            const claimedById = meta['farm.claimedBy'] || null;
            const panelMsgId = meta['farm.panelMsg'] || null;
            const playerName = meta['farm.playerName'] || '';
            const playerId = meta['farm.playerId'] || '';

            if (id === 'ticketfarm_claim') {
                if (!canUseTicketFarmViewer(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Apenas cargos autorizados podem assumir TicketFarm');
                    return;
                }

                if (status !== 'open') {
                    await replyAndDelete(interaction, '⚠️ TicketFarm já está fechado');
                    return;
                }

                await interaction.editReply('⏳ Assumindo TicketFarm...');

                const openerTag = openerId
                    ? await withTimeout(
                          interaction.guild.members.fetch(openerId).then((m) => m.user.tag).catch(() => 'desconhecido'),
                          8000,
                          'fetchFarmOpener'
                      )
                    : 'desconhecido';

                const embed = createTicketFarmIntroEmbed({
                    guild: interaction.guild,
                    openerId,
                    openerTag,
                    playerName,
                    playerId,
                    claimedById: interaction.user.id,
                    isClosed: false
                });

                const msg = await withTimeout(findTicketControlMessage(channel, panelMsgId, 'ticketfarm_'), 8000, 'findFarmControlMessage(claim)');
                if (msg) await msg.edit({ embeds: [embed], components: createTicketFarmActionRows({ isClosed: false }) }).catch(() => {});

                await withTimeout(
                    channel.send({
                        embeds: [
                            applyGuildBranding(
                                new EmbedBuilder().setColor(0x7c3aed).setDescription(`👨‍💼 TicketFarm assumido por <@${interaction.user.id}>`),
                                interaction.guild
                            )
                        ]
                    }),
                    8000,
                    'sendFarmClaimNotice'
                );

                await replyAndDelete(interaction, '✅ TicketFarm assumido');
                return;
            }

            if (id === 'ticketfarm_close') {
                if (!canUseTicketFarmAdmin(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Apenas ADM pode fechar TicketFarm');
                    return;
                }

                if (status !== 'open') {
                    await replyAndDelete(interaction, '⚠️ TicketFarm já está fechado');
                    return;
                }

                await interaction.editReply({ content: '🔒 Tem certeza que deseja fechar este TicketFarm?', components: [createConfirmRow({ confirmId: 'ticketfarm_close_confirm', cancelId: 'ticketfarm_close_cancel', confirmLabel: 'Confirmar Fechamento' })] });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 60000);
                return;
            }

            if (id === 'ticketfarm_close_cancel') {
                await replyAndDelete(interaction, '✅ Cancelado');
                return;
            }

            if (id === 'ticketfarm_close_confirm') {
                if (!canUseTicketFarmAdmin(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Apenas ADM pode fechar TicketFarm');
                    return;
                }

                await interaction.editReply('⏳ Fechando TicketFarm...');
                const closerId = interaction.user.id;

                if (openerId) {
                    await channel.permissionOverwrites.edit(openerId, { SendMessages: false, AddReactions: false }).catch(() => {});
                }

                const openerTag = openerId
                    ? await withTimeout(
                          interaction.guild.members.fetch(openerId).then((m) => m.user.tag).catch(() => 'desconhecido'),
                          8000,
                          'fetchFarmOpener(close)'
                      )
                    : 'desconhecido';
                const embed = createTicketFarmIntroEmbed({
                    guild: interaction.guild,
                    openerId,
                    openerTag,
                    playerName,
                    playerId,
                    claimedById,
                    isClosed: true
                });
                const msg = await withTimeout(findTicketControlMessage(channel, panelMsgId, 'ticketfarm_'), 8000, 'findFarmControlMessage(close)');
                if (msg) msg.edit({ embeds: [embed], components: createTicketFarmActionRows({ isClosed: true }) }).catch(() => {});

                await channel.send({
                    embeds: [
                        applyGuildBranding(
                            new EmbedBuilder()
                            .setTitle('🔒 TicketFarm Fechado')
                            .setDescription(['━━━━━━━━━━━━━━━━━━━━', `Fechado por: <@${closerId}>`, 'Este canal foi bloqueado para novas mensagens do usuário.', '━━━━━━━━━━━━━━━━━━━━'].join('\n'))
                            .setColor(0x0ea5e9),
                            interaction.guild
                        )
                    ]
                }).catch(() => {});

                await replyAndDelete(interaction, '🔒 TicketFarm fechado. Transcript será enviado no log.');

                buildTranscriptTxt(channel)
                    .then((transcriptText) =>
                        sendTicketFarmLog({ guild: interaction.guild, channel, action: 'Fechado', actorId: closerId, openerId, playerName, playerId, transcriptText })
                    )
                    .catch((err) => logError('Falha ao gerar/enviar transcript TicketFarm', err));

                return;
            }

            if (id === 'ticketfarm_delete') {
                if (!canUseTicketFarmAdmin(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Apenas ADM pode deletar TicketFarm');
                    return;
                }

                if (status !== 'closed' && !isTicketLocked(channel, openerId)) {
                    await replyAndDelete(interaction, '⚠️ Feche o TicketFarm antes de deletar');
                    return;
                }

                await interaction.editReply({ content: '🗑️ Tem certeza que deseja deletar este TicketFarm? (ação irreversível)', components: [createConfirmRow({ confirmId: 'ticketfarm_delete_confirm', cancelId: 'ticketfarm_delete_cancel', confirmLabel: 'Confirmar Deleção' })] });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 60000);
                return;
            }

            if (id === 'ticketfarm_delete_cancel') {
                await replyAndDelete(interaction, '✅ Cancelado');
                return;
            }

            if (id === 'ticketfarm_delete_confirm') {
                if (!canUseTicketFarmAdmin(interaction.member)) {
                    await replyAndDelete(interaction, '❌ Apenas ADM pode deletar TicketFarm');
                    return;
                }

                if (status !== 'closed' && !isTicketLocked(channel, openerId)) {
                    await replyAndDelete(interaction, '⚠️ Feche o TicketFarm antes de deletar');
                    return;
                }

                await interaction.editReply('⏳ Salvando transcript e deletando canal...');
                const actorId = interaction.user.id;
                await sendTicketFarmLog({ guild: interaction.guild, channel, action: 'Deletado', actorId, openerId, playerName, playerId, transcriptText: null });
                await replyAndDelete(interaction, '🗑️ Deletando canal...');
                setTimeout(() => channel.delete().catch(() => {}), 1500);
                return;
            }

            await replyAndDelete(interaction, '⚠️ Ação inválida');
        } catch (err) {
            logError(`Erro no botão TicketFarm: ${interaction.customId}`, err);
            await replyAndDelete(interaction, '❌ Erro ao processar TicketFarm');
        }
        return;
    }

    if (!id.startsWith('ticket_')) return;

    try {
        await withTimeout(interaction.deferReply({ flags: MessageFlags.Ephemeral }), 5000, 'deferReply(button)');
        logInfo(`Ticket button | ${id} | Usuario: ${interaction.user.tag} | Canal: ${interaction.channel?.id ?? '-'}`);

        const ticket = getTicketConfig();

        if (id.startsWith('ticket_open:')) {
            const raw = id.slice('ticket_open:'.length);
            const typeKey = (raw.split('|')[0] || 'suporte').trim();
            const category = ticket.categories[typeKey];
            if (!category?.categoryId) {
                await replyAndDelete(interaction, '❌ Categoria de ticket não configurada no config.json');
                return;
            }

            const parent = await withTimeout(
                interaction.guild.channels.fetch(category.categoryId).catch(() => null),
                8000,
                'fetchCategory'
            );
            if (!parent) {
                await replyAndDelete(interaction, `❌ Categoria inválida para ${category.label}.\nID não encontrado: ${category.categoryId}`);
                return;
            }
            if (parent.type !== ChannelType.GuildCategory) {
                await replyAndDelete(
                    interaction,
                    `❌ Categoria inválida para ${category.label}.\nO ID configurado não é uma categoria: ${category.categoryId}\nCanal encontrado: ${parent.name}`
                );
                return;
            }

            const now = Date.now();
            const last = ticketCooldownByUserId.get(interaction.user.id) ?? 0;
            const cooldownMs = ticket.cooldownSeconds * 1000;
            const remaining = last + cooldownMs - now;
            if (cooldownMs > 0 && remaining > 0) {
                await replyAndDelete(interaction, `⏳ Aguarde ${Math.ceil(remaining / 1000)}s para abrir outro ticket.`);
                return;
            }

            const existing = await withTimeout(
                findOpenTicketChannelForUser(interaction.guild, interaction.user.id),
                5000,
                'findOpenTicket'
            );
            if (existing) {
                await replyAndDelete(interaction, `⚠️ Você já possui um ticket aberto: <#${existing.id}>`);
                return;
            }

            const baseName = `ticket-${sanitizeChannelName(interaction.user.username)}`;
            let name = baseName;
            let i = 2;
            while (interaction.guild.channels.cache.some((c) => c.type === ChannelType.GuildText && c.name === name)) {
                name = `${baseName}-${i++}`;
            }

            const overwrites = [
                { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ];

            const viewerRoles = getTicketViewerRoles(ticket, typeKey);
            for (const roleId of viewerRoles) {
                overwrites.push({
                    id: roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                });
            }

            await interaction.editReply('⏳ Criando canal do ticket...');
            const meta = {
                'ticket.userId': interaction.user.id,
                'ticket.type': typeKey,
                'ticket.status': 'open',
                'ticket.createdAt': String(Date.now())
            };
            const channel = await withTimeout(
                interaction.guild.channels.create({
                    name,
                    type: ChannelType.GuildText,
                    parent: parent.id,
                    permissionOverwrites: overwrites,
                    topic: buildTicketTopic(meta)
                }),
                15000,
                'createTicketChannel'
            );

            const introEmbed = createTicketIntroEmbed({
                guild: interaction.guild,
                typeLabel: category.label,
                typeEmoji: category.emoji,
                openerId: interaction.user.id,
                openerTag: interaction.user.tag,
                claimedById: null,
                status: 'open'
            });
            const introMsg = await withTimeout(
                channel.send({ content: `<@${interaction.user.id}>`, embeds: [introEmbed], components: createTicketActionRows({ isClosed: false }) }),
                10000,
                'sendIntroMessage'
            );
            void introMsg;

            ticketCooldownByUserId.set(interaction.user.id, now);

            await replyAndDelete(interaction, `✅ Ticket criado: <#${channel.id}>`);
            return;
        }

        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText || !isTicketChannel(channel)) {
            await replyAndDelete(interaction, '❌ Este botão só funciona dentro de um canal de ticket');
            return;
        }

        const meta = parseTicketTopic(channel.topic);
        const openerId = meta['ticket.userId'];
        const typeKey = meta['ticket.type'] ?? 'suporte';
        const claimedById = meta['ticket.claimedBy'] || null;
        const status = meta['ticket.status'] ?? 'open';
        const panelMsgId = meta['ticket.panelMsg'] || null;

        if (id === 'ticket_claim') {
            if (!canUseTicketStaff(interaction.member, typeKey)) {
                await replyAndDelete(interaction, '❌ Apenas staff pode assumir tickets');
                return;
            }

            if (status !== 'open' || isTicketLocked(channel, openerId)) {
                await replyAndDelete(interaction, '⚠️ Ticket já está fechado');
                return;
            }

            await interaction.editReply('⏳ Assumindo ticket...');

            const category = ticket.categories[typeKey] ?? { label: typeKey, emoji: '🎫' };
            const openerTag = openerId
                ? await withTimeout(
                      interaction.guild.members.fetch(openerId).then((m) => m.user.tag).catch(() => 'desconhecido'),
                      8000,
                      'fetchOpener'
                  )
                : 'desconhecido';
            const embed = createTicketIntroEmbed({
                guild: interaction.guild,
                typeLabel: category.label,
                typeEmoji: category.emoji,
                openerId,
                openerTag,
                claimedById: interaction.user.id,
                status: 'open'
            });

            const msg = await withTimeout(findTicketControlMessage(channel, panelMsgId), 8000, 'findControlMessage(claim)');
            if (msg) await msg.edit({ embeds: [embed], components: createTicketActionRows({ isClosed: false }) }).catch(() => {});

            await withTimeout(
                channel.send({
                    embeds: [
                        applyGuildBranding(
                            new EmbedBuilder().setColor(0x7c3aed).setDescription(`👨‍💼 Atendimento assumido por <@${interaction.user.id}>`),
                            interaction.guild
                        )
                    ]
                }),
                8000,
                'sendClaimNotice'
            );
            await replyAndDelete(interaction, '✅ Ticket assumido');
            return;
        }

        if (id === 'ticket_close') {
            if (status !== 'open' || isTicketLocked(channel, openerId)) {
                await replyAndDelete(interaction, '⚠️ Ticket já está fechado');
                return;
            }

            await interaction.editReply({ content: '🔒 Tem certeza que deseja fechar este ticket?', components: [createConfirmRow({ confirmId: 'ticket_close_confirm', cancelId: 'ticket_close_cancel', confirmLabel: 'Confirmar Fechamento' })] });
            setTimeout(() => {
                interaction.deleteReply().catch(() => {});
            }, 60000);
            return;
        }

        if (id === 'ticket_close_cancel') {
            await replyAndDelete(interaction, '✅ Cancelado');
            return;
        }

        if (id === 'ticket_close_confirm') {
            if (status !== 'open' || isTicketLocked(channel, openerId)) {
                await replyAndDelete(interaction, '⚠️ Ticket já está fechado');
                return;
            }

            await interaction.editReply('⏳ Fechando ticket...');
            const closerId = interaction.user.id;

            if (openerId) {
                await withTimeout(
                    channel.permissionOverwrites.edit(openerId, { SendMessages: false, AddReactions: false }).catch(() => {}),
                    10000,
                    'lockOpener'
                );
            }

            const category = ticket.categories[typeKey] ?? { label: typeKey, emoji: '🎫' };
            await withTimeout(
                channel.send({
                    embeds: [
                        applyGuildBranding(
                            new EmbedBuilder()
                            .setTitle('🔒 Ticket Fechado')
                            .setDescription(['━━━━━━━━━━━━━━━━━━━━', `Fechado por: <@${closerId}>`, 'Este canal foi bloqueado para novas mensagens do usuário.', '━━━━━━━━━━━━━━━━━━━━'].join('\n'))
                            .setColor(0x0ea5e9)
                            .addFields({ name: '🎫 Tipo', value: `${category.emoji} ${category.label}`, inline: true }),
                            interaction.guild
                        )
                    ]
                }),
                8000,
                'sendCloseMessage'
            );

            const msg = await withTimeout(findTicketControlMessage(channel, panelMsgId), 8000, 'findControlMessage(close)');
            if (msg) msg.edit({ components: createTicketActionRows({ isClosed: true }) }).catch(() => {});

            await replyAndDelete(interaction, '🔒 Ticket fechado. Gerando transcript e enviando para o log...');

            buildTranscriptTxt(channel)
                .then((transcriptText) =>
                    sendTicketLog({ guild: interaction.guild, channel, openerId, closerId, claimedById, typeKey, action: 'Fechado', transcriptText })
                )
                .catch((err) => logError('Falha ao gerar/enviar transcript', err));
            return;
        }

        if (id === 'ticket_delete') {
            if (!canUseTicketStaff(interaction.member, typeKey)) {
                await replyAndDelete(interaction, '❌ Apenas staff pode deletar tickets');
                return;
            }

            if (status !== 'closed' && !isTicketLocked(channel, openerId)) {
                await replyAndDelete(interaction, '⚠️ Feche o ticket antes de deletar');
                return;
            }

            await interaction.editReply({ content: '🗑️ Tem certeza que deseja deletar este ticket? (ação irreversível)', components: [createConfirmRow({ confirmId: 'ticket_delete_confirm', cancelId: 'ticket_delete_cancel', confirmLabel: 'Confirmar Deleção' })] });
            setTimeout(() => {
                interaction.deleteReply().catch(() => {});
            }, 60000);
            return;
        }

        if (id === 'ticket_delete_cancel') {
            await replyAndDelete(interaction, '✅ Cancelado');
            return;
        }

        if (id === 'ticket_delete_confirm') {
            if (!canUseTicketStaff(interaction.member, typeKey)) {
                await replyAndDelete(interaction, '❌ Apenas staff pode deletar tickets');
                return;
            }

            if (status !== 'closed' && !isTicketLocked(channel, openerId)) {
                await replyAndDelete(interaction, '⚠️ Feche o ticket antes de deletar');
                return;
            }

            await interaction.editReply('⏳ Salvando transcript e deletando canal...');

            const closerId = interaction.user.id;
            await sendTicketLog({ guild: interaction.guild, channel, openerId, closerId, claimedById, typeKey, action: 'Deletado', transcriptText: null });

            await replyAndDelete(interaction, '🗑️ Deletando canal...');
            setTimeout(() => channel.delete().catch(() => {}), 1500);
            return;
        }

        await replyAndDelete(interaction, '⚠️ Ação inválida');
    } catch (err) {
        logError(`Erro no botão: ${interaction.customId}`, err);
        const isMissingPermissions =
            (typeof err?.code === 'number' && err.code === 50013) ||
            (typeof err?.status === 'number' && err.status === 403) ||
            (typeof err?.rawError?.code === 'number' && err.rawError.code === 50013);

        const isTimeout = typeof err?.message === 'string' && err.message.startsWith('Timeout:');
        const message = isMissingPermissions
            ? '❌ Sem permissão para executar esta ação. Verifique se o bot tem "Gerenciar Canais" e se o cargo do bot está acima dos cargos envolvidos.'
            : isTimeout
              ? `⏳ O Discord demorou para responder.\n${err.message}\nTente novamente em alguns segundos.`
            : '❌ Erro ao processar a ação. Veja o console do bot.';

        await replyAndDelete(interaction, message);
    }
    } catch (err) {
        logError('Erro não tratado no interactionCreate', err);
        if (!interaction?.isRepliable?.()) return;
        const content = '❌ Erro interno ao processar sua ação. Tente novamente.';
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
            scheduleDeleteReplyMs(interaction, AUTO_DELETE_MS);
            return;
        }
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

void loadMusicHistory();
autoDeployCommands();

async function delayMs(ms) {
    await new Promise((r) => setTimeout(r, ms));
}

async function startClient() {
    if (!BOT_TOKEN) {
        console.error('TOKEN ausente. Configure TOKEN no Railway (Variables) ou crie um .env baseado no .env.example.');
        process.exit(1);
    }

    let attempt = 0;
    while (true) {
        try {
            attempt++;
            logInfo(`Iniciando login no Discord... (tentativa ${attempt})`);
            await client.login(BOT_TOKEN);
            return;
        } catch (err) {
            const msg = String(err?.message ?? err ?? '').slice(0, 300);
            logError(`Falha no login do Discord: ${msg}`, err);
            const wait = Math.min(60000, 5000 * attempt);
            logWarn(`Tentando novamente em ${Math.ceil(wait / 1000)}s...`);
            await delayMs(wait);
        }
    }
}

void startClient();
