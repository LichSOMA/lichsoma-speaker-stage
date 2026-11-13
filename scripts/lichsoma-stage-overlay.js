/** overlay: methods are attached to SpeakerStage; this is the shared stage controller. */
import { safeStageImageSource } from './lichsoma-stage-dialogue.js';

export const stageOverlayMethods = {
    /** 소켓 등으로 스테이지 액터 목록이 바뀐 뒤 PL 캐릭터 토글(마스크 버튼) pressed 상태 동기화 */
    _syncPlayerActorToggleButtonWithStage() {
        if (game.user?.isGM) return;
        const characterId =
            game.user.character instanceof Actor ? game.user.character.id : game.user.character;
        const onStage = !!(characterId && this._activeActors.has(characterId));
        $(document)
            .find('.lichsoma-speaker-selector .player-actor-toggle-btn')
            .attr('aria-pressed', onStage ? 'true' : 'false');
    },

    _canRemoveStageActor(actorId, user = game.user) {
        const actorData = this._activeActors.get(String(actorId));
        return !!actorData && !!user && (user.isGM || (!this.isPlayerStageDisabled() && actorData.userId === user.id));
    },

    _syncStageRemovalControls() {
        document.querySelectorAll('#lichsoma-stage-overlay .stage-character-wrapper[data-actor-id]').forEach(wrapper => {
            const permitted = !wrapper.matches('.removing, .shrinking')
                && this._canRemoveStageActor(wrapper.dataset.actorId);
            wrapper.querySelector('.stage-character-portrait')?.classList.toggle('stage-removable', permitted);
        });
    },

    _requestActorRemoval(actorId) {
        const key = String(actorId);
        if (!this._canRemoveStageActor(key)) return false;
        const actorData = this._activeActors.get(key);
        const placementId = this._getStagePlacementId(key,actorData);
        this._rememberStageRetirement(key,placementId,actorData.userId);
        this._removeStageActorLocally(key);
        // An explicit removal is necessary: normal GM snapshots preserve PL actors.
        this._emitStagePacket({
            action: 'removeStageActor', actorId: key, userId: game.user.id,
            placementId, ownerUserId:actorData.userId
        });
        return true;
    },

    _receiveActorRemoval(data) {
        if (!data || (data.userId === game.user.id && !this._syncReplaying)
            || typeof data.actorId !== 'string' || data.actorId.length > 256) return;
        const sender = this._getSocketUser(data.userId);
        if (!sender || (!sender.isGM && this.isPlayerStageDisabled())) return;
        const current = this._activeActors.get(data.actorId);
        const ownerUserId = data.ownerUserId ?? current?.userId;
        const placementId = data.placementId ?? (current ? this._getStagePlacementId(data.actorId,current) : null);
        if (!sender.isGM && sender.id !== ownerUserId) return;
        if (typeof placementId !== 'string' || placementId.length > 512 || typeof ownerUserId !== 'string') return;
        if (!sender.isGM) {
            const samePlacement = current && this._getStagePlacementId(data.actorId,current) === placementId;
            if (samePlacement && current.userId !== sender.id) return;
            if (!samePlacement && !placementId.startsWith(`${sender.id}:`)
                && placementId !== `legacy:${sender.id}:${data.actorId}`) return;
        }
        if (!this._recordSyncPacket(data)) return;
        this._rememberStageRetirement(data.actorId,placementId,ownerUserId);
        if (!current || current.userId !== ownerUserId || this._getStagePlacementId(data.actorId,current) !== placementId) return;
        this._removeStageActorLocally(data.actorId);
    },

    _removeStageActorLocally(actorId) {
        const wasSelected = this._isActorSelectedInSelector(actorId);
        this._clearTypingEffectsForActor(actorId);
        this._clearStandingFocusForActor(actorId);
        this._activeActors.delete(actorId);
        if (wasSelected) this._resetSpeakerSelectorToDefault({broadcast:false});
        this._updateStageOverlay();
        this._syncStageRemovalControls();
        if (game.user.isGM) this._renderBackstage($(document));
        else this._syncPlayerActorToggleButtonWithStage();
    },

    _createStageCharacterWrapper(actorId, actorData, classes) {
        const wrapper = document.createElement('div');
        wrapper.className = `stage-character-wrapper ${classes}`;
        wrapper.dataset.actorId = String(actorId);
        const character = document.createElement('div'); character.className = 'stage-character';
        const portrait = document.createElement('div'); portrait.className = 'stage-character-portrait';
        const image = document.createElement('img');
        image.src = safeStageImageSource(actorData.img);
        image.alt = String(actorData.name ?? '');
        const name = document.createElement('div'); name.className = 'character-name';
        name.textContent = String(actorData.name ?? '');
        portrait.appendChild(image); character.append(portrait, name); wrapper.appendChild(character);
        return wrapper;
    },

    // 스테이지 오버레이 초기화
    setupStageOverlay() {
        // 이미 존재하면 제거
        $('#lichsoma-stage-overlay').remove();
        
        // 스테이지 오버레이 HTML 생성
        const overlayHTML = $(`
            <div id="lichsoma-stage-overlay" class="hidden">
                <div class="stage-characters-container"></div>
            </div>
        `);
        overlayHTML[0].addEventListener('contextmenu', event => {
            const image = event.target.closest?.('.stage-character-portrait img');
            const wrapper = image?.closest('.stage-character-wrapper[data-actor-id]');
            if (!wrapper || wrapper.matches('.removing, .shrinking')
                || !this._canRemoveStageActor(wrapper.dataset.actorId)) return;
            event.preventDefault();
            event.stopPropagation();
            this._requestActorRemoval(wrapper.dataset.actorId);
        });
        
        // #interface 안에 추가
        const interfaceElement = $('#interface');
        if (interfaceElement.length) {
            interfaceElement.append(overlayHTML);
        } else {
            // fallback: interface가 없으면 body에 추가
            $('body').append(overlayHTML);
        }
    },

    // 스테이지 오버레이 표시
    _showStageOverlay() {
        const overlay = $('#lichsoma-stage-overlay');
        if (!overlay.length) return;

        const wasHidden = overlay.hasClass('hidden');
        const wasLeaving = overlay.hasClass('lichsoma-stage-overlay--leaving');
        const alreadyVisible = !wasHidden
            && !wasLeaving
            && overlay.hasClass('lichsoma-stage-overlay--stage-controls-visible');

        if (this._stageOverlayHideTimer) {
            clearTimeout(this._stageOverlayHideTimer);
            this._stageOverlayHideTimer = null;
        }

        // 액터 추가/삭제/교체처럼 이미 열린 스테이지를 갱신하는 경우에는
        // 배경 가시성 훅과 진입 애니메이션을 다시 실행하지 않는다.
        if (alreadyVisible) {
            overlay.removeClass('hidden lichsoma-stage-overlay--leaving');
            overlay.addClass('lichsoma-stage-overlay--stage-controls-visible');
            this._syncStageOverlaySidebarVar();
            this._scheduleExternalHudIntegrationSync();
            return;
        }

        if (this._stageOverlayShowTimer) {
            clearTimeout(this._stageOverlayShowTimer);
            this._stageOverlayShowTimer = null;
        }
        Hooks.callAll('lichsomaSpeakerStageVisibility', true);
        overlay.removeClass('hidden lichsoma-stage-overlay--leaving');
        overlay.addClass('lichsoma-stage-overlay--stage-controls-visible lichsoma-stage-overlay--entering');
        this._syncStageOverlaySidebarVar();
        this._scheduleExternalHudIntegrationSync();
        this._stageOverlayShowTimer = setTimeout(() => {
            this._stageOverlayShowTimer = null;
            overlay.removeClass('lichsoma-stage-overlay--entering');
        }, 620);
    },

    /** 오버레이는 전체 화면; 캐릭터 영역 너비용 --sidebar-width만 갱신 */
    _syncStageOverlaySidebarVar() {
        const overlay = $('#lichsoma-stage-overlay');
        if (overlay.length) {
            const sidebarWidth = this._getSidebarWidthPx();
            overlay.css('--sidebar-width', `${sidebarWidth}px`);
        }
        Hooks.callAll('lichsomaSpeakerStageLayout');
    },

    // 스테이지 오버레이 숨기기
    _hideStageOverlay() {
        const overlay = $('#lichsoma-stage-overlay');
        if (!overlay.length) return;
        if (overlay.hasClass('hidden') && !overlay.hasClass('lichsoma-stage-overlay--leaving')) return;
        if (overlay.hasClass('lichsoma-stage-overlay--leaving')) return;

        Hooks.callAll('lichsomaSpeakerStageVisibility', false);
        if (this._stageOverlayShowTimer) {
            clearTimeout(this._stageOverlayShowTimer);
            this._stageOverlayShowTimer = null;
        }
        overlay.removeClass('lichsoma-stage-overlay--stage-controls-visible lichsoma-stage-overlay--entering');
        overlay.addClass('lichsoma-stage-overlay--leaving');

        // The stage is already logically off at this point. Release external HUD locks immediately,
        // while keeping only the visual stage overlay fade-out running.
        this._releaseCainAlterHudLocks();
        this._syncExternalHudIntegrationClasses();
        this._scheduleExternalHudIntegrationSync();

        if (this._stageOverlayHideTimer) clearTimeout(this._stageOverlayHideTimer);
        this._stageOverlayHideTimer = setTimeout(() => {
            this._stageOverlayHideTimer = null;
            overlay.addClass('hidden');
            overlay.removeClass('lichsoma-stage-overlay--leaving');
            this._releaseCainAlterHudLocks();
            this._syncExternalHudIntegrationClasses();
            this._scheduleExternalHudIntegrationSync();
        }, 520);
        // DOM은 유지하여 다시 켤 때 슬라이드 인 애니메이션이 반복되지 않도록 함
    },

    _clearActorExitTimers(actorId) {
        const timerMap = this._standingExitTimers;
        const timers = timerMap.get(String(actorId));
        if (timers) {
            timers.forEach((timerId) => clearTimeout(timerId));
            timerMap.delete(String(actorId));
        }
    },

    _rememberActorExitTimers(actorId, timers) {
        this._clearActorExitTimers(actorId);
        const validTimers = Array.isArray(timers) ? timers.filter(Boolean) : [];
        if (validTimers.length) {
            const key = String(actorId);
            const timerMap = this._standingExitTimers;
            timerMap.set(key, validTimers);
        }
    },

    _cancelStandingDialogueExit() {
        if (this._standingDialogueExitTimer) {
            clearTimeout(this._standingDialogueExitTimer);
            this._standingDialogueExitTimer = null;
        }
        const container = $('#lichsoma-stage-overlay .stage-characters-container');
        container.children('.stage-standing-dialogue-region')
            .removeClass('stage-dialogue-exiting');
    },

    _fadeOutStandingStageWrapper(wrapperInput, actorId) {
        const wrapper = wrapperInput?.jquery ? wrapperInput : $(wrapperInput);
        if (!wrapper?.length) return;

        const key = String(actorId || wrapper.attr('data-actor-id') || '');
        if (!key) return;
        if (wrapper.hasClass('removing')) return;

        this._clearActorExitTimers(key);
        wrapper.removeClass('preparing expanding slide-in-new is-active-standing').addClass('removing is-inactive-standing');
        wrapper.css('--standing-z', '5');

        const removeTimer = setTimeout(() => {
            wrapper.remove();
            this._standingExitTimers.delete(key);
        }, 720);

        this._rememberActorExitTimers(key, [removeTimer]);
    },

    _fadeOutStandingDialogueAndClear(containerInput) {
        const container = containerInput?.jquery ? containerInput : $(containerInput);
        if (!container?.length) return;

        this._cancelStandingDialogueExit();
        this._clearTypingEffectsForActor('standing:gm');
        this._clearTypingEffectsForActor('standing:player');
        const dialogueElements = container.children('.stage-standing-dialogue-region');
        if (!dialogueElements.length) return;

        dialogueElements.addClass('stage-dialogue-exiting');
        this._standingDialogueExitTimer = setTimeout(() => {
            this._standingDialogueExitTimer = null;
            container.children('.stage-standing-dialogue-region').remove();
            container.children('.stage-standing-actor-layer').empty();
            container.children('.stage-character-wrapper').remove();
            container[0]?.style.setProperty('--stage-standing-count', '0');
            container[0]?.style.setProperty('--stage-standing-gm-count', '0');
            container[0]?.style.setProperty('--stage-standing-player-count', '0');
            container.removeClass('has-gm-standings has-player-standings standing-front-side-gm standing-front-side-player');
        }, 720);
    },

    // Portraits and standing images share the same layout, dialogue and lifecycle.
    _updateStageOverlay() {
        this._syncStageOverlaySidebarVar();
        this._applyStageModeClass();
        this._updateStandingStageOverlay();
    },
};
