/** portraits: methods are attached to SpeakerStage; this is the shared stage controller. */
import { safeStageImageSource } from './lichsoma-stage-dialogue.js';

export const stagePortraitsMethods = {
    // 액터 이미지 가져오기 (감정 포트레잇 우선)
    _getActorImage(actorId, emotionOverride = undefined) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;

        const rawEmotion = emotionOverride !== undefined ? emotionOverride : this.ActorEmotions?.getSavedEmotion?.(actorId) || null;
        const savedEmotion = this._normalizeActorEmotion(actor, rawEmotion);

        if (this.isStandingEnabled()) {
            const standingPath = this._getActorStandingPath(actor, savedEmotion?.emotionId || null);
            if (standingPath) return standingPath;
        }

        // 감정 포트레잇 확인
        if (savedEmotion?.emotionPortrait) {
            return savedEmotion.emotionPortrait;
        }

        // 기본 액터 이미지
        return actor.img;
    },

    _isActorUsingStandingImage(actorId, emotionOverride = undefined) {
        if (!this.isStandingEnabled()) return false;
        const actor = game.actors.get(actorId);
        if (!actor) return false;

        const rawEmotion = emotionOverride !== undefined ? emotionOverride : this.ActorEmotions?.getSavedEmotion?.(actorId) || null;
        const savedEmotion = this._normalizeActorEmotion(actor, rawEmotion);
        const standingPath = this._getActorStandingPath(actor, savedEmotion?.emotionId || null);
        return !!String(standingPath || '').trim();
    },

    _getActorEmotionData(actorId, emotionOverride = undefined) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;

        const rawEmotion = emotionOverride !== undefined ? emotionOverride : this.ActorEmotions?.getSavedEmotion?.(actorId) || null;
        const savedEmotion = this._normalizeActorEmotion(actor, rawEmotion);
        const emotionPortrait = savedEmotion?.emotionPortrait || null;
        const img = this._getActorImage(actorId, savedEmotion) || actor.img;
        const isStandingImage = this._isActorUsingStandingImage(actorId, savedEmotion);

        return {
            img,
            emotionId: savedEmotion?.emotionId || null,
            emotionPortrait,
            isStandingImage,
            emotionUserId: savedEmotion?.emotionId ? game.user.id : undefined
        };
    },

    _swapImageWithFade(imageTarget, newSrc, options = {}) {
        if (!newSrc) return;
        newSrc = safeStageImageSource(newSrc);

        const imageElement = imageTarget?.jquery ? imageTarget[0] : imageTarget;
        if (!imageElement) return;

        const currentSrc = imageElement.getAttribute?.('src') || '';
        if (currentSrc === newSrc) return;

        const fadeClass = options.fadeClass || 'lichsoma-stage-portrait-fading';
        const fadeOutMs = Number.isFinite(options.fadeOutMs) ? options.fadeOutMs : 320;
        const fadeInDelayMs = Number.isFinite(options.fadeInDelayMs) ? options.fadeInDelayMs : 16;

        const previousTimers = this._portraitFadeTimers.get(imageElement);
        if (previousTimers) {
            previousTimers.forEach((timerId) => clearTimeout(timerId));
            this._portraitFadeTimers.delete(imageElement);
        }

        const finish = () => {
            imageElement.classList.remove(fadeClass);
            this._portraitFadeTimers.delete(imageElement);
        };

        const swap = () => {
            imageElement.setAttribute('src', safeStageImageSource(newSrc));

            const fadeInTimer = setTimeout(finish, fadeInDelayMs);
            this._portraitFadeTimers.set(imageElement, [fadeInTimer]);
        };

        imageElement.classList.add(fadeClass);
        const swapTimer = setTimeout(swap, fadeOutMs);
        this._portraitFadeTimers.set(imageElement, [swapTimer]);
    },

    _updateStagePortraitElement(actorId, src, { fade = true } = {}) {
        if (!src) return;
        const image = document.querySelector(`#lichsoma-stage-overlay .stage-character-wrapper[data-actor-id="${actorId}"] .stage-character-portrait img`);
        if (!image) return;

        if (fade) this._swapImageWithFade(image, src);
        else image.setAttribute('src', safeStageImageSource(src));
    },

    _updateBackstagePortraitElement(actorId, src, { fade = true } = {}) {
        if (!src || !game.user?.isGM) return;

        const image = document.querySelector(`.lichsoma-speaker-backstage-container .actor-portrait[data-actor-id="${actorId}"] img`);
        if (!image) return;

        if (fade) this._swapImageWithFade(image, src);
        else image.setAttribute('src', safeStageImageSource(src));
    },

    _updateActorEmotionOnStage(actorId, options = {}) {
        if (!actorId) return false;
        const actorData = this._activeActors.get(actorId);
        if (actorData && !options.useStageEmotion && !this._canChangeStageEmotion(actorId,game.user)) return false;
        const remembered = actorData?.emotionId ? {emotionId:actorData.emotionId,emotionPortrait:actorData.emotionPortrait} : null;
        const emotionData = this._getActorEmotionData(actorId, options.useStageEmotion ? remembered : options.emotion);
        if (!emotionData?.img) return false;
        if (options.useStageEmotion && actorData) emotionData.emotionUserId = actorData.emotionUserId;
        let changed = false;

        if (actorData) {
            changed = actorData.img !== emotionData.img
                || actorData.emotionId !== emotionData.emotionId
                || actorData.emotionPortrait !== emotionData.emotionPortrait
                || !!actorData.isStandingImage !== !!emotionData.isStandingImage;

            actorData.img = emotionData.img;
            actorData.emotionId = emotionData.emotionId;
            actorData.emotionPortrait = emotionData.emotionPortrait;
            actorData.isStandingImage = !!emotionData.isStandingImage;
            actorData.emotionUserId = emotionData.emotionUserId;
        } else {
            const currentBackstageImg = document.querySelector(`.lichsoma-speaker-backstage-container .actor-portrait[data-actor-id="${actorId}"] img`)?.getAttribute('src') || '';
            changed = currentBackstageImg !== emotionData.img;
        }

        this._updateStagePortraitElement(actorId, emotionData.img, { fade: options.fade !== false });
        const wrapper = document.querySelector(`#lichsoma-stage-overlay .stage-character-wrapper[data-actor-id="${actorId}"]`);
        if (wrapper) {
            wrapper.classList.toggle('is-standing-image', !!emotionData.isStandingImage);
            wrapper.classList.toggle('is-portrait-fallback', !emotionData.isStandingImage);
        }
        this._updateBackstagePortraitElement(actorId, emotionData.img, { fade: options.fade !== false });

        if (changed && options.broadcast !== false && actorData) {
            this._broadcastActorEmotion(actorId);
        }

        return changed;
    },

    _canChangeStageEmotion(actorId, user) {
        const data = this._activeActors.get(actorId), actor = game.actors.get(actorId);
        if (!user || !data) return false;
        if (user.isGM) return true;
        return !this.isPlayerStageDisabled() && (data.userId === user.id
            || (user.character?.id ?? user.character) === actorId || actor?.testUserPermission?.(user,'OWNER') === true);
    },

    _broadcastActorEmotion(actorId) {
        if (!this._canChangeStageEmotion(actorId,game.user)) return;
        const data = this._activeActors.get(actorId);
        const stamp = this._nextSyncStamp();
        data.emotionStamp = stamp;
        this._emitStagePacket({action:'updateActorEmotion', actorId,
            placementId:this._getStagePlacementId(actorId,data), stamp,
            img:data.img, emotionId:data.emotionId ?? null, emotionPortrait:data.emotionPortrait ?? null,
            isStandingImage:!!data.isStandingImage, emotionUserId:data.emotionUserId ?? null});
    },

    _receiveActorEmotion(data) {
        const sender = this._getSocketUser(data?.userId);
        if (!sender || (sender.id === game.user.id && !this._syncReplaying)
            || typeof data.actorId !== 'string' || !this._isSyncStamp(data.stamp)) return;
        const current = this._activeActors.get(data.actorId);
        if (!current || !this._canChangeStageEmotion(data.actorId,sender)
            || this._getStagePlacementId(data.actorId,current) !== data.placementId) return;
        for (const key of ['img','emotionId','emotionPortrait','emotionUserId']) {
            if (data[key] != null && (typeof data[key] !== 'string' || data[key].length > 8192)) return;
        }
        if (typeof data.isStandingImage !== 'boolean' || typeof data.img !== 'string') return;
        if (!this._recordSyncPacket(data) || this._compareSyncStamps(data.stamp,current.emotionStamp) <= 0) return;
        for (const key of ['img','emotionId','emotionPortrait','emotionUserId','isStandingImage']) current[key] = data[key];
        current.emotionStamp = {...data.stamp};
        this._updateStageOverlay();
        if (game.user.isGM) this._updateBackstagePortraits({fade:true});
    },

    // 스테이지의 모든 액터 이미지 업데이트
    _updateStageActorImages() {
        const overlay = $('#lichsoma-stage-overlay');
        if (!overlay.length && !game.user?.isGM) return;

        this._activeActors.forEach((actorData, actorId) => {
            // Shared document edits use the staged emotion, never this viewer's
            // private selector choice. Only the primary (or owner with no GM) sends.
            this._updateActorEmotionOnStage(actorId, {
                useStageEmotion: true,
                broadcast: this._isPrimaryGM() || (!this._getPrimaryGM() && actorData.userId === game.user.id),
                fade: true
            });
        });

        // 백스테이지 포트레잇도 업데이트
        if (game.user.isGM) {
            this._updateBackstagePortraits({ fade: true });
        }

    },

    // 백스테이지 포트레잇 업데이트
    _updateBackstagePortraits(options = {}) {
        const backstage = $(document).find('.lichsoma-speaker-backstage-container');
        if (!backstage.length) return;

        backstage.find('.actor-portrait').each((index, element) => {
            const actorId = $(element).data('actor-id');
            if (actorId) {
                const img = this._activeActors.get(actorId)?.img || this._getActorImage(actorId);
                if (img) {
                    const image = $(element).find('img');
                    const currentImg = image.attr('src');
                    if (currentImg !== img) {
                        if (options.fade === false) image.attr('src', safeStageImageSource(img));
                        else this._swapImageWithFade(image, img);
                    }
                }
            }
        });
    },

    // 감정 변경 감지 설정
    setupEmotionChangeDetection() {
        // Speaker Selector의 감정 선택 변경을 즉시 반영
        document.addEventListener('lichsoma-speaker-selector:emotionChanged', (event) => {
            const actorId = event.detail?.actorId;
            if (!actorId) return;

            this._updateActorEmotionOnStage(actorId, {
                emotion: event.detail?.emotion || null,
                broadcast: true,
                fade: true
            });
        });

        // Dialog 닫힘 감지 (감정 선택 다이얼로그) — 구버전/이벤트 누락 폴백
        Hooks.on('closeDialog', (dialog) => {
            if (dialog?.data?.title && dialog.data.title.includes('감정')) {
                setTimeout(() => {
                    this._updateStageActorImages();
                }, 100);
            }
        });

        // 액터 업데이트 감지 (감정 관리 창에서 저장)
        Hooks.on('updateActor', (actor, changes) => {
            const selectorEmotionChanged = !!(changes.system?.emotions || changes.flags?.[this.SELECTOR_MODULE_ID]?.emotions);
            const standingChanged = !!changes.flags?.[this.MODULE_ID]?.[this.STANDING_FLAG];
            if (selectorEmotionChanged || standingChanged) {
                setTimeout(async () => {
                    if (selectorEmotionChanged) {
                        await this._pruneActorStandingEmotionOrphans(actor);
                        if (this._standingManagerApp?.actor?.id === actor.id && this._standingManagerApp.rendered) {
                            await this._standingManagerApp.render({ force: true });
                        }
                    }
                    this._updateStageActorImages();
                }, 100);
            }
        });

        Hooks.on('lichsomaSpeakerStageStandingsUpdated', (actor) => {
            if (!actor) return;
            setTimeout(() => {
                this._updateStageActorImages();
                if (this._activeActors.has(actor.id)) {
                    this._updateStageOverlay();
                    if (game.user?.isGM) this._broadcastStageState();
                }
            }, 50);
        });
    },
};
