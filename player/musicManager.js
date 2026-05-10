const {
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    createAudioResource,
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { delay } = require('../utils/async');
const { resolveToTracks, getStream } = require('./youtube');

const LOOP = {
    OFF: 'off',
    TRACK: 'track',
    QUEUE: 'queue'
};

function clamp(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
}

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function buildNowPlayingEmbed({ guildName, track, volume, loopMode, queueLength }) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎶 Tocando agora')
        .setDescription(`[${track.title}](${track.url})`)
        .addFields(
            { name: '📌 Servidor', value: guildName || '—', inline: true },
            { name: '🔊 Volume', value: `${Math.round(volume * 100)}%`, inline: true },
            { name: '🔁 Loop', value: loopMode, inline: true },
            { name: '🗒️ Fila', value: `${queueLength}`, inline: true }
        )
        .setTimestamp();
    return embed;
}

class GuildMusicController {
    constructor({ client, guildId, logger, onManagerDestroy }) {
        this.client = client;
        this.guildId = guildId;
        this.logger = logger;
        this.onManagerDestroy = onManagerDestroy;

        this.queue = [];
        this.current = null;
        this.loopMode = LOOP.OFF;
        this.volume = 0.6;

        this.connection = null;
        this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });

        this.textChannelId = null;
        this.nowPlayingMessageId = null;
        this.destroyed = false;

        this._bindPlayer();
    }

    _bindPlayer() {
        this.player.on(AudioPlayerStatus.Idle, () => {
            void this._onIdle();
        });
        this.player.on('error', (err) => {
            this.logger.error(`[music:${this.guildId}] erro no player`, err);
            void this._failAndSkip();
        });
    }

    async _onIdle() {
        if (this.destroyed) return;
        if (!this.current) return;

        if (this.loopMode === LOOP.TRACK) {
            const again = this.current;
            this.current = null;
            await this._playTrack(again, { isRetry: false });
            return;
        }

        if (this.loopMode === LOOP.QUEUE) {
            this.queue.push(this.current);
        }

        this.current = null;
        await this.playNext();
    }

    async _failAndSkip() {
        if (this.destroyed) return;
        this.current = null;
        await this.playNext();
    }

    async ensureConnection(voiceChannel) {
        if (this.destroyed) throw new Error('DESTROYED');

        const guild = voiceChannel.guild;
        const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
        const perms = me ? voiceChannel.permissionsFor(me) : null;
        const missing = [];
        if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push('Ver Canal');
        if (!perms?.has(PermissionFlagsBits.Connect)) missing.push('Conectar');
        if (!perms?.has(PermissionFlagsBits.Speak)) missing.push('Falar');
        if (missing.length) throw new Error('SEM_PERMISSAO_VOICE');

        const userLimit = Number(voiceChannel.userLimit ?? 0);
        if (userLimit > 0 && voiceChannel.members?.size >= userLimit && !voiceChannel.members?.has(me?.id ?? '')) {
            throw new Error('SALA_CHEIA');
        }

        if (this.connection) {
            try {
                await entersState(this.connection, VoiceConnectionStatus.Ready, 8000);
                return;
            } catch {}
        }

        const conn = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });
        this.connection = conn;
        this.connection.subscribe(this.player);

        this.connection.on('error', (err) => {
            this.logger.error(`[music:${this.guildId}] erro na conexão de voz`, err);
        });
        this.connection.on(VoiceConnectionStatus.Disconnected, () => {
            void this._tryReconnect();
        });

        try {
            await entersState(conn, VoiceConnectionStatus.Ready, 15000);
        } catch {
            throw new Error('VOICE_TIMEOUT');
        }

        if (voiceChannel.type === ChannelType.GuildStageVoice && me?.voice) {
            await me.voice.setSuppressed(false).catch(() => {});
            await me.voice.setRequestToSpeak(true).catch(() => {});
        }
    }

    async _tryReconnect() {
        if (this.destroyed) return;
        const conn = this.connection;
        if (!conn) return;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await entersState(conn, VoiceConnectionStatus.Signalling, 5000);
                await entersState(conn, VoiceConnectionStatus.Ready, 15000);
                this.logger.info(`[music:${this.guildId}] reconectado no voice`);
                return;
            } catch {
                await delay(1500 * attempt);
            }
        }

        this.logger.warn(`[music:${this.guildId}] desconectado do voice (falha em reconectar)`);
        if (typeof this.onManagerDestroy === 'function') this.onManagerDestroy();
        else this.destroy();
    }

    setTextChannel(channelId) {
        this.textChannelId = channelId;
    }

    async enqueue(input, { requestedById }) {
        const tracks = await resolveToTracks(input, { requestedById });
        this.queue.push(...tracks);
        return tracks;
    }

    async playNext() {
        if (this.destroyed) return;
        if (this.player.state.status !== AudioPlayerStatus.Idle) return;
        if (this.current) return;
        const next = this.queue.shift();
        if (!next) return;
        await this._playTrack(next, { isRetry: false });
    }

    async _playTrack(track, { isRetry }) {
        if (this.destroyed) return;

        this.current = track;
        try {
            const stream = await getStream(track.url);
            const resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
            resource.volume?.setVolume(this.volume);
            this.player.play(resource);
            await this._upsertNowPlaying();
        } catch (err) {
            this.logger.error(`[music:${this.guildId}] falha ao tocar: ${track.url}`, err);
            this.current = null;
            if (!isRetry) {
                await this.playNext();
            }
        }
    }

    pause() {
        return this.player.pause(true);
    }

    resume() {
        return this.player.unpause();
    }

    skip() {
        this.player.stop(true);
    }

    stop() {
        this.queue = [];
        this.current = null;
        this.player.stop(true);
        if (typeof this.onManagerDestroy === 'function') this.onManagerDestroy();
        else this.destroy();
    }

    setVolumePercent(percent) {
        const p = clamp(percent, 0, 200);
        this.volume = p / 100;
        const res = this.player.state.resource;
        res?.volume?.setVolume(this.volume);
        void this._upsertNowPlaying();
        return p;
    }

    setLoopMode(mode) {
        const m = String(mode ?? '').toLowerCase();
        if (m !== LOOP.OFF && m !== LOOP.TRACK && m !== LOOP.QUEUE) return this.loopMode;
        this.loopMode = m;
        void this._upsertNowPlaying();
        return this.loopMode;
    }

    shuffleQueue() {
        shuffleInPlace(this.queue);
    }

    async _upsertNowPlaying() {
        if (!this.textChannelId) return;
        const guild = this.client.guilds.cache.get(this.guildId) ?? null;
        const channel = await this.client.channels.fetch(this.textChannelId).catch(() => null);
        if (!guild || !channel || !channel.isTextBased?.()) return;
        if (!this.current) return;

        const embed = buildNowPlayingEmbed({
            guildName: guild.name,
            track: this.current,
            volume: this.volume,
            loopMode: this.loopMode,
            queueLength: this.queue.length
        });

        if (this.nowPlayingMessageId) {
            const msg = await channel.messages.fetch(this.nowPlayingMessageId).catch(() => null);
            if (msg) {
                await msg.edit({ embeds: [embed] }).catch(() => {});
                return;
            }
            this.nowPlayingMessageId = null;
        }

        const sent = await channel.send({ embeds: [embed] }).catch(() => null);
        if (sent) this.nowPlayingMessageId = sent.id;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.onManagerDestroy = null;
        try {
            this.player.stop();
        } catch {}
        try {
            this.connection?.destroy();
        } catch {}
        this.connection = null;
        this.nowPlayingMessageId = null;
        this.textChannelId = null;
    }
}

class MusicManager {
    constructor({ client, logger }) {
        this.client = client;
        this.logger = logger;
        this.byGuildId = new Map();
        this.emptyTimeoutByGuildId = new Map();
    }

    get(guildId) {
        const id = String(guildId);
        let c = this.byGuildId.get(id);
        if (!c) {
            c = new GuildMusicController({
                client: this.client,
                guildId: id,
                logger: this.logger,
                onManagerDestroy: () => this.destroy(id)
            });
            this.byGuildId.set(id, c);
        }
        return c;
    }

    destroy(guildId) {
        const id = String(guildId);
        const c = this.byGuildId.get(id);
        if (c) c.destroy();
        this.byGuildId.delete(id);
        const t = this.emptyTimeoutByGuildId.get(id);
        if (t) clearTimeout(t);
        this.emptyTimeoutByGuildId.delete(id);
    }

    handleVoiceStateUpdate(oldState, newState) {
        const guildId = String(newState.guild?.id ?? oldState.guild?.id ?? '');
        if (!guildId) return;
        const ctrl = this.byGuildId.get(guildId);
        if (!ctrl?.connection) return;

        const channelId = ctrl.connection.joinConfig?.channelId ?? null;
        if (!channelId) return;
        const channel = newState.guild.channels.cache.get(channelId) ?? null;
        if (!channel || !channel.isVoiceBased?.()) return;

        const nonBotMembers = channel.members.filter((m) => !m.user.bot);
        if (nonBotMembers.size > 0) {
            const t = this.emptyTimeoutByGuildId.get(guildId);
            if (t) clearTimeout(t);
            this.emptyTimeoutByGuildId.delete(guildId);
            return;
        }

        if (this.emptyTimeoutByGuildId.has(guildId)) return;
        const timeout = setTimeout(() => {
            const still = this.byGuildId.get(guildId);
            if (!still?.connection) return;
            const ch = still.connection.joinConfig?.channelId ?? null;
            const g = this.client.guilds.cache.get(guildId) ?? null;
            const vc = ch && g ? g.channels.cache.get(ch) : null;
            const nonBots = vc?.isVoiceBased?.() ? vc.members.filter((m) => !m.user.bot) : null;
            if (nonBots && nonBots.size === 0) {
                this.logger.info(`[music:${guildId}] auto-disconnect (canal vazio)`);
                this.destroy(guildId);
            }
            this.emptyTimeoutByGuildId.delete(guildId);
        }, 45000);
        this.emptyTimeoutByGuildId.set(guildId, timeout);
    }
}

module.exports = { MusicManager, LOOP };
