/** Ordering, recovery journals and placement identity shared by socket features. */
export const stageSyncMethods = {
    _isSyncStamp(stamp) {
        return !!stamp && Number.isSafeInteger(stamp.clock) && stamp.clock > 0
            && typeof stamp.userId === 'string' && stamp.userId.length > 0 && stamp.userId.length <= 256;
    },

    _compareSyncStamps(a, b) {
        if (!this._isSyncStamp(a)) return this._isSyncStamp(b) ? -1 : 0;
        if (!this._isSyncStamp(b)) return 1;
        return a.clock - b.clock || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
    },

    _nextSyncStamp() {
        this._syncClock = Math.max(this._syncClock, Date.now()) + 1;
        return {clock:this._syncClock, userId:game.user.id};
    },

    _getSyncPacketStream(data) {
        switch (data.action) {
            case 'updateStage': return `state:${data.userId}`;
            case 'updateGMStage': return `control:${data.userId}`;
            case 'requestGMStage': return `controlRequest:${data.userId}`;
            case 'updateActorEmotion': return `emotion:${data.actorId}:${data.placementId}`;
            case 'removeStageActor': return `remove:${data.actorId}:${data.placementId || ''}`;
            case 'updateStageFocus': return `focus:${data.side}`;
            case 'stageChat': return `dialogue:${data.side}`;
            default: return null;
        }
    },

    _recordSyncPacket(data) {
        const key = this._getSyncPacketStream(data);
        if (!key) return false;
        if (data.stamp != null) {
            if (!this._isSyncStamp(data.stamp) || data.stamp.userId !== data.userId) return false;
            if (this._compareSyncStamps(data.stamp, this._syncVersions.get(key)) <= 0) return false;
            this._syncClock = Math.max(this._syncClock, data.stamp.clock);
            this._syncVersions.set(key, {...data.stamp});
        }
        this._syncRecentPackets.delete(key);
        this._syncRecentPackets.set(key, data);
        if (this._pendingSyncRequestId && !this._syncReplaying) {
            this._pendingSyncEvents.delete(key);
            this._pendingSyncEvents.set(key, data);
        }
        return true;
    },

    _emitStagePacket(data) {
        const packet = {...data, userId:game.user.id, stamp:data.stamp || this._nextSyncStamp()};
        this._recordSyncPacket(packet);
        game.socket.emit('module.lichsoma-speaker-stage', packet);
        return packet;
    },

    _readSyncVersions(raw) {
        if (raw == null) return new Map();
        if (!Array.isArray(raw) || raw.length > 16384) return null;
        const result = new Map();
        for (const entry of raw) {
            if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
                || entry[0].length > 1024 || !this._isSyncStamp(entry[1])) return null;
            result.set(entry[0], {...entry[1]});
        }
        return result;
    },

    _clearSyncRetry() {
        if (this._syncRetryTimer != null) clearTimeout(this._syncRetryTimer);
        this._syncRetryTimer = null;
    },

    _scheduleSyncRetry(requestId) {
        this._clearSyncRetry();
        const delay = Math.min(2000 * 2 ** Math.min(this._syncRetryCount, 3), 15000);
        this._syncRetryTimer = setTimeout(() => {
            this._syncRetryTimer = null;
            if (this._pendingSyncRequestId !== requestId) return;
            this._syncRetryCount++;
            if (this._isPrimaryGM() && this._syncRetryCount >= 2) {
                this._syncUnavailableAuthorities.add(this._pendingSyncAuthorityId);
                this._syncRetryCount = 0;
            }
            this._requestStageSync({retry:true});
        }, delay);
    },

    _replaySyncPackets(packets) {
        this._syncReplaying = true;
        try {
            for (const packet of [...packets].sort((a,b) => this._compareSyncStamps(a.stamp,b.stamp))) {
                // Chat documents enter only through Foundry's create hook, never
                // through an arbitrary socket packet claiming to be chat.
                if (packet.action === 'stageChat') this._onChatMessage(packet.message);
                else this._dispatchStagePacket(packet);
            }
        } finally { this._syncReplaying = false; }
    },

    _newStagePlacementId() {
        const stamp = this._nextSyncStamp();
        return `${game.user.id}:${stamp.clock}:${Math.random().toString(36).slice(2)}`;
    },

    _getStagePlacementId(actorId, data) {
        return data?.placementId || `legacy:${data?.userId || ''}:${actorId}`;
    },

    _rememberStageRetirement(actorId, placementId, ownerUserId) {
        if (typeof actorId !== 'string' || typeof placementId !== 'string' || !placementId
            || actorId.length > 256 || placementId.length > 512 || typeof ownerUserId !== 'string') return;
        if (placementId.startsWith('legacy:') ? placementId !== `legacy:${ownerUserId}:${actorId}`
            : placementId.includes(':') && !placementId.startsWith(`${ownerUserId}:`)) return;
        const current = this._activeActors.get(actorId);
        if (current && this._getStagePlacementId(actorId,current) === placementId && current.userId !== ownerUserId) return;
        this._stageRetirements.set(`${actorId}:${placementId}`, {actorId, placementId, ownerUserId});
        const queued = this._pendingStageChat.get(actorId);
        const queuedPlacement = queued?.message?.flags?.[this.MODULE_ID]?.stagedPlacementId;
        if (!queuedPlacement || queuedPlacement === placementId) this._pendingStageChat.delete(actorId);
    },

    _isStagePlacementRetired(actorId, data) {
        const record = this._stageRetirements.get(`${actorId}:${this._getStagePlacementId(actorId, data)}`);
        return !!record && record.ownerUserId === data?.userId;
    },

    _nextStagePosition() {
        return Math.max(-1, ...[...this._activeActors.values()].map(data => Number.isFinite(data.position) ? data.position : -1)) + 1;
    },

    _resolveStagePlacementConflict(incoming) {
        const current = this._activeActors.get(incoming.id);
        if (!current || current.userId === incoming.userId) return true;
        // Two clients may both see an empty slot and place the same actor. Use a
        // stable user order (GM first) so every client chooses the same placer.
        const users = game.users?.contents ?? Array.from(game.users?.values?.() ?? []);
        const rank = id => {
            const user = game.users?.get?.(id);
            const index = users.findIndex(candidate => candidate.id === id);
            return [user?.isGM ? 0 : 1, index < 0 ? users.length : index, id || ''];
        };
        const a = rank(incoming.userId), b = rank(current.userId);
        const incomingWins = a[0] !== b[0] ? a[0] < b[0]
            : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
        const loser = incomingWins ? current : incoming;
        this._rememberStageRetirement(incoming.id,this._getStagePlacementId(incoming.id,loser),loser.userId);
        return incomingWins;
    },

    _storeIncomingStageActor(actorId, data, {retirePrevious = true} = {}) {
        const previous = this._activeActors.get(actorId);
        if (previous && this._getStagePlacementId(actorId,previous) !== this._getStagePlacementId(actorId,data)) {
            if (retirePrevious) this._rememberStageRetirement(actorId,this._getStagePlacementId(actorId,previous),previous.userId);
            this._clearTypingEffectsForActor(actorId);
            this._clearStandingFocusForActor(actorId);
            this._clearActorExitTimers(actorId);
            document.querySelector(`#lichsoma-stage-overlay .stage-character-wrapper[data-actor-id="${actorId}"]`)?.remove();
        }
        if (data.emotionStamp) this._syncClock = Math.max(this._syncClock,data.emotionStamp.clock);
        this._activeActors.set(actorId,data);
    },

    _sortStageActors() {
        const compareText = (a,b) => a < b ? -1 : a > b ? 1 : 0;
        this._activeActors = new Map([...this._activeActors].sort(([idA,a],[idB,b]) =>
            (a.position ?? 0) - (b.position ?? 0)
            || compareText(a.userId || '', b.userId || '') || compareText(idA,idB)));
    },
};
