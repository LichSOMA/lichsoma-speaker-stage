/** socket: methods are attached to SpeakerStage; this is the shared stage controller. */

export const stageSocketMethods = {
    // 소켓 통신 설정
    setupSocket() {
        game.socket.on('module.lichsoma-speaker-stage', data => this._dispatchStagePacket(data));
        // Socket reconnects can occur without a fresh Foundry user document.
        game.socket.on('connect', () => this._onPrimaryGMChanged({reconnected:true}));
        const refresh = (user, connected) => this._onPrimaryGMChanged({
            reconnected: user?.id === game.user?.id && connected === true
        });
        Hooks.on('userConnected', refresh);
        Hooks.on('updateUser', refresh);
        Hooks.on('deleteUser', refresh);
    },

    _dispatchStagePacket(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        switch (data.action) {
            case 'updateStage': return this._receiveStageState(data, {skipSenderCheck:this._syncReplaying});
            case 'updateGMStage': return this._receiveGMStageState(data);
            case 'requestSync': return this._handleSyncRequest(data);
            case 'syncState': return this._receiveSyncState(data);
            case 'syncUnavailable': return this._receiveSyncUnavailable(data);
            case 'removeStageActor': return this._receiveActorRemoval(data);
            case 'requestGMStage': return this._receiveGMStageRequest(data);
            case 'updateActorEmotion': return this._receiveActorEmotion(data);
            case 'updateStageFocus': return this._receiveStageFocus(data);
        }
    },

    _getPrimaryGM() {
        const primary = game.users?.activeGM;
        if (primary?.isGM && primary.active !== false) return primary;
        const users = game.users?.contents ?? Array.from(game.users?.values?.() ?? []);
        return users.find(user => user.isGM && user.active !== false) ?? null;
    },

    _isPrimaryGM() { return this._getPrimaryGM()?.id === game.user?.id; },

    _getBackupGM() {
        const primaryId = this._getPrimaryGM()?.id;
        const users = game.users?.contents ?? Array.from(game.users?.values?.() ?? []);
        return users.find(user => user.isGM && user.active !== false && user.id !== primaryId
            && !this._syncUnavailableAuthorities.has(user.id)) ?? null;
    },

    _getSocketUser(id) {
        if (typeof id !== 'string' || !id) return null;
        const user = game.users?.get?.(id);
        return user && user.active !== false ? user : null;
    },

    _requestStageSync({initial = false, retry = false} = {}) {
        if (initial) {
            this._syncReady = true;
            this._primaryGMId = this._getPrimaryGM()?.id ?? null;
            const earlyBootstrap = [...this._waitingSyncRequests.values()].filter(data => data.bootstrap === true);
            for (const request of earlyBootstrap) {
                this._waitingSyncRequests.delete(request.userId);
                this._handleSyncRequest(request);
            }
        }
        if (!this._syncReady) return;
        this._clearSyncRetry();
        if (game.socket.connected === false) return;
        if (!retry) {
            this._pendingSyncEvents = new Map(this._syncRecentPackets);
            this._syncRetryCount = 0;
            this._syncUnavailableAuthorities.clear();
        }
        const primary = this._getPrimaryGM();
        this._pendingSyncRequestId = null;
        this._pendingSyncAuthorityId = null;
        if (!primary) return;
        const bootstrap = primary.id === game.user.id;
        const authority = bootstrap ? this._getBackupGM() : primary;
        if (!authority) { this._finishPrimaryRecovery(); return; }
        this._pendingSyncRequestId = `${game.user.id}:${Date.now()}:${++this._syncRequestCounter}`;
        this._pendingSyncAuthorityId = authority.id;
        game.socket.emit('module.lichsoma-speaker-stage', {
            action: 'requestSync', userId: game.user.id, requestUserId: game.user.id,
            requestId: this._pendingSyncRequestId, bootstrap, authorityUserId:authority.id
        });
        this._scheduleSyncRetry(this._pendingSyncRequestId);
    },

    _receiveSyncUnavailable(data) {
        const sender = this._getSocketUser(data?.userId);
        if (!this._isPrimaryGM() || !sender?.isGM || sender.id !== this._pendingSyncAuthorityId
            || data.targetUserId !== game.user.id || data.requestId !== this._pendingSyncRequestId) return;
        this._syncUnavailableAuthorities.add(sender.id);
        this._syncRetryCount = 0;
        this._requestStageSync({retry:true});
    },

    _onPrimaryGMChanged({ reconnected = false } = {}) {
        const primaryId = this._getPrimaryGM()?.id ?? null;
        const authorityUnavailable = this._pendingSyncAuthorityId && !this._getSocketUser(this._pendingSyncAuthorityId);
        if (primaryId === this._primaryGMId && !reconnected && !authorityUnavailable) return;
        if (primaryId !== this._primaryGMId) {
            this._waitingSyncRequests.clear();
            this._waitingGMStageRequest = null;
        }
        this._primaryGMId = primaryId;
        this._clearSyncRetry();
        this._pendingSyncRequestId = null;
        this._pendingSyncAuthorityId = null;
        if (!this._syncReady) return;
        if (this._isPrimaryGM() && this.isStageCentralControlEnabled()) this._stageActive = this._gmStageActive;
        if (primaryId && !this._isPrimaryGM() && [...this._activeActors.values()].some(actor => actor.userId === game.user.id)) {
            this._broadcastStageState();
        }
        this._requestStageSync();
    },

    _normalizeSocketActors(data, sender) {
        if (!Array.isArray(data.actors)) return null;
        const result = [], ids = new Set();
        for (const value of data.actors) {
            if (!value || typeof value !== 'object' || typeof value.id !== 'string' || value.id.length > 256 || ids.has(value.id)) return null;
            const actor = game.actors?.get?.(value.id);
            const ownerId = value.userId ?? (sender.isGM ? sender.id : null);
            const owner = typeof ownerId === 'string' ? game.users?.get?.(ownerId) : null;
            if (!actor || !owner) return null;
            if (!sender.isGM && owner.id === sender.id) {
                const assigned = sender.character?.id ?? sender.character;
                if (assigned !== actor.id && actor.testUserPermission?.(sender, 'OWNER') !== true) return null;
            }
            for (const field of ['img', 'name', 'emotionId', 'emotionPortrait', 'emotionUserId', 'placementId']) {
                if (value[field] != null && (typeof value[field] !== 'string' || value[field].length > 8192)) return null;
            }
            if (value.placementId != null && (!value.placementId || value.placementId.length > 512)) return null;
            if (value.placementId && (value.placementId.startsWith('legacy:')
                ? value.placementId !== `legacy:${owner.id}:${actor.id}`
                : value.placementId.includes(':') && !value.placementId.startsWith(`${owner.id}:`))) return null;
            if (value.position != null && (!Number.isFinite(value.position) || value.position < 0)) return null;
            if (value.dialogueVisible != null && typeof value.dialogueVisible !== 'boolean') return null;
            if (value.isStandingImage != null && typeof value.isStandingImage !== 'boolean') return null;
            if (value.emotionStamp != null && !this._isSyncStamp(value.emotionStamp)) return null;
            ids.add(actor.id);
            result.push({id:actor.id, userId:owner.id, img:value.img || actor.img || '',
                name:actor.name, emotionId:value.emotionId ?? null, emotionPortrait:value.emotionPortrait ?? null,
                emotionUserId:value.emotionUserId ?? null, isStandingImage:value.isStandingImage === true,
                position:value.position ?? result.length, dialogueVisible:value.dialogueVisible !== false,
                placementId:value.placementId || this._getStagePlacementId(actor.id, {userId:owner.id}),
                emotionStamp:value.emotionStamp ? {...value.emotionStamp} : null});
        }
        for (const field of ['activeStandingActorId', 'activePlayerStandingActorId']) {
            if (data[field] != null && typeof data[field] !== 'string') return null;
        }
        if (data.lastStandingSpeakerSide != null && !['gm','player'].includes(data.lastStandingSpeakerSide)) return null;
        return result;
    },

    // 현재 활성 액터 목록 직렬화
    _serializeActiveActors() {
        return Array.from(this._activeActors.entries()).map(([id, data]) => {
            return {
                id,
                img: data.img,
                name: data.name,
                emotionId: data.emotionId || null,
                emotionPortrait: data.emotionPortrait || null,
                isStandingImage: !!data.isStandingImage,
                position: data.position,
                dialogueVisible: data.dialogueVisible,
                userId: data.userId,
                emotionUserId: data.emotionUserId,
                placementId: this._getStagePlacementId(id, data),
                emotionStamp: data.emotionStamp ? {...data.emotionStamp} : null
            };
        });
    },

    // GM 스테이지 상태 브로드캐스트
    _broadcastGMStageState({ request = false } = {}) {
        if (!game.user?.isGM) return;
        const intentStamp = request ? this._nextSyncStamp() : this._controlIntentStamp;
        if (this._isPrimaryGM() && this._pendingSyncRequestId) {
            if (request) this._waitingGMStageRequest = {action:'requestGMStage',userId:game.user.id, stageActive:this._stageActive,stamp:intentStamp};
            return;
        }
        if (!this._isPrimaryGM()) {
            if (request && this.isStageCentralControlEnabled()) this._emitStagePacket({
                action:'requestGMStage', stageActive:this._stageActive, userId:game.user.id, stamp:intentStamp
            });
            return;
        }
        if (request) this._controlIntentStamp = intentStamp;
        this._gmStageActive = this._stageActive;
        this._emitStagePacket({
            action: 'updateGMStage',
            stageActive: this._stageActive,
            userId: game.user.id,
            intentStamp:this._controlIntentStamp
        });
    },

    // GM 스테이지 상태 수신
    _receiveGMStageState(data) {
        const sender = this._getSocketUser(data?.userId);
        if (!sender?.isGM || sender.id !== this._getPrimaryGM()?.id || typeof data.stageActive !== 'boolean') return;
        if (data.intentStamp != null && !this._isSyncStamp(data.intentStamp)) return;
        if (data.userId === game.user.id && !this._syncReplaying) return;
        if (!this._recordSyncPacket(data)) return;
        if (data.intentStamp) this._controlIntentStamp = {...data.intentStamp};
        this._gmStageActive = !!data.stageActive;
        if (this.isStageCentralControlEnabled()) {
            this._stageActive = this._gmStageActive;
            if (this._stageActive) {
                this._showStageOverlay();
                if (this._activeActors.size > 0) {
                    this._updateStageOverlay();
                }
            } else {
                this._hideStageOverlay();
            }
        }
        this._updatePlayerStageButtonIndicator();
    },

    _receiveGMStageRequest(data) {
        const sender = this._getSocketUser(data?.userId);
        if (!this._isPrimaryGM() || !sender?.isGM || typeof data.stageActive !== 'boolean'
            || !this.isStageCentralControlEnabled()) return;
        if (data.stamp != null && (!this._isSyncStamp(data.stamp) || data.stamp.userId !== sender.id)) return;
        if (this._pendingSyncRequestId) {
            if (!this._waitingGMStageRequest || this._compareSyncStamps(data.stamp,this._waitingGMStageRequest.stamp) >= 0) this._waitingGMStageRequest = data;
            return;
        }
        if (data.stamp && !this._recordSyncPacket(data)
            && !(sender.id === game.user.id && this._compareSyncStamps(data.stamp,this._controlIntentStamp) > 0)) return;
        if (data.stamp && this._compareSyncStamps(data.stamp,this._controlIntentStamp) <= 0) {
            this._broadcastGMStageState(); return;
        }
        this._controlIntentStamp = data.stamp || this._nextSyncStamp();
        this._stageActive = data.stageActive;
        if (this._stageActive) { this._showStageOverlay(); this._updateStageOverlay(); }
        else this._hideStageOverlay();
        this._broadcastGMStageState();
    },

    // 플레이어 스테이지 버튼에 GM 상태 표시 반영
    _updatePlayerStageButtonIndicator() {
        if (game.user?.isGM) return;
        const btn = $(document).find('.lichsoma-speaker-selector .player-stage-toggle-btn');
        if (!btn.length) return;
        if (this.isStageCentralControlEnabled()) {
            btn.attr('aria-pressed', this._stageActive ? 'true' : 'false');
            btn.removeClass('gm-stage-on');
        } else {
            btn.toggleClass('gm-stage-on', this._gmStageActive);
        }
    },

    // 동기화 요청 처리 (GM만 응답)
    _handleSyncRequest(data) {
        if (!game.user?.isGM) return;
        const requester = this._getSocketUser(data?.userId);
        if (!requester || requester.id !== data.requestUserId || typeof data.requestId !== 'string'
            || !data.requestId || data.requestId.length > 256) return;
        const bootstrap = data.bootstrap === true;
        if (bootstrap) {
            // A newly elected/reconnected primary recovers the shared state first.
            if (requester.id !== this._getPrimaryGM()?.id
                || game.user.id !== (data.authorityUserId || this._getBackupGM()?.id)) return;
        } else if (!this._isPrimaryGM()) return;
        if (!this._syncReady || (!bootstrap && this._pendingSyncRequestId && this._isPrimaryGM())) {
            this._waitingSyncRequests.set(requester.id, data);
            return;
        }
        if (bootstrap && !this._hasSynchronizedStage) {
            game.socket.emit('module.lichsoma-speaker-stage', {
                action:'syncUnavailable', userId:game.user.id, targetUserId:requester.id, requestId:data.requestId
            });
            return;
        }

        game.socket.emit('module.lichsoma-speaker-stage', {
            action: 'syncState',
            targetUserId: data.requestUserId,
            userId: game.user.id,
            requestId: data.requestId,
            bootstrap,
            gmStageActive: bootstrap ? this._gmStageActive : this._stageActive,
            controlIntentStamp:this._controlIntentStamp,
            activeStandingActorId: this._activeStandingActorId,
            activePlayerStandingActorId: this._activePlayerStandingActorId,
            lastStandingSpeakerSide: this._lastStandingSpeakerSide,
            actors: this._serializeActiveActors(),
            syncVersions: [...this._syncVersions].map(([key,value]) => [key,{...value}]),
            retirements: [...this._stageRetirements.values()].map(value => ({...value}))
        });
    },

    // 전체 상태 동기화 수신 (요청한 유저만 반영)
    _receiveSyncState(data) {
        const sender = this._getSocketUser(data?.userId);
        const bootstrap = data?.bootstrap === true;
        const validAuthority = bootstrap
            ? this._isPrimaryGM() && sender?.id === this._pendingSyncAuthorityId
            : sender?.id === this._getPrimaryGM()?.id;
        if (!sender?.isGM || !validAuthority || sender.id !== this._pendingSyncAuthorityId
            || !this._pendingSyncRequestId || data.requestId !== this._pendingSyncRequestId
            || typeof data.gmStageActive !== 'boolean' || !this._normalizeSocketActors(data, sender)) return;
        if (data?.targetUserId !== game.user.id) return;
        const versions = this._readSyncVersions(data.syncVersions);
        if (!versions || (data.controlIntentStamp != null && !this._isSyncStamp(data.controlIntentStamp))
            || (data.retirements != null && (!Array.isArray(data.retirements)
            || data.retirements.some(value => !value || typeof value.actorId !== 'string'
                || typeof value.placementId !== 'string' || typeof value.ownerUserId !== 'string'
                || value.actorId.length > 256 || value.placementId.length > 512)))) return;
        const pending = [...this._pendingSyncEvents.values()];
        const unacknowledged = pending.filter(packet => packet.userId === game.user.id
            && packet.action !== 'stageChat' && this._isSyncStamp(packet.stamp)
            && this._compareSyncStamps(packet.stamp,versions.get(this._getSyncPacketStream(packet))) > 0);
        this._clearSyncRetry();
        this._pendingSyncRequestId = null;
        this._pendingSyncAuthorityId = null;
        this._pendingSyncEvents.clear();
        this._syncRetryCount = 0;
        this._syncVersions = versions;
        this._controlIntentStamp = data.controlIntentStamp ? {...data.controlIntentStamp} : null;
        for (const stamp of versions.values()) this._syncClock = Math.max(this._syncClock,stamp.clock);
        for (const value of data.retirements || []) this._rememberStageRetirement(value.actorId,value.placementId,value.ownerUserId);
        this._gmStageActive = !!data.gmStageActive;
        if (this.isStageCentralControlEnabled()) {
            this._stageActive = this._gmStageActive;
            if (this._stageActive) {
                this._showStageOverlay();
            } else {
                this._hideStageOverlay();
            }
        }
        this._updatePlayerStageButtonIndicator();
        // 최초 동기화 응답만 전체 스냅샷으로 취급한다. 이후 GM 갱신은 GM 소유 영역만 교체한다.
        this._receiveStageState(data, { skipSenderCheck: true, fullSnapshot: true, bootstrap });
        this._replaySyncPackets(pending);
        // A primary may have missed packets while loading/reconnecting. Re-send
        // only our unacknowledged operations, with the SAME stamp (idempotent).
        unacknowledged.forEach(packet => game.socket.emit('module.lichsoma-speaker-stage',packet));
        this._hasSynchronizedStage = true;
        if (bootstrap) this._finishPrimaryRecovery();
    },

    _finishPrimaryRecovery() {
        this._clearSyncRetry();
        this._pendingSyncRequestId = null;
        this._pendingSyncAuthorityId = null;
        this._pendingSyncEvents.clear();
        this._hasSynchronizedStage = true;
        let control = this._waitingGMStageRequest;
        const ownUnconfirmed = this._syncRecentPackets.get(`controlRequest:${game.user.id}`);
        if (ownUnconfirmed && this._compareSyncStamps(ownUnconfirmed.stamp,this._controlIntentStamp) > 0
            && (!control || this._compareSyncStamps(ownUnconfirmed.stamp,control.stamp) > 0)) control = ownUnconfirmed;
        this._waitingGMStageRequest = null;
        if (control && this._getSocketUser(control.userId)?.isGM) this._receiveGMStageRequest(control);
        else this._broadcastGMStageState();
        const waiting = [...this._waitingSyncRequests.values()];
        this._waitingSyncRequests.clear();
        waiting.forEach(request => this._handleSyncRequest(request));
    },

    // 스테이지 액터 목록 브로드캐스트
    _broadcastStageState({playerFocus = false} = {}) {
        this._sortStageActors();
        const stageData = {
            action: 'updateStage',
            actors: this._serializeActiveActors(),
            userId: game.user.id
        };
        this._emitStagePacket(stageData);
        if (playerFocus) this._broadcastStageFocus('player', this._activePlayerStandingActorId);
    },

    // 스테이지 액터 목록 수신
    _receiveStageState(data, options = {}) {
        const sender = this._getSocketUser(data?.userId);
        if (!sender || (!sender.isGM && this.isPlayerStageDisabled())) return;
        let incomingActors = this._normalizeSocketActors(data, sender);
        if (!incomingActors) return;
        if (options.fullSnapshot && (!sender.isGM || !(sender.id === this._getPrimaryGM()?.id
            || (options.bootstrap && this._isPrimaryGM())))) return;
        // 자신이 보낸 메시지는 무시
        if (!options.skipSenderCheck && data.userId === game.user.id) return;
        if (!options.fullSnapshot && !this._recordSyncPacket(data)) return;
        incomingActors = incomingActors.filter(value => !this._isStagePlacementRetired(value.id,value)
            && (!this.isPlayerStageDisabled() || this._getSocketUser(value.userId)?.isGM));

        const isFullSnapshot = options.fullSnapshot === true;
        const isGMSender = !!sender?.isGM;
        const previousActiveActorIds = new Set(this._activeActors.keys());

        const normalizeActorData = (actorData) => {
            const actorId = String(actorData.id);
            const actorImg = actorData.img || actorData.emotionPortrait || game.actors.get(actorId)?.img || '';
            const result = {
                img: actorImg,
                name: actorData.name,
                emotionId: actorData.emotionId,
                emotionPortrait: actorData.emotionPortrait,
                isStandingImage: !!actorData.isStandingImage,
                position: actorData.position,
                dialogueVisible: actorData.dialogueVisible,
                userId: actorData.userId,
                emotionUserId: actorData.emotionUserId,
                placementId: actorData.placementId,
                emotionStamp: actorData.emotionStamp
            };
            const existing = this._activeActors.get(actorId);
            if (existing && this._getStagePlacementId(actorId,existing) === actorData.placementId
                && this._compareSyncStamps(existing.emotionStamp,actorData.emotionStamp) > 0) {
                for (const key of ['img','emotionId','emotionPortrait','isStandingImage','emotionUserId','emotionStamp']) result[key] = existing[key];
            }
            return result;
        };

        const removeActor = (actorId) => {
            this._clearTypingEffectsForActor(actorId);
            this._clearStandingFocusForActor(actorId);
            this._activeActors.delete(String(actorId));
        };

        if (isFullSnapshot) {
            const snapshotIds = new Set(incomingActors.map(actor => actor.id));
            for (const actorId of this._activeActors.keys()) if (!snapshotIds.has(actorId)) removeActor(actorId);
            incomingActors.forEach((actorData) => {
                this._storeIncomingStageActor(actorData.id,normalizeActorData(actorData),{retirePrevious:false});
            });
            if (data.activeStandingActorId !== undefined) {
                this._activeStandingActorId = data.activeStandingActorId || null;
            }
            if (data.activePlayerStandingActorId !== undefined) {
                this._activePlayerStandingActorId = data.activePlayerStandingActorId || null;
            }
            this._lastStandingSpeakerSide = data.lastStandingSpeakerSide || null;
        } else if (isGMSender) {
            // Each GM replaces only actors they placed; other GMs and PLs remain intact.
            // 플레이어가 직접 올린 액터와 플레이어 영역 포커스/대화 상태는 각 클라이언트의 최신 상태를 유지한다.
            if (data.activeStandingActorId !== undefined) {
                this._activeStandingActorId = data.activeStandingActorId || null;
            }
            if (data.lastStandingSpeakerSide === 'gm' || data.lastStandingSpeakerSide === 'player') {
                this._lastStandingSpeakerSide = data.lastStandingSpeakerSide;
            }

            const incomingGMActors = incomingActors.filter(actorData => actorData.userId === sender.id
                && this._resolveStagePlacementConflict(actorData));
            const incomingGMIds = new Set(incomingGMActors.map((actorData) => String(actorData.id)));

            for (const [actorId, actorData] of Array.from(this._activeActors.entries())) {
                if (actorData.userId !== sender.id) continue;
                if (incomingGMIds.has(String(actorId))) continue;
                removeActor(actorId);
            }

            incomingGMActors.forEach((actorData) => {
                if (!actorData?.id) return;
                this._storeIncomingStageActor(String(actorData.id),normalizeActorData(actorData));
            });
        } else if (sender) {
            // 플레이어 브로드캐스트는 그 플레이어가 직접 올린 액터만 교체한다.
            const senderId = String(sender.id);
            const incomingOwned = incomingActors.filter((actorData) => String(actorData?.userId || '') === senderId
                && this._resolveStagePlacementConflict(actorData));
            const incomingOwnedIds = new Set(incomingOwned.map((actorData) => String(actorData.id)));

            for (const [actorId, actorData] of Array.from(this._activeActors.entries())) {
                if (String(actorData?.userId || '') !== senderId) continue;
                if (incomingOwnedIds.has(String(actorId))) continue;
                removeActor(actorId);
            }

            incomingOwned.forEach((actorData) => {
                if (!actorData?.id) return;
                this._storeIncomingStageActor(String(actorData.id),normalizeActorData(actorData));
            });

            const requestedPlayerFocus = data.activePlayerStandingActorId ? String(data.activePlayerStandingActorId) : null;
            if (requestedPlayerFocus && incomingOwnedIds.has(requestedPlayerFocus)) {
                this._activePlayerStandingActorId = requestedPlayerFocus;
            } else if (this._activePlayerStandingActorId
                && String(this._activeActors.get(String(this._activePlayerStandingActorId))?.userId || '') === senderId
                && !incomingOwnedIds.has(String(this._activePlayerStandingActorId))) {
                this._activePlayerStandingActorId = null;
            }
        }

        this._sortStageActors();

        if (this._activeStandingActorId && (!this._activeActors.has(String(this._activeStandingActorId))
            || this._isPlayerStandingActor(this._activeStandingActorId))) {
            this._activeStandingActorId = null;
        }
        if (this._activePlayerStandingActorId && (!this._activeActors.has(String(this._activePlayerStandingActorId))
            || !this._isPlayerStandingActor(this._activePlayerStandingActorId))) {
            this._activePlayerStandingActorId = null;
        }
        for (const side of ['gm', 'player']) {
            const dialogueActorId = this._standingDialogueActorIds?.[side];
            if (dialogueActorId && !this._activeActors.has(String(dialogueActorId))) {
                this._standingDialogueActorIds[side] = null;
                this._clearStandingDialogueSide(side);
            }
        }

        const incomingActorIds = new Set(this._activeActors.keys());
        const actorSetChanged = previousActiveActorIds.size !== incomingActorIds.size
            || [...previousActiveActorIds].some((actorId) => !incomingActorIds.has(String(actorId)));

        this._updateStageOverlay();
        if (this._stageActive) {
            this._showStageOverlay();
        } else {
            this._hideStageOverlay();
        }

        if (game.user.isGM) {
            const backstageExists = $(document).find('.lichsoma-speaker-backstage-container').length > 0;
            if (actorSetChanged || !backstageExists) {
                this._renderBackstage($(document));
            } else {
                this._updateBackstagePortraits({ fade: true });
            }
        } else {
            this._syncPlayerActorToggleButtonWithStage();
        }
        this._flushPendingStageFocus();
        this._flushPendingStageChat();
    },
};
