/** integrations: methods are attached to SpeakerStage; this is the shared stage controller. */

export const stageIntegrationsMethods = {
    /**
     * 외부 HUD(CAIN Alter 등)가 스피커 스테이지와 겹칠 때 필요한 상태 클래스를 body에 동기화한다.
     * 실제 스타일 적용은 lichsoma-stage-integrations.css에서 수행한다.
     */
    setupExternalHudIntegration() {
        if (this._externalHudIntegrationStarted) return;
        this._externalHudIntegrationStarted = true;
        this._bindExternalHudInteractionBlocker();

        const schedule = () => this._scheduleExternalHudIntegrationSync();

        Hooks.once('ready', () => {
            schedule();
            window.setTimeout(schedule, 120);
            window.setTimeout(schedule, 500);
        });

        Hooks.on('updateSetting', (setting) => {
            if (!this._isOwnSettingDocument(setting)) return;
            const key = this._getSettingDocumentKey(setting);
            if (!['stageBackgroundMiniMode', 'stageBackgroundNarrativeMode'].includes(key)) return;
            schedule();
        });

        Hooks.on('lichsomaSpeakerStageVisibility', schedule);
        Hooks.on('lichsomaSpeakerStageLayout', schedule);

        const attachObserver = () => {
            const root = document.getElementById('interface') || document.body || document.documentElement;
            if (!root || this._externalHudIntegrationObserver) return;
            this._externalHudIntegrationObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    const target = mutation.target;
                    if (target instanceof Element && (
                        target.id === 'lichsoma-stage-overlay'
                        || target.classList?.contains?.('lichsoma-stage-background-shell')
                        || target.classList?.contains?.('lichsoma-stage-bg-scene-bar')
                    )) {
                        schedule();
                        return;
                    }
                    for (const node of mutation.addedNodes ?? []) {
                        if (!(node instanceof Element)) continue;
                        if (
                            node.id === 'lichsoma-stage-overlay'
                            || node.id === 'cain-alter-hunt-hud'
                            || node.id === 'cain-alter-hunt-minion-hud'
                            || node.id === 'lichsoma-cain-player-hud'
                            || node.id === 'lichsoma-cain-hud-toggle'
                            || node.querySelector?.('#lichsoma-stage-overlay, #cain-alter-hunt-hud, #cain-alter-hunt-minion-hud, #lichsoma-cain-player-hud, #lichsoma-cain-hud-toggle')
                        ) {
                            schedule();
                            return;
                        }
                    }
                }
            });
            this._externalHudIntegrationObserver.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden']
            });
        };

        Hooks.once('ready', attachObserver);
        if (document.readyState !== 'loading') window.setTimeout(attachObserver, 0);
    },

    _scheduleExternalHudIntegrationSync() {
        if (this._externalHudIntegrationTimer) window.clearTimeout(this._externalHudIntegrationTimer);
        this._externalHudIntegrationTimer = window.setTimeout(() => {
            this._externalHudIntegrationTimer = null;
            this._syncExternalHudIntegrationClasses();
        }, 0);
    },

    _syncExternalHudIntegrationClasses() {
        const body = document.body;
        if (!body) return;

        const overlay = document.getElementById('lichsoma-stage-overlay');
        const stageActive = !!this._stageActive && !!overlay && !overlay.classList.contains('hidden');
        const narrativeFull = stageActive && overlay.classList.contains('lichsoma-stage-overlay--narrative-full-pointer-block');
        const miniMode = !!overlay?.querySelector?.('.lichsoma-stage-background-shell--mini');
        const hasStageSpeakers = stageActive && this._hasActiveStageSpeakers();

        body.classList.toggle('lichsoma-speaker-stage-active', stageActive);
        body.classList.toggle('lichsoma-speaker-stage-narrative-full', narrativeFull);
        body.classList.toggle('lichsoma-speaker-stage-mini-mode', stageActive && miniMode);
        body.classList.toggle('lichsoma-speaker-stage-has-speakers', hasStageSpeakers);
        body.classList.toggle('lichsoma-speaker-stage-gm', !!game.user?.isGM);
        this._syncCainAlterHudMuteState(stageActive, narrativeFull, hasStageSpeakers);
    },

    _hasActiveStageSpeakers() {
        if (this._activeActors?.size > 0) return true;
        const overlay = document.getElementById('lichsoma-stage-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return false;
        return !!overlay.querySelector?.(
            '.stage-character-wrapper:not(.removing):not(.shrinking)'
        );
    },

    _bindExternalHudInteractionBlocker() {
        if (this._externalHudInteractionBlockerBound || typeof window === 'undefined') return;
        this._externalHudInteractionBlockerBound = true;

        const blockIfNeeded = (event) => {
            if (!this._shouldBlockCainAlterHudInteraction()) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const hud = target.closest?.('#cain-alter-hunt-hud, #cain-alter-hunt-minion-hud');
            if (!hud) return;
            event.preventDefault?.();
            event.stopImmediatePropagation?.();
            event.stopPropagation?.();
        };

        const eventTypes = [
            'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerenter',
            'mousedown', 'mouseup', 'mouseover', 'mouseenter', 'click', 'dblclick',
            'contextmenu', 'touchstart', 'touchend', 'wheel', 'keydown'
        ];

        for (const type of eventTypes) {
            window.addEventListener(type, blockIfNeeded, true);
            document.addEventListener(type, blockIfNeeded, true);
        }
    },

    _shouldBlockCainAlterHudInteraction() {
        const body = document.body;
        if (!body?.classList?.contains?.('lichsoma-speaker-stage-active')) return false;
        // Normal and mini stage modes must keep CAIN Alter HUDs interactive.
        // Full narrative mode hides the HUDs and is the only state that should hard-block them.
        return body.classList.contains('lichsoma-speaker-stage-narrative-full');
    },

    _syncCainAlterHudMuteState(stageActive, narrativeFull, hasStageSpeakers = false) {
        const shouldDim = stageActive && !narrativeFull && !!hasStageSpeakers;
        const shouldHide = stageActive && narrativeFull;
        const huds = [
            document.getElementById('cain-alter-hunt-hud'),
            document.getElementById('cain-alter-hunt-minion-hud')
        ].filter(Boolean);

        for (const hud of huds) {
            hud.classList.add('lichsoma-speaker-stage-hud-fade-managed');

            // Normal / mini stage mode only dims and layers CAIN Alter hunt HUDs.
            // It must not disable buttons or quick actions. Full narrative mode remains hidden and blocked.
            this._restoreCainAlterHudInteractivity(hud);
            hud.classList.toggle('lichsoma-speaker-stage-hud-muted', shouldDim);
            hud.classList.toggle('lichsoma-speaker-stage-hud-hidden-by-narrative', shouldHide);

            if (shouldHide) {
                hud.dataset.lichsomaSpeakerStageMuted = 'true';
                hud.dataset.huntCanInteract = 'false';
                hud.setAttribute('aria-disabled', 'true');
                hud.querySelectorAll?.('.cain-alter-hunt-hud-quick-actions, .cain-alter-hunt-minion-hud-quick-actions').forEach((el) => {
                    el.setAttribute('hidden', '');
                    el.hidden = true;
                });
                hud.querySelectorAll?.('.cain-alter-hunt-minion-hud-row[data-quick-open="true"]').forEach((row) => {
                    row.dataset.quickOpen = 'false';
                });
            }
        }

        const narrativeOnly = [
            document.getElementById('lichsoma-cain-player-hud'),
            document.getElementById('lichsoma-cain-hud-toggle')
        ].filter(Boolean);
        for (const el of narrativeOnly) {
            el.classList.add('lichsoma-speaker-stage-hud-fade-managed');
            el.classList.toggle('lichsoma-speaker-stage-hud-hidden-by-narrative', shouldHide);
        }
    },

    _restoreCainAlterHudInteractivity(hud) {
        if (!hud) return;
        delete hud.dataset.lichsomaSpeakerStageMuted;
        hud.removeAttribute('aria-disabled');
        hud.classList.remove('lichsoma-speaker-stage-hud-muted');

        // CAIN Alter uses data-hunt-can-interact="true" as the CSS gate for its HUD buttons.
        // Do not delete this dataset after the stage is turned off; restore CAIN Alter's own expected value.
        hud.dataset.huntCanInteract = game.user?.isGM ? 'true' : 'false';

        const quickActions = hud.querySelectorAll?.('.cain-alter-hunt-hud-quick-actions, .cain-alter-hunt-minion-hud-quick-actions') ?? [];
        for (const el of quickActions) {
            if (game.user?.isGM && hud.id === 'cain-alter-hunt-hud') {
                el.removeAttribute('hidden');
                el.hidden = false;
            } else if (!game.user?.isGM) {
                el.setAttribute('hidden', '');
                el.hidden = true;
            }
        }
    },

    _releaseCainAlterHudLocks() {
        const body = document.body;
        body?.classList?.remove?.(
            'lichsoma-speaker-stage-active',
            'lichsoma-speaker-stage-narrative-full',
            'lichsoma-speaker-stage-mini-mode',
            'lichsoma-speaker-stage-has-speakers',
            'lichsoma-speaker-stage-gm'
        );

        const huds = [
            document.getElementById('cain-alter-hunt-hud'),
            document.getElementById('cain-alter-hunt-minion-hud')
        ].filter(Boolean);
        for (const hud of huds) {
            hud.classList.remove('lichsoma-speaker-stage-hud-muted', 'lichsoma-speaker-stage-hud-hidden-by-narrative');
            this._restoreCainAlterHudInteractivity(hud);
        }

        for (const el of [document.getElementById('lichsoma-cain-player-hud'), document.getElementById('lichsoma-cain-hud-toggle')].filter(Boolean)) {
            el.classList.remove('lichsoma-speaker-stage-hud-hidden-by-narrative');
        }
    },

    // 리사이즈 옵저버 설정 (사이드바 넓이 변경 감지)
    setupResizeObserver() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this._onSidebarLayoutChanged();
            }, 100);
        });

        this._bindStageSidebarLayout();
    },

    /**
     * 우측 aside#sidebar 실제 차지 너비(px). dx3rd-action-hud의 getBoundingClientRect()와 동일 기준.
     */
    _getSidebarWidthPx() {
        const side = document.getElementById('sidebar');
        if (!side) return 300;
        const r = side.getBoundingClientRect();
        if (r.width > 0) return Math.round(r.width);
        return 0;
    },

    /** 사이드바 폭·접기 등 변경 시 CSS 변수 반영 + 스테이지 켜짐이면 오버레이 DOM 갱신 */
    _onSidebarLayoutChanged() {
        this._syncStageOverlaySidebarVar();
        if (this._stageActive) {
            this._updateStageOverlay();
        }
    },

    /**
     * dx3rd-action-hud `_bindEnemyHudSidebarLayout` 와 동일 패턴:
     * ResizeObserver + collapse/expand/tab + 지연 재부착(ready 이후 sidebar 존재 대비).
     */
    _bindStageSidebarLayout() {
        if (this._stageSidebarLayoutBound) return;
        this._stageSidebarLayoutBound = true;

        const update = () => this._onSidebarLayoutChanged();

        const attachRO = () => {
            const side = document.getElementById('sidebar');
            if (side && this._stageSidebarROElement === side) {
                update();
                return;
            }
            this._stageSidebarRO?.disconnect?.();
            this._stageSidebarRO = null;
            this._stageSidebarROElement = null;
            if (!side) {
                update();
                return;
            }
            this._stageSidebarRO = new ResizeObserver(update);
            this._stageSidebarRO.observe(side);
            this._stageSidebarROElement = side;
            update();
        };

        attachRO();
        requestAnimationFrame(() => {
            attachRO();
            update();
        });
        setTimeout(() => {
            attachRO();
            update();
        }, 250);

        Hooks.once('ready', () => {
            attachRO();
            update();
        });

        Hooks.on('collapseSidebar', update);
        Hooks.on('expandSidebar', update);
        Hooks.on('changeSidebarTab', update);
    },
};
