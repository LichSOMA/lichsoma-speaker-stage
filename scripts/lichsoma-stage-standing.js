/** standing: methods are attached to SpeakerStage; this is the shared stage controller. */

export const stageStandingMethods = {
    _refreshStandingMode() {
        this._applyStageModeClass();
        if (!this.isStandingEnabled()) {
            $(document).find('.lichsoma-standing-manage-btn').remove();
        }
        this._updateStageActorImages();
        this._updateStageOverlay();
        if (game.user?.isGM) {
            this._renderBackstage($(document));
            this._broadcastStageState();
        } else {
            this._renderPlayerStageToggle($(document));
        }
    },

    _applyStageModeClass() {
        const overlay = $('#lichsoma-stage-overlay');
        if (!overlay.length) return;
        // Existing CSS hook now describes the shared layout, not the image setting.
        overlay.addClass('standing-mode');
    },

    _getStageActorOwnerUser(actorData) {
        const userId = actorData?.userId;
        return userId ? game.users?.get?.(userId) || null : null;
    },

    _isPlayerStandingActorData(actorData) {
        const owner = this._getStageActorOwnerUser(actorData);
        // 이전 버전 데이터처럼 올린 사용자 정보가 없으면 GM 쪽으로 보수적으로 분류한다.
        return !!owner && !owner.isGM;
    },

    _isPlayerStandingActor(actorId) {
        return this._isPlayerStandingActorData(this._activeActors.get(String(actorId)) || this._activeActors.get(actorId));
    },

    _clearStandingFocusForActor(actorId) {
        const key = actorId == null ? null : String(actorId);
        if (!key) return;
        if (String(this._activeStandingActorId || '') === key) this._activeStandingActorId = null;
        if (String(this._activePlayerStandingActorId || '') === key) this._activePlayerStandingActorId = null;
        for (const side of ['gm', 'player']) {
            if (String(this._standingDialogueActorIds?.[side] || '') === key) {
                this._standingDialogueActorIds[side] = null;
                this._clearStandingDialogueSide(side);
            }
        }
    },

    setupStandingActorSheetButton() {
        Hooks.on('renderActorSheet', (app, html) => this._injectStandingButton(app, html, false));
        Hooks.on('renderActorSheetV2', (app, html) => this._injectStandingButton(app, html, true));
    },

    _injectStandingButton(app, html, fromActorSheetV2Hook = false) {
        const actor = app.actor || app.object || app.document;
        if (!actor) return;

        const $root = html?.jquery ? html : $(html);
        const windowHeader = $root.find('.window-header');
        if (!windowHeader.length) return;

        windowHeader.find('.lichsoma-standing-manage-btn').remove();
        if (!this.isStandingEnabled()) return;

        const canEdit = actor.isOwner || game.user?.isGM;
        if (!canEdit) return;

        const manageTitle = game.i18n.localize('SPEAKERSTAGE.Standing.Manage') || '스탠딩 관리';
        const standingLabel = game.i18n.localize('SPEAKERSTAGE.Standing.Label') || '스탠딩';
        const button = $(`
            <button type="button" class="header-control lichsoma-standing-manage-btn" title="${manageTitle}" aria-label="${manageTitle}">
                <i class="fa-solid fa-person"></i>
                <span class="lichsoma-standing-manage-label">${standingLabel}</span>
            </button>
        `);

        if (!fromActorSheetV2Hook) {
            const sheetRoot = windowHeader.closest('.application, .window-app');
            const isAppV2 = windowHeader.closest('.application-v2').length > 0;
            if (sheetRoot.length && !isAppV2) {
                button.addClass('lichsoma-standing-manage-btn--legacy-sheet');
            }
        }

        const stopDragHandshake = (ev) => ev.stopPropagation();
        button.on('pointerdown', stopDragHandshake);
        button.on('mousedown', stopDragHandshake);
        button.on('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void this._openStandingManager(actor);
        });

        // 스피커 셀렉터의 감정 버튼이 이미 있으면 항상 그 바로 왼쪽에 둔다.
        // 감정 버튼이 아직 주입되기 전이면 기존처럼 toggleControls 앞에 두면,
        // 이후 감정 버튼이 toggleControls 바로 앞에 들어와 결과적으로 스탠딩 → 감정 순서가 된다.
        const emotionBtn = windowHeader.find('.lichsoma-emotion-manage-btn').first();
        if (emotionBtn.length) {
            emotionBtn.before(button);
        } else {
            const toggleBtn = windowHeader.find('button[data-action="toggleControls"]');
            if (toggleBtn.length) {
                toggleBtn.first().before(button);
            } else {
                const title = windowHeader.find('.window-title').first();
                if (title.length) title.after(button);
                else windowHeader.prepend(button);
            }
        }
    },

    async _openStandingManager(actor) {
        if (!actor) return;

        if (this._standingManagerApp?.rendered) {
            await this._standingManagerApp.close({ animate: true });
            return;
        }

        this._standingManagerApp = new this.applications.LichsomaStandingManagerApp({ actor });
        await this._standingManagerApp.render({ force: true });
    },

    _openImageFilePicker({ current, callback }) {
        const FilePickerImpl = LichsomaSpeakerStageCompat.FilePicker || globalThis.FilePicker;
        if (!FilePickerImpl) return;
        new FilePickerImpl({
            type: 'image',
            current: current || '',
            callback
        }).render(true);
    },

    _getSelectorActorEmotions(actor) {
        if (!actor) return {};
        try {
            const fromSelector = this.ActorEmotions?._getActorEmotions?.(actor);
            if (fromSelector && typeof fromSelector === 'object' && !Array.isArray(fromSelector)) return fromSelector;
        } catch (error) {
            // 하위 호환 폴백을 사용한다.
        }

        const fromFlag = actor.getFlag?.(this.SELECTOR_MODULE_ID, 'emotions');
        if (fromFlag && typeof fromFlag === 'object' && !Array.isArray(fromFlag)) return fromFlag;

        const fromSystem = actor.system?.emotions;
        if (fromSystem && typeof fromSystem === 'object' && !Array.isArray(fromSystem)) return fromSystem;

        return {};
    },

    _normalizeActorEmotion(actor, emotion) {
        if (!actor || !emotion?.emotionId) return null;

        const emotionId = String(emotion.emotionId);
        const emotions = this._getSelectorActorEmotions(actor);
        const current = emotions?.[emotionId];
        if (!current) return null;

        return {
            emotionId,
            emotionName: current.name || emotion.emotionName || null,
            emotionPortrait: current.portrait || emotion.emotionPortrait || null
        };
    },

    _sanitizeActorStandings(actor, options = {}) {
        if (!actor) return { default: '', emotions: {}, changed: false };

        const data = actor.getFlag?.(this.MODULE_ID, this.STANDING_FLAG);
        const defaultPath = typeof data?.default === 'string' ? data.default : '';
        const rawEmotions = data?.emotions && typeof data.emotions === 'object' && !Array.isArray(data.emotions)
            ? data.emotions
            : {};
        const selectorEmotions = this._getSelectorActorEmotions(actor);
        const validEmotionIds = new Set(Object.keys(selectorEmotions || {}).map((id) => String(id)));
        const emotions = {};
        let changed = false;

        Object.entries(rawEmotions).forEach(([emotionId, value]) => {
            const id = String(emotionId);
            const path = typeof value === 'string' ? value : '';
            if (validEmotionIds.has(id)) {
                if (path) emotions[id] = path;
            } else {
                changed = true;
            }
        });

        if (Object.keys(rawEmotions).length !== Object.keys(emotions).length) changed = true;

        return {
            default: defaultPath,
            emotions,
            changed
        };
    },

    _getActorStandings(actor) {
        const { default: defaultPath, emotions } = this._sanitizeActorStandings(actor);
        return {
            default: defaultPath,
            emotions
        };
    },

    async _pruneActorStandingEmotionOrphans(actor) {
        if (!actor || !game.user?.isGM) return false;

        const sanitized = this._sanitizeActorStandings(actor);
        if (!sanitized.changed) return false;

        try {
            await actor.unsetFlag(this.MODULE_ID, this.STANDING_FLAG);
            if (sanitized.default || Object.keys(sanitized.emotions).length > 0) {
                await actor.setFlag(this.MODULE_ID, this.STANDING_FLAG, {
                    default: sanitized.default,
                    emotions: sanitized.emotions
                });
            }
            Hooks.callAll('lichsomaSpeakerStageStandingsUpdated', actor);
            return true;
        } catch (error) {
            console.warn('LichSOMA Speaker Stage | 삭제된 감정의 스탠딩 정리 실패:', error);
            return false;
        }
    },

    _getActorStandingPath(actor, emotionId = null) {
        const standings = this._getActorStandings(actor);
        const emotionStanding = emotionId ? String(standings.emotions?.[emotionId] || '').trim() : '';
        const defaultStanding = String(standings.default || '').trim();
        return emotionStanding || defaultStanding || '';
    },

    _ensureStandingStageStructure(container) {
        if (!container?.length) return null;

        const directStandingLayer = container.children('.stage-standing-actor-layer');
        if (!directStandingLayer.length) {
            const existingWrappers = container.children('.stage-character-wrapper');
            container.prepend('<div class="stage-standing-actor-layer"></div>');
            const layer = container.children('.stage-standing-actor-layer');
            existingWrappers.appendTo(layer);
        }

        // v2.3.17 이하의 단일 대화창 구조가 남아 있으면 새 좌/우 구조로 교체한다.
        container.children('.stage-standing-dialogue-name, .stage-standing-dialogue-box').remove();

        for (const side of ['gm', 'player']) {
            if (!container.children(`.stage-standing-dialogue-region-${side}`).length) {
                container.append(`
                    <div class="stage-standing-dialogue-region stage-standing-dialogue-region-${side}" data-standing-side="${side}">
                        <div class="stage-standing-dialogue-name character-name"></div>
                        <div class="stage-standing-dialogue-box">
                            <div class="dialogue-content"></div>
                        </div>
                    </div>
                `);
            }
        }

        return container.children('.stage-standing-actor-layer');
    },

    _getStandingLayout(index, count, start = 8, end = 92, options = {}) {
        const safeCount = Math.max(1, Number(count) || 1);
        const safeStart = Number(start);
        const safeEnd = Number(end);
        const minX = Math.min(safeStart, safeEnd);
        const maxX = Math.max(safeStart, safeEnd);
        const available = Math.max(0, maxX - minX);
        const preferredGap = Math.max(0, Number(options.gap ?? 18));
        const maxSpan = Math.max(0, Math.min(available, Number(options.maxSpan ?? available)));
        const span = safeCount <= 1 ? 0 : Math.min(maxSpan, preferredGap * (safeCount - 1));
        const requestedAnchor = Number(options.anchor);
        const anchor = Number.isFinite(requestedAnchor) ? requestedAnchor : (minX + maxX) / 2;
        const unclampedStart = anchor - span / 2;
        const clusterStart = Math.max(minX, Math.min(maxX - span, unclampedStart));
        const x = safeCount <= 1
            ? Math.max(minX, Math.min(maxX, anchor))
            : clusterStart + (span * index) / (safeCount - 1);
        const y = Math.max(0, Math.min(26, Math.abs(index - (safeCount - 1) / 2) * 4));
        return { x, y };
    },

    _getStandingGroups(actors = Array.from(this._activeActors.entries())) {
        const gm = [];
        const player = [];
        for (const entry of actors) {
            const actorData = entry?.[1];
            (this._isPlayerStandingActorData(actorData) ? player : gm).push(entry);
        }
        return { gm, player };
    },

    _getStandingLayoutMap(actors) {
        const layouts = new Map();
        const entries = Array.isArray(actors) ? actors : [];
        if (!entries.length) return layouts;

        const groups = this._getStandingGroups(entries);
        const split = groups.gm.length > 0 && groups.player.length > 0;

        // 양쪽 진영이 함께 있으면 각 절반의 중앙에, 한쪽만 있으면 화면 전체 중앙에 군집한다.
        const gmLayout = split
            ? { start: 5, end: 47, anchor: 26, gap: 14, maxSpan: 32 }
            : { start: 10, end: 90, anchor: 50, gap: 18, maxSpan: 60 };
        const playerLayout = split
            ? { start: 53, end: 95, anchor: 74, gap: 14, maxSpan: 32 }
            : { start: 10, end: 90, anchor: 50, gap: 18, maxSpan: 60 };

        const addGroupLayouts = (groupEntries, activeId, config, side) => {
            if (!groupEntries.length) return;

            const normalizedActiveId = activeId && groupEntries.some(([actorId]) => String(actorId) === String(activeId))
                ? String(activeId)
                : null;
            const slotByActorId = new Map();
            const count = groupEntries.length;

            // 슬롯 좌표는 발화자 변경과 무관하게 항상 대칭으로 고정한다.
            // 홀수 인원은 0을 포함하고, 짝수 인원은 중앙 쌍(-0.5, +0.5)을 사용한다.
            const fixedSlots = Array.from({ length: count }, (_, index) => index - (count - 1) / 2);
            groupEntries.forEach(([actorId], index) => {
                slotByActorId.set(String(actorId), fixedSlots[index]);
            });

            if (normalizedActiveId) {
                // 발화자는 고정 슬롯 중 진영별 강조 슬롯으로만 교체한다.
                // 홀수: 정중앙(0), 짝수 GM: 중앙 왼쪽(-0.5), 플레이어: 중앙 오른쪽(+0.5).
                // 나머지 슬롯 좌표는 변하지 않으므로 발화 때 군집 전체가 밀리지 않는다.
                const preferredActiveSlot = count % 2 === 1
                    ? 0
                    : (side === 'player' ? 0.5 : -0.5);
                const activeEntryIndex = groupEntries.findIndex(([actorId]) => String(actorId) === normalizedActiveId);
                const preferredEntryIndex = fixedSlots.findIndex((slot) => slot === preferredActiveSlot);

                if (activeEntryIndex >= 0 && preferredEntryIndex >= 0 && activeEntryIndex !== preferredEntryIndex) {
                    const activeActorId = String(groupEntries[activeEntryIndex][0]);
                    const preferredActorId = String(groupEntries[preferredEntryIndex][0]);
                    const activeOriginalSlot = slotByActorId.get(activeActorId);
                    slotByActorId.set(activeActorId, preferredActiveSlot);
                    slotByActorId.set(preferredActorId, activeOriginalSlot);
                }
            }

            const slots = Array.from(slotByActorId.values());
            const minSlot = Math.min(...slots);
            const maxSlot = Math.max(...slots);
            const slotSpan = Math.max(0, maxSlot - minSlot);
            const available = Math.max(0, config.end - config.start);
            const maxSpan = Math.max(0, Math.min(available, config.maxSpan));
            const gap = slotSpan > 0
                ? Math.min(config.gap, maxSpan / slotSpan, available / slotSpan)
                : 0;

            groupEntries.forEach(([actorId], sideIndex) => {
                const slot = slotByActorId.get(String(actorId)) ?? 0;
                const x = Math.max(config.start, Math.min(config.end, config.anchor + slot * gap));
                const y = Math.max(0, Math.min(26, Math.abs(slot) * 4));
                layouts.set(String(actorId), { x, y, side, sideIndex, slot });
            });
        };

        addGroupLayouts(groups.gm, this._activeStandingActorId, gmLayout, 'gm');
        addGroupLayouts(groups.player, this._activePlayerStandingActorId, playerLayout, 'player');

        return layouts;
    },

    _getFrontStandingSide(groups = this._getStandingGroups()) {
        const hasGM = groups.gm.length > 0;
        const hasPlayer = groups.player.length > 0;
        if (hasGM && !hasPlayer) return 'gm';
        if (hasPlayer && !hasGM) return 'player';
        if (!hasGM && !hasPlayer) return null;
        if (this._lastStandingSpeakerSide === 'gm' || this._lastStandingSpeakerSide === 'player') {
            return this._lastStandingSpeakerSide;
        }
        return 'gm';
    },

    _getStandingZIndex(side, active, sideOrder, groups = this._getStandingGroups()) {
        const frontSide = this._getFrontStandingSide(groups);
        const sideBase = side === frontSide ? 200 : 100;
        return active ? sideBase + 80 : sideBase + 10 + Math.max(0, Number(sideOrder) || 0);
    },

    _getStandingSideForActor(actorId) {
        return this._isPlayerStandingActor(actorId) ? 'player' : 'gm';
    },

    _getStandingDialogueRegion(side) {
        return $(`#lichsoma-stage-overlay .stage-standing-dialogue-region-${side}`);
    },

    _clearStandingDialogueSide(side) {
        const safeSide = side === 'player' ? 'player' : 'gm';
        const region = this._getStandingDialogueRegion(safeSide);
        this._clearTypingEffectsForActor(`standing:${safeSide}`);
        region.find('.stage-standing-dialogue-name').text('');
        const content = region.find('.stage-standing-dialogue-box .dialogue-content');
        content.stop?.(true, true);
        content.css({ opacity: '', transition: '' }).empty();
    },

    _getFallbackStandingActorId(side = 'gm') {
        const entries = Array.from(this._activeActors.entries())
            .filter(([, actorData]) => (side === 'player') === this._isPlayerStandingActorData(actorData));
        const selected = this._getSelectedSpeakerActorId();
        if (selected && entries.some(([actorId]) => String(actorId) === String(selected))) return String(selected);
        const remembered = side === 'player' ? this._activePlayerStandingActorId : this._activeStandingActorId;
        if (remembered && entries.some(([actorId]) => String(actorId) === String(remembered))) return String(remembered);
        return entries[0]?.[0] ? String(entries[0][0]) : null;
    },

    _setActiveStandingActor(actorId, { broadcast = false, allowFallback = false } = {}) {
        const requestedId = actorId ? String(actorId) : null;
        if (requestedId && this._isPlayerStandingActor(requestedId)) {
            const previousPlayerId = this._activePlayerStandingActorId;
            this._setActivePlayerStandingActor(requestedId);
            if (broadcast && game.user?.isGM && previousPlayerId !== requestedId) this._broadcastStageFocus('player',requestedId);
            return;
        }

        const nextId = requestedId && this._activeActors.has(requestedId)
            ? requestedId
            : (allowFallback ? this._getFallbackStandingActorId('gm') : null);
        const previousId = this._activeStandingActorId || null;
        this._activeStandingActorId = nextId || null;

        if (previousId !== this._activeStandingActorId) {
            this._updateStandingStageOverlay();
        } else {
            this._updateStandingFocus({ allowFallback });
        }

        if (broadcast && game.user?.isGM && previousId !== this._activeStandingActorId) this._broadcastStageFocus('gm',this._activeStandingActorId);
    },

    _broadcastStageFocus(side, actorId) {
        const actorData = actorId ? this._activeActors.get(String(actorId)) : null;
        this._emitStagePacket({action:'updateStageFocus', side, actorId:actorId || null,
            placementId:actorData ? this._getStagePlacementId(actorId,actorData) : null});
    },

    _receiveStageFocus(data) {
        const sender = this._getSocketUser(data?.userId);
        if (!sender || (!sender.isGM && this.isPlayerStageDisabled())
            || (sender.id === game.user.id && !this._syncReplaying)
            || !['gm','player'].includes(data.side) || (data.actorId != null && typeof data.actorId !== 'string')) return;
        if (!sender.isGM) {
            if (data.side !== 'player') return;
            const actor = data.actorId ? game.actors.get(data.actorId) : null;
            const currentId = this._activePlayerStandingActorId;
            if (actor) {
                if ((sender.character?.id ?? sender.character) !== actor.id && actor.testUserPermission?.(sender,'OWNER') !== true) return;
            } else if (data.actorId || (currentId && this._activeActors.get(currentId)?.userId !== sender.id)) return;
        }
        if (data.placementId != null && (typeof data.placementId !== 'string' || data.placementId.length > 512)) return;
        if (data.actorId && data.placementId && this._stageRetirements.has(`${data.actorId}:${data.placementId}`)) return;
        if (!this._recordSyncPacket(data)) return;
        this._pendingStageFocus.set(data.side,data);
        this._flushPendingStageFocus();
    },

    _flushPendingStageFocus() {
        for (const [side,data] of this._pendingStageFocus) {
            if (data.stamp && this._compareSyncStamps(data.stamp,this._syncVersions.get(`focus:${side}`)) < 0) {
                this._pendingStageFocus.delete(side); continue;
            }
            if (data.actorId) {
                const actorData = this._activeActors.get(data.actorId);
                if (!actorData) continue;
                if (data.placementId && this._getStagePlacementId(data.actorId,actorData) !== data.placementId) {
                    if (this._stageRetirements.has(`${data.actorId}:${data.placementId}`)) this._pendingStageFocus.delete(side);
                    continue;
                }
                if (this._getStandingSideForActor(data.actorId) !== side
                    || (!this._getSocketUser(data.userId)?.isGM && actorData.userId !== data.userId)) {
                    this._pendingStageFocus.delete(side); continue;
                }
            }
            this._pendingStageFocus.delete(side);
            if (side === 'gm') this._setActiveStandingActor(data.actorId);
            else this._setActivePlayerStandingActor(data.actorId);
        }
    },

    _setActivePlayerStandingActor(actorId) {
        const requestedId = actorId ? String(actorId) : null;
        const nextId = requestedId && this._activeActors.has(requestedId) && this._isPlayerStandingActor(requestedId)
            ? requestedId
            : null;
        const previousId = this._activePlayerStandingActorId || null;
        this._activePlayerStandingActorId = nextId;
        if (previousId !== nextId) {
            this._updateStandingStageOverlay();
        } else {
            this._updateStandingFocus();
        }
    },

    _updateStandingFocus({ allowFallback = false } = {}) {
        const overlay = $('#lichsoma-stage-overlay');
        const selectedId = this._getSelectedSpeakerActorId();

        let gmActiveId = this._activeStandingActorId && this._activeActors.has(String(this._activeStandingActorId))
            && !this._isPlayerStandingActor(this._activeStandingActorId)
            ? String(this._activeStandingActorId)
            : null;

        if (!gmActiveId && allowFallback) {
            gmActiveId = selectedId && this._activeActors.has(String(selectedId)) && !this._isPlayerStandingActor(selectedId)
                ? String(selectedId)
                : (allowFallback ? this._getFallbackStandingActorId('gm') : null);
            this._activeStandingActorId = gmActiveId;
        }

        let playerActiveId = this._activePlayerStandingActorId
            && this._activeActors.has(String(this._activePlayerStandingActorId))
            && this._isPlayerStandingActor(this._activePlayerStandingActorId)
            ? String(this._activePlayerStandingActorId)
            : null;
        if (!playerActiveId && allowFallback) {
            playerActiveId = this._getFallbackStandingActorId('player');
        }
        this._activePlayerStandingActorId = playerActiveId;

        const groups = this._getStandingGroups();
        if (this._lastStandingSpeakerSide === 'gm' && !groups.gm.length) {
            this._lastStandingSpeakerSide = groups.player.length ? 'player' : null;
        } else if (this._lastStandingSpeakerSide === 'player' && !groups.player.length) {
            this._lastStandingSpeakerSide = groups.gm.length ? 'gm' : null;
        }
        const frontSide = this._getFrontStandingSide(groups);
        const container = overlay.find('.stage-characters-container');
        container.toggleClass('standing-front-side-gm', frontSide === 'gm');
        container.toggleClass('standing-front-side-player', frontSide === 'player');
        const gmOrder = new Map(groups.gm.map(([actorId], index) => [String(actorId), index]));
        const playerOrder = new Map(groups.player.map(([actorId], index) => [String(actorId), index]));

        overlay.find('.stage-character-wrapper').each((index, element) => {
            const actorId = String(element.getAttribute('data-actor-id') || '');
            if (!actorId) return;
            const isPlayer = this._isPlayerStandingActor(actorId);
            const active = isPlayer ? actorId === playerActiveId : actorId === gmActiveId;
            element.classList.toggle('is-active-standing', active);
            element.classList.toggle('is-inactive-standing', !active);
            const side = isPlayer ? 'player' : 'gm';
            element.classList.toggle('is-dialogue-standing', actorId === String(this._standingDialogueActorIds?.[side] || ''));
            element.classList.toggle('standing-side-player', isPlayer);
            element.classList.toggle('standing-side-gm', !isPlayer);

            const sideOrder = (isPlayer ? playerOrder : gmOrder).get(actorId) ?? index;
            const zIndex = this._getStandingZIndex(side, active, sideOrder, groups);
            element.style.setProperty('--standing-z', String(zIndex));
        });

        for (const [side, activeId] of [['gm', gmActiveId], ['player', playerActiveId]]) {
            let dialogueActorId = this._standingDialogueActorIds?.[side];
            if (dialogueActorId && (!this._activeActors.has(String(dialogueActorId)) || this._getStandingSideForActor(dialogueActorId) !== side)) {
                this._standingDialogueActorIds[side] = null;
                dialogueActorId = null;
                this._clearStandingDialogueSide(side);
            }
            const displayActorId = dialogueActorId || activeId;
            const dialogueActor = displayActorId ? this._activeActors.get(String(displayActorId)) : null;
            const nameEl = overlay.find(`.stage-standing-dialogue-region-${side} .stage-standing-dialogue-name`);
            if (nameEl.length) nameEl.text(dialogueActor?.name || '');
        }
    },

    _updateStandingStageOverlay() {
        const container = $('#lichsoma-stage-overlay .stage-characters-container');
        if (!container.length) return;

        const actors = Array.from(this._activeActors.entries());

        if (!actors.length) {
            container[0]?.style.setProperty('--stage-standing-count', '0');
            container[0]?.style.setProperty('--stage-standing-gm-count', '0');
            container[0]?.style.setProperty('--stage-standing-player-count', '0');
            // 진영 클래스는 대화창 페이드아웃이 끝날 때 제거한다.
            const layer = container.children('.stage-standing-actor-layer');
            layer.find('.stage-character-wrapper').each((index, element) => {
                const actorId = element.getAttribute('data-actor-id');
                this._fadeOutStandingStageWrapper(element, actorId);
            });
            container.children('.stage-character-wrapper').each((index, element) => {
                const actorId = element.getAttribute('data-actor-id');
                this._fadeOutStandingStageWrapper(element, actorId);
            });
            this._activeStandingActorId = null;
            this._activePlayerStandingActorId = null;
            this._standingDialogueActorIds = { gm: null, player: null };
            this._lastStandingSpeakerSide = null;
            this._fadeOutStandingDialogueAndClear(container);
            return;
        }

        this._cancelStandingDialogueExit();
        const layer = this._ensureStandingStageStructure(container);
        if (!layer?.length) return;

        const actorIds = new Set(actors.map(([actorId]) => actorId));

        layer.find('.stage-character-wrapper').each((index, element) => {
            const actorId = element.getAttribute('data-actor-id');
            if (!actorIds.has(actorId)) {
                this._fadeOutStandingStageWrapper(element, actorId);
            }
        });

        const groups = this._getStandingGroups(actors);
        container[0]?.style.setProperty('--stage-standing-count', String(actors.length || 0));
        container[0]?.style.setProperty('--stage-standing-gm-count', String(groups.gm.length));
        container[0]?.style.setProperty('--stage-standing-player-count', String(groups.player.length));
        container.toggleClass('has-gm-standings', groups.gm.length > 0);
        container.toggleClass('has-player-standings', groups.player.length > 0);
        if (this._lastStandingSpeakerSide === 'gm' && !groups.gm.length) {
            this._lastStandingSpeakerSide = groups.player.length ? 'player' : null;
        } else if (this._lastStandingSpeakerSide === 'player' && !groups.player.length) {
            this._lastStandingSpeakerSide = groups.gm.length ? 'gm' : null;
        }

        if (!groups.gm.length) {
            this._standingDialogueActorIds.gm = null;
            this._clearStandingDialogueSide('gm');
        }
        if (!groups.player.length) {
            this._standingDialogueActorIds.player = null;
            this._clearStandingDialogueSide('player');
        }

        if (this._activeStandingActorId && (!this._activeActors.has(String(this._activeStandingActorId)) || this._isPlayerStandingActor(this._activeStandingActorId))) {
            this._activeStandingActorId = null;
        }
        if (this._activePlayerStandingActorId && (!this._activeActors.has(String(this._activePlayerStandingActorId)) || !this._isPlayerStandingActor(this._activePlayerStandingActorId))) {
            this._activePlayerStandingActorId = null;
        }

        const standingLayoutMap = this._getStandingLayoutMap(actors);
        const frontStandingSide = this._getFrontStandingSide(groups);
        container.toggleClass('standing-front-side-gm', frontStandingSide === 'gm');
        container.toggleClass('standing-front-side-player', frontStandingSide === 'player');

        actors.forEach(([actorId, actorData], index) => {
            const layout = standingLayoutMap.get(String(actorId)) || this._getStandingLayout(index, actors.length);
            let wrapper = layer.find(`.stage-character-wrapper[data-actor-id="${actorId}"]`);
            const isPlayerSide = layout.side === 'player';
            const isActive = isPlayerSide
                ? String(this._activePlayerStandingActorId || '') === String(actorId)
                : String(this._activeStandingActorId || '') === String(actorId);

            if (wrapper.length && wrapper.hasClass('removing')) {
                this._clearActorExitTimers(actorId);
                wrapper.remove();
                wrapper = $();
            }

            if (!wrapper.length) {
                layer.append(this._createStageCharacterWrapper(actorId, actorData, `standing preparing standing-side-${isPlayerSide ? 'player' : 'gm'} ${actorData.isStandingImage ? 'is-standing-image' : 'is-portrait-fallback'} ${isActive ? 'is-active-standing' : 'is-inactive-standing'}`));
                wrapper = layer.find(`.stage-character-wrapper[data-actor-id="${actorId}"]`);
                requestAnimationFrame(() => {
                    wrapper.removeClass('preparing').addClass('slide-in-new');
                    setTimeout(() => wrapper.removeClass('slide-in-new'), 500);
                });
            }

            wrapper.removeClass('left center right auto expanding shrinking removing standing-side-gm standing-side-player');
            wrapper.addClass(`standing standing-side-${isPlayerSide ? 'player' : 'gm'}`);
            wrapper.toggleClass('is-standing-image', !!actorData.isStandingImage);
            wrapper.toggleClass('is-portrait-fallback', !actorData.isStandingImage);
            wrapper.toggleClass('is-active-standing', isActive);
            wrapper.toggleClass('is-inactive-standing', !isActive);
            wrapper.toggleClass('is-dialogue-standing', String(this._standingDialogueActorIds?.[isPlayerSide ? 'player' : 'gm'] || '') === String(actorId));
            wrapper.css({
                '--standing-x': `${layout.x}%`,
                '--standing-y': `${layout.y}px`,
                '--standing-z': String(this._getStandingZIndex(isPlayerSide ? 'player' : 'gm', isActive, layout.sideIndex ?? index, groups))
            });

            const portraitImg = wrapper.find('.stage-character-portrait img');
            if (portraitImg.attr('src') !== actorData.img) {
                this._swapImageWithFade(portraitImg, actorData.img);
            }
        });

        this._updateStandingFocus();
        this._syncStageRemovalControls();
    },
};
