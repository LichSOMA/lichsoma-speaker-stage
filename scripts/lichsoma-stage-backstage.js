/** backstage: methods are attached to SpeakerStage; this is the shared stage controller. */
import { escapeStageHTML, safeStageImageSource } from './lichsoma-stage-dialogue.js';

export const stageBackstageMethods = {
    // 액터 목록 변경 감지
    setupActorListObserver() {
        // 스피커 셀렉터의 등록 액터 설정 변경 감지
        // Foundry v13/v14 및 Setting 문서 형태에 따라 setting.key가
        // "module.key" 전체 문자열이거나 namespace/key로 분리되어 들어올 수 있다.
        Hooks.on('updateSetting', (setting, value) => {
            if (!this._isSpeakerRegistrySetting(setting)) return;
            this._scheduleBackstageRegistrySync('setting');
        });
    },

    // 백스테이지 설정
    setupBackstage() {
        this._setupBackstageMutationObserver();

        // 채팅 로그 렌더링 시 백스테이지 추가
        Hooks.on('renderChatLog', (app, html, data) => {
            this._renderBackstage(html);
        });

        // 사이드바 렌더링 시도
        Hooks.on('renderSidebarTab', (app, html, data) => {
            if (app.tabName === 'chat') {
                // DOM이 완전히 준비될 때까지 여러 번 시도
                let attempts = 0;
                const maxAttempts = 5;
                const checkAndRender = () => {
                    attempts++;
                    const chatForm = $('#sidebar .chat-form');
                    const speakerSelector = chatForm.find('.lichsoma-speaker-selector');
                    
                    if (chatForm.length && speakerSelector.length) {
                        this._renderBackstage($(document));
                    } else if (attempts < maxAttempts) {
                        setTimeout(checkAndRender, 100);
                    }
                };
                checkAndRender();
            }
        });

        // 사이드바 상태 변경 시 처리
        Hooks.on('collapseSidebar', () => {
            setTimeout(() => {
                if (this._isSidebarCollapsed()) {
                    $(document).find('.lichsoma-speaker-backstage-container').remove();
                } else {
                    this._renderBackstage($(document));
                }
            }, 100);
        });

        Hooks.on('expandSidebar', () => {
            setTimeout(() => {
                if (!this._isSidebarCollapsed()) {
                    this._renderBackstage($(document));
                } else {
                    $(document).find('.lichsoma-speaker-backstage-container').remove();
                }
            }, 100);
        });
    },

    // 플레이어 스테이지 토글 버튼 설정 (플레이어만)
    setupPlayerStageToggle() {
        // MutationObserver로 speaker selector 변경 감지 (ready 후)
        Hooks.once('ready', () => {
            // GM은 건너뛰기
            if (game.user?.isGM) return;
            
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            
            const observer = new MutationObserver(() => {
                // speaker selector가 있고 필요한 버튼만 보충
                // 스테이지 중앙 제어 ON이면 전구 버튼을 붙이지 않으므로, 전구만으로는 재렌더하지 않음(무한 루프 방지)
                const selector = $('.lichsoma-speaker-selector');
                const hasActorButton = selector.find('.player-actor-toggle-btn').length > 0;
                const hasStageButton = selector.find('.player-stage-toggle-btn').length > 0;
                const needLightbulb = !this.isStageCentralControlEnabled();
                const needActorButton = !this.isPlayerStageDisabled();
                const complete = hasActorButton === needActorButton && hasStageButton === needLightbulb;

                if (selector.length && !complete && !this._isSidebarCollapsed()) {
                    this._renderPlayerStageToggle($(document));
                }
            });
            
            observer.observe(sidebar, {
                childList: true,
                subtree: true
            });
        });

        // 사이드바 상태 변경 시 처리
        Hooks.on('collapseSidebar', () => {
            if (!game.user?.isGM) {
                setTimeout(() => {
                    $(document).find('.player-stage-toggle-btn').remove();
                }, 100);
            }
        });

        Hooks.on('expandSidebar', () => {
            if (!game.user?.isGM) {
                setTimeout(() => {
                    if (!this._isSidebarCollapsed()) {
                        this._renderPlayerStageToggle($(document));
                    }
                }, 100);
            }
        });
    },

    // 플레이어 스테이지 토글 버튼 렌더링 (모든 유저)
    _renderPlayerStageToggle(html) {
        // 사이드바 상태 확인
        const sidebarCollapsed = this._isSidebarCollapsed();
        if (sidebarCollapsed) {
            return;
        }

        // speaker selector 찾기
        const speakerSelector = $(document).find('.lichsoma-speaker-selector');
        if (!speakerSelector.length) {
            return;
        }

        // 이미 버튼이 있으면 제거
        speakerSelector.find('.player-actor-toggle-btn').remove();
        speakerSelector.find('.player-stage-toggle-btn').remove();

        if (!this.isPlayerStageDisabled()) {
            // 자신의 캐릭터 ID 확인. 스탠딩 모드에서도 플레이어가 자신의 캐릭터를 올릴 수 있다.
            const characterId = game.user.character instanceof Actor 
                ? game.user.character.id 
                : game.user.character;
            const isOnStage = characterId && this._activeActors.has(characterId);
    
            // 캐릭터 토글 버튼 생성 (왼쪽)
            const actorToggleBtn = $(`
                    <button type="button" class="player-actor-toggle-btn ui-control icon" 
                            title="${game.i18n.localize('SPEAKERSTAGE.Player.ActorToggleButton.Title')}" 
                            aria-label="${game.i18n.localize('SPEAKERSTAGE.Player.ActorToggleButton.AriaLabel')}"
                            aria-pressed="${isOnStage ? 'true' : 'false'}">
                        <i class="fa-solid fa-masks-theater"></i>
                    </button>
                `);
    
            // 캐릭터 토글 버튼 좌클릭 이벤트 (스테이지에 올리기 또는 스피커 선택)
            actorToggleBtn.on('click', (e) => {
                    e.preventDefault();
                    const actorId = game.user.character instanceof Actor 
                    ? game.user.character.id 
                    : game.user.character;
                    
                    if (actorId) {
                        if (this._activeActors.has(actorId)) {
                            // 이미 선택된 스피커를 다시 누르면 기본값으로 복귀
                            this._toggleSpeakerSelectionInSelector(actorId);
                        } else {
                            // 스테이지에 없으면 올리고 스피커 선택
                            this._onPlayerActorToggle(actorId);
                            // 버튼 상태 업데이트
                            actorToggleBtn.attr('aria-pressed', 'true');
                        }
                    } else {
                        ui.notifications.warn(game.i18n.localize('SPEAKERSTAGE.Player.NoCharacter'));
                    }
                });
    
            // 캐릭터 토글 버튼 우클릭 이벤트 (스테이지에서 내리기 — PL은 본인이 올린 경우만)
            actorToggleBtn.on('contextmenu', (e) => {
                    e.preventDefault();
                    const actorId = game.user.character instanceof Actor 
                    ? game.user.character.id 
                    : game.user.character;
                    
                    if (actorId && this._activeActors.has(actorId)) {
                        if (!game.user.isGM) {
                            const placedBy = this._activeActors.get(actorId)?.userId;
                            if (placedBy !== game.user.id) {
                                ui.notifications.info(
                                    game.i18n.localize('SPEAKERSTAGE.Player.CannotRemoveStageActorNotOwned')
                                );
                                return;
                            }
                        }
    
                        this._requestActorRemoval(actorId);
                        
                        // 버튼 상태 업데이트
                        actorToggleBtn.attr('aria-pressed', 'false');
                    }
                });
    
            // speaker selector에 마스크 버튼 추가
            speakerSelector.append(actorToggleBtn);
    
        }

        // 전구(오른쪽)는 스테이지 중앙 제어 OFF일 때만 표시
        if (!this.isStageCentralControlEnabled()) {
            const stageToggleBtn = $(`
                <button type="button" class="player-stage-toggle-btn ui-control icon" 
                        title="${game.i18n.localize('SPEAKERSTAGE.Player.ToggleButton.Title')}" 
                        aria-label="${game.i18n.localize('SPEAKERSTAGE.Player.ToggleButton.AriaLabel')}"
                        aria-pressed="${this._stageActive ? 'true' : 'false'}">
                    <i class="fa-regular fa-lightbulb"></i>
                </button>
            `);
            stageToggleBtn.on('click', () => {
                this._toggleStage();
                stageToggleBtn.attr('aria-pressed', this._stageActive ? 'true' : 'false');
            });
            speakerSelector.append(stageToggleBtn);
        }

        this._updatePlayerStageButtonIndicator();
    },

    // 사이드바 상태 확인
    _isSidebarCollapsed() {
        const sidebarElement = document.querySelector('#sidebar');
        if (sidebarElement) {
            return sidebarElement.classList.contains('collapsed') ||
                   sidebarElement.offsetWidth === 0 ||
                   (ui?.sidebar && ui.sidebar.collapsed);
        }
        return false;
    },

    // 백스테이지 렌더링
    _renderBackstage(html) {
        // GM만 백스테이지 렌더링
        if (!game.user.isGM) {
            return;
        }
        
        // 중복 실행 방지
        if (this._isRenderingBackstage) {
            return;
        }
        this._isRenderingBackstage = true;
        
        // 플래그를 자동으로 해제하는 타이머 설정
        setTimeout(() => {
            this._isRenderingBackstage = false;
        }, 1000);
        
        // 기존 백스테이지 제거
        $(document).find('.lichsoma-speaker-backstage-container').remove();
        
        // 사이드바 상태 확인
        const sidebarCollapsed = this._isSidebarCollapsed();
        
        if (sidebarCollapsed) {
            this._isRenderingBackstage = false;
            return;
        }
        
        // 사이드바 내부의 chat-form만 찾기
        let chatForm = $('#sidebar .chat-form');
        if (!chatForm.length) {
            chatForm = $('.chat-form');
        }
        
        if (!chatForm.length) {
            this._isRenderingBackstage = false;
            return;
        }
        
        // notifications에 있는 경우 제외
        if (chatForm.closest('#chat-notifications').length > 0) {
            this._isRenderingBackstage = false;
            return;
        }
        
        // lichsoma-speaker-selector 찾기
        const speakerSelector = chatForm.find('.lichsoma-speaker-selector');
        if (!speakerSelector.length) {
            this._isRenderingBackstage = false;
            return;
        }
        
        // 등록된 스피커 액터 목록 가져오기
        const registeredActors = this._getRegisteredSpeakers();
        
        // 백스테이지 컨테이너 HTML 생성 (GM용 전구 버튼 포함)
        const backstageContainerHTML = $(`
            <div class="lichsoma-speaker-backstage-container">
                <div class="lichsoma-speaker-backstage">
                    <div class="backstage-actors">
                        ${this._generateActorPortraits(registeredActors)}
                    </div>
                </div>
                <button type="button" class="backstage-toggle-btn ui-control icon" 
                        title="${game.i18n.localize('SPEAKERSTAGE.Backstage.ToggleButton.Title')}" 
                        aria-label="${game.i18n.localize('SPEAKERSTAGE.Backstage.ToggleButton.AriaLabel')}"
                        aria-pressed="${this._stageActive ? 'true' : 'false'}">
                    <i class="fa-regular fa-lightbulb"></i>
                </button>
            </div>
        `);
        
        // 토글 버튼 이벤트 리스너
        backstageContainerHTML.find('.backstage-toggle-btn').on('click', (e) => {
            e.preventDefault();
            this._toggleStage();
            // 버튼 상태 업데이트
            const btn = $(e.currentTarget);
            btn.attr('aria-pressed', this._stageActive ? 'true' : 'false');
        });
        
        // 액터 포트레잇 좌클릭 이벤트 리스너 (대화창 토글)
        backstageContainerHTML.find('.actor-portrait').on('click', (e) => {
            e.preventDefault();
            const actorId = $(e.currentTarget).attr('data-actor-id');
            if (actorId) {
                this._onActorPortraitLeftClick(actorId);
            }
        });
        
        // 액터 포트레잇 우클릭 이벤트 리스너 (스테이지 올리기/내리기)
        backstageContainerHTML.find('.actor-portrait').on('contextmenu', (e) => {
            e.preventDefault();
            const actorId = $(e.currentTarget).attr('data-actor-id');
            if (actorId) {
                this._onActorPortraitRightClick(actorId);
            }
        });
        
        // lichsoma-speaker-selector 바로 다음에 삽입하고 order 설정
        try {
            speakerSelector.after(backstageContainerHTML);
            
            // CSS order 속성 설정 (스피커 셀렉터가 order: 2를 사용하므로 백스테이지는 3)
            const insertedElement = backstageContainerHTML[0];
            if (insertedElement) {
                insertedElement.style.order = '3';
            }
            
            // 스피커 셀렉터의 order가 2인지 확인하고, 없으면 설정
            const selectorElement = speakerSelector[0];
            if (selectorElement && !selectorElement.style.order) {
                selectorElement.style.order = '2';
            }
            
            // 백스테이지 액터 목록에 마우스 휠 좌우 스크롤 추가
            const backstageActors = backstageContainerHTML.find('.backstage-actors')[0];
            if (backstageActors) {
                backstageActors.addEventListener('wheel', (e) => {
                    // 세로 스크롤을 가로 스크롤로 변환
                    if (e.deltaY !== 0) {
                        e.preventDefault();
                        backstageActors.scrollLeft += e.deltaY;
                    }
                }, { passive: false });
            }

            // 스피커 셀렉터 변경 시 선택된 액터 하이라이트 갱신
            const dropdown = speakerSelector.find('.speaker-dropdown');
            dropdown.off('change.lichsomaSpeakerStage');
            dropdown.on('change.lichsomaSpeakerStage', () => {
                this._updateBackstageSelectedSpeakerHighlight();
                if (!this._suppressStageFocusBroadcast) {
                    const selectedActorId = this._getSelectedSpeakerActorId();
                    this._setActiveStandingActor(selectedActorId, { broadcast: true });
                }
            });

            // 초기 하이라이트 적용
            this._updateBackstageSelectedSpeakerHighlight();
        } catch (error) {
            console.error('LichSOMA Speaker Stage | 백스테이지 추가 실패:', error);
        } finally {
            this._isRenderingBackstage = false;
        }
    },

    // 등록된 스피커 액터 목록 가져오기
    _getRegisteredSpeakers() {
        const registeredSpeakers = [];
        
        try {
            const actorIds = game.settings.get(
                this.SELECTOR_MODULE_ID,
                this.SELECTOR_SETTING_ACTOR_GRID
            ) || [];
            
            actorIds.forEach(actorId => {
                const actor = game.actors.get(actorId);
                if (actor) {
                    registeredSpeakers.push({
                        id: actor.id,
                        name: actor.name,
                        img: actor.img
                    });
                }
            });
        } catch (error) {
            console.warn('LichSOMA Speaker Stage | 등록된 스피커 액터를 가져오는 데 실패:', error);
        }
        
        return registeredSpeakers;
    },

    _isSpeakerRegistrySetting(setting) {
        if (!setting) return false;

        const fullKey = `${this.SELECTOR_MODULE_ID}.${this.SELECTOR_SETTING_ACTOR_GRID}`;
        const rawKey = String(setting.key ?? setting.id ?? setting._id ?? '');
        const namespace = String(setting.namespace ?? setting.parent?.namespace ?? '');
        const bareKey = rawKey.includes('.') ? rawKey.split('.').pop() : rawKey;

        return rawKey === fullKey
            || (namespace === this.SELECTOR_MODULE_ID && bareKey === this.SELECTOR_SETTING_ACTOR_GRID);
    },

    _scheduleBackstageRegistrySync(reason = '') {
        if (!game.user?.isGM) return;

        const schedule = (delay) => {
            let timerId = null;
            const callback = () => {
                this._backstageRegistrySyncTimers.delete(timerId);
                this._pruneStageActorsNotInSpeakerRegistry();
                this._renderBackstage($(document));
                this._updateBackstageSelectedSpeakerHighlight();
            };
            timerId = setTimeout(callback, delay);
            this._backstageRegistrySyncTimers.add(timerId);
        };

        requestAnimationFrame(() => {
            this._pruneStageActorsNotInSpeakerRegistry();
            this._renderBackstage($(document));
            this._updateBackstageSelectedSpeakerHighlight();
        });
        schedule(75);
        schedule(200);
        schedule(500);
    },

    _queueBackstageRenderFromDomMutation() {
        if (!game.user?.isGM) return;
        if (this._isSidebarCollapsed()) return;

        clearTimeout(this._backstageMutationRenderTimer);
        this._backstageMutationRenderTimer = setTimeout(() => {
            this._backstageMutationRenderTimer = null;
            if (!$(document).find('.lichsoma-speaker-selector').length) return;
            this._pruneStageActorsNotInSpeakerRegistry();
            this._renderBackstage($(document));
            this._updateBackstageSelectedSpeakerHighlight();
        }, 80);
    },

    _setupBackstageMutationObserver() {
        if (!game.user?.isGM) return;
        if (this._backstageMutationObserver) return;

        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        this._backstageMutationObserver = new MutationObserver((mutations) => {
            let shouldSync = false;
            for (const mutation of mutations) {
                const target = mutation.target;
                if (!(target instanceof Element)) continue;
                if (target.closest?.('.lichsoma-speaker-backstage-container')) continue;
                if (target.closest?.('.lichsoma-speaker-selector') || target.matches?.('.lichsoma-speaker-selector')) {
                    shouldSync = true;
                    break;
                }
                for (const node of mutation.addedNodes || []) {
                    if (!(node instanceof Element)) continue;
                    if (node.matches?.('.lichsoma-speaker-selector') || node.querySelector?.('.lichsoma-speaker-selector')) {
                        shouldSync = true;
                        break;
                    }
                }
                if (shouldSync) break;
            }
            if (shouldSync) this._queueBackstageRenderFromDomMutation();
        });

        this._backstageMutationObserver.observe(sidebar, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['value', 'selected', 'class']
        });
    },

    /** 스피커 셀렉터 월드 설정 `actorGridActors`의 ID 집합 (읽기 실패 시 null → 호출부에서 스테이지 전체 삭제 방지) */
    _getRegisteredSpeakerIdSet() {
        try {
            const ids = game.settings.get(this.SELECTOR_MODULE_ID, this.SELECTOR_SETTING_ACTOR_GRID);
            const arr = Array.isArray(ids) ? ids.filter(Boolean) : [];
            return new Set(arr.map((id) => String(id)));
        } catch {
            return null;
        }
    },

    /** 등록에서 빠진 액터는 스테이지에서도 제거 (스피커 셀렉터 설정 동기화, 소켓으로 전 클라이언트 반영) */
    _pruneStageActorsNotInSpeakerRegistry() {
        const allowed = this._getRegisteredSpeakerIdSet();
        if (allowed === null) return false;

        const toRemove = [...this._activeActors.entries()]
            // 플레이어가 직접 올린 액터는 GM의 Speaker Selector 등록 목록과 무관하게 유지한다.
            .filter(([, actorData]) => !this._isPlayerStandingActorData(actorData))
            .map(([id]) => id)
            .filter((id) => !allowed.has(String(id)));
        if (toRemove.length === 0) return false;

        let needResetSelector = false;
        let standingFocusRemoved = false;
        for (const actorId of toRemove) {
            const data = this._activeActors.get(actorId);
            const placementId = this._getStagePlacementId(actorId,data);
            this._rememberStageRetirement(actorId,placementId,data.userId);
            if (this._isPrimaryGM()) this._emitStagePacket({action:'removeStageActor',actorId,placementId,ownerUserId:data.userId});
            if (this._isActorSelectedInSelector(actorId)) {
                needResetSelector = true;
            }
            if (this._activeStandingActorId && String(this._activeStandingActorId) === String(actorId)) {
                standingFocusRemoved = true;
            }
            this._clearTypingEffectsForActor(actorId);
            this._clearStandingFocusForActor(actorId);
            this._activeActors.delete(actorId);
        }

        if (standingFocusRemoved) {
            this._activeStandingActorId = null;
        }

        if (needResetSelector) {
            this._resetSpeakerSelectorToDefault({broadcast:false});
        }

        this._updateStageOverlay();

        if (game.user?.isGM) {
            this._broadcastStageState();
            this._renderBackstage($(document));
        } else {
            this._renderPlayerStageToggle($(document));
        }

        return true;
    },

    _onSpeakerSelectorActorGridSetting(setting) {
        if (!this._isSpeakerRegistrySetting(setting)) return;
        this._scheduleBackstageRegistrySync('ready-setting');
    },

    // 액터 포트레잇 HTML 생성
    _generateActorPortraits(actors) {
        if (!actors || actors.length === 0) {
            return '<div class="no-actors">(등록된 액터 없음)</div>';
        }
        const selectedActorId = this._getSelectedSpeakerActorId();
        
        return actors.map(actor => {
            const isOnStage = this._activeActors.has(actor.id);
            const stageClass = isOnStage ? 'on-stage' : '';
            const selectedClass = isOnStage && selectedActorId === actor.id ? 'selected-speaker' : '';
            
            const actorImg = this._activeActors.get(actor.id)?.img || this._getActorImage(actor.id) || actor.img;
            return `
                <div class="actor-portrait ${stageClass} ${selectedClass}" data-actor-id="${escapeStageHTML(actor.id)}" title="${escapeStageHTML(actor.name)}">
                    <img src="${escapeStageHTML(safeStageImageSource(actorImg))}" alt="${escapeStageHTML(actor.name)}">
                </div>
            `;
        }).join('');
    },

    // 스테이지 토글 (개인 설정; 중앙 제어 시 플레이어는 GM만 제어)
    _toggleStage() {
        if (!game.user?.isGM && this.isStageCentralControlEnabled()) {
            ui.notifications?.info(game.i18n.localize('SPEAKERSTAGE.Player.CentralControlNoToggle'));
            return;
        }
        this._stageActive = !this._stageActive;
        
        if (this._stageActive) {
            this._showStageOverlay();
            // 스테이지를 켤 때 액터 DOM 업데이트 (다른 유저가 올린 액터 표시)
            if (this._activeActors.size > 0) {
                this._updateStageOverlay();
            }
        } else {
            this._hideStageOverlay();
            // 액터 목록은 유지 (비활성화 시에도 백스테이지에 남아있음)
        }

        // GM이 스테이지 토글 시 플레이어 버튼 상태 동기화
        if (game.user?.isGM) {
            this._broadcastGMStageState({ request: true });
        }
    },

    // 액터 포트레잇 좌클릭 처리 (스테이지에 올리기 또는 스피커 선택)
    _onActorPortraitLeftClick(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }

        // 스테이지에 있는 액터면 스피커 선택만
        if (this._activeActors.has(actorId)) {
            // 이미 선택된 스피커를 다시 누르면 기본값으로 복귀
            this._toggleSpeakerSelectionInSelector(actorId);
        } else {
            // 스테이지에 없으면 스테이지에 올리기
            const emotion = this.ActorEmotions?.getSavedEmotion(actorId);
            const actorImg = this._getActorImage(actorId, emotion) || actor.img;
            const isStandingImage = this._isActorUsingStandingImage(actorId, emotion);
            this._activeActors.set(actorId, {
                img: actorImg,
                name: actor.name,
                emotionId: emotion?.emotionId || null,
                emotionPortrait: emotion?.emotionPortrait || null,
                isStandingImage,
                position: this._nextStagePosition(),
                placementId: this._newStagePlacementId(),
                dialogueVisible: true,
                userId: game.user.id, // 액터를 올린 유저 ID
                emotionUserId: emotion?.emotionId ? game.user.id : undefined // 감정이 있으면 현재 유저
            });
            
            // 스피커 셀렉터 변경
            this._selectSpeakerInSelector(actorId);
            
            // 항상 DOM 업데이트 (hidden 상태와 관계없이)
            this._updateStageOverlay();
            
            // 백스테이지 업데이트 (GM만, on-stage 클래스 반영)
            if (game.user.isGM) {
                this._renderBackstage($(document));
            }
            
            // 모든 유저에게 액터 변경 브로드캐스트
            this._broadcastStageState();
        }
    },

    // 플레이어 캐릭터를 스테이지에 올리기 (플레이어만)
    _onPlayerActorToggle(actorId) {
        if (!game.user?.isGM && this.isPlayerStageDisabled()) return;
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }

        // 스테이지에 없으면 올리기 (이미 있으면 아무것도 하지 않음)
        if (!this._activeActors.has(actorId)) {
            // 새로운 액터를 스테이지에 올리기
            const emotion = this.ActorEmotions?.getSavedEmotion(actorId);
            const actorImg = this._getActorImage(actorId, emotion) || actor.img;
            const isStandingImage = this._isActorUsingStandingImage(actorId, emotion);
            this._activeActors.set(actorId, {
                img: actorImg,
                name: actor.name,
                emotionId: emotion?.emotionId || null,
                emotionPortrait: emotion?.emotionPortrait || null,
                isStandingImage,
                position: this._nextStagePosition(),
                placementId: this._newStagePlacementId(),
                dialogueVisible: true,
                userId: game.user.id, // 액터를 올린 유저 ID
                emotionUserId: emotion?.emotionId ? game.user.id : undefined // 감정이 있으면 현재 유저
            });

            // 플레이어 진영에서는 가장 최근에 스테이지에 올라온 액터를 우선 활성화한다.
            // 실제 채팅 발화가 발생하면 _updateDialogueBox()가 마지막 발화 액터로 다시 전환한다.
            // 진영 간 앞뒤 우선순위는 실제 발화만 결정하므로 _lastStandingSpeakerSide는 변경하지 않는다.
            this._activePlayerStandingActorId = String(actorId);
            
            // 항상 DOM 업데이트 (hidden 상태와 관계없이)
            this._updateStageOverlay();
            
            // 모든 유저에게 액터 변경 및 플레이어 진영 활성 스피커를 브로드캐스트
            this._broadcastStageState({playerFocus:true});
        }
        
        // 스피커 셀렉터에서 선택
        this._selectSpeakerInSelector(actorId);
    },

    // 액터 포트레잇 우클릭 처리 (스테이지 올리기/내리기, GM만)
    _onActorPortraitRightClick(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }

        // 이미 스테이지에 있으면 내리기
        if (this._activeActors.has(actorId)) {
            this._requestActorRemoval(actorId);
            return;
        } else {
            // 새로운 액터를 스테이지에 올리기
            const emotion = this.ActorEmotions?.getSavedEmotion(actorId);
            const actorImg = this._getActorImage(actorId, emotion) || actor.img;
            const isStandingImage = this._isActorUsingStandingImage(actorId, emotion);
            this._activeActors.set(actorId, {
                img: actorImg,
                name: actor.name,
                emotionId: emotion?.emotionId || null,
                emotionPortrait: emotion?.emotionPortrait || null,
                isStandingImage,
                position: this._nextStagePosition(),
                placementId: this._newStagePlacementId(),
                dialogueVisible: true,
                userId: game.user.id, // 액터를 올린 유저 ID
                emotionUserId: emotion?.emotionId ? game.user.id : undefined // 감정이 있으면 현재 유저
            });
            
            // 스피커 셀렉터 변경
            this._selectSpeakerInSelector(actorId);
        }
        
        // 항상 DOM 업데이트 (hidden 상태와 관계없이)
        this._updateStageOverlay();
        
        // 백스테이지는 항상 업데이트 (스테이지 비활성화 상태에서도 목록 확인 가능)
        if (game.user.isGM) {
            this._renderBackstage($(document));
        }
        
        // 모든 유저에게 액터 변경 브로드캐스트
        this._broadcastStageState();
    },

    // 스피커 셀렉터에서 액터 선택
    _selectSpeakerInSelector(actorId) {
        const selector = document.querySelector('.lichsoma-speaker-selector .speaker-dropdown');
        if (!selector) return;
        
        // 현재 사용자의 할당된 캐릭터인지 확인
        const userCharacterId = game.user.character instanceof Actor 
            ? game.user.character.id 
            : game.user.character;
        const isUserCharacter = userCharacterId === actorId;
        
        // 할당된 캐릭터면 'character', 아니면 'actor:actorId'
        const optionValue = isUserCharacter ? 'character' : `actor:${actorId}`;
        
        const option = selector.querySelector(`option[value="${optionValue}"]`);
        
        if (option) {
            selector.value = optionValue;
            // 스피커 셀렉터 모듈의 선택 상태도 업데이트
            $(selector).trigger('change');
            // change 훅 누락/지연 상황 대비 즉시 하이라이트 동기화
            this._updateBackstageSelectedSpeakerHighlight();
            if (game.user?.isGM) {
                this._setActiveStandingActor(actorId, { broadcast: true });
            }
        }
    },

    // 현재 스피커 셀렉터에서 특정 액터가 선택되어 있는지 확인
    _isActorSelectedInSelector(actorId) {
        const selector = document.querySelector('.lichsoma-speaker-selector .speaker-dropdown');
        if (!selector) return false;

        const userCharacterId = game.user.character instanceof Actor
            ? game.user.character.id
            : game.user.character;
        const expectedValue = userCharacterId === actorId ? 'character' : `actor:${actorId}`;

        return selector.value === expectedValue || selector.value === `actor:${actorId}`;
    },

    // 현재 스피커 셀렉터에서 선택된 액터 ID 가져오기
    _getSelectedSpeakerActorId() {
        const selector = document.querySelector('.lichsoma-speaker-selector .speaker-dropdown');
        if (!selector) return null;

        const value = selector.value;
        if (!value) return null;

        if (value === 'character') {
            return game.user.character instanceof Actor
                ? game.user.character.id
                : game.user.character || null;
        }

        if (value.startsWith('actor:')) {
            return value.substring(6);
        }

        return null;
    },

    // 백스테이지에서 현재 선택된 스피커 하이라이트 상태 갱신
    _updateBackstageSelectedSpeakerHighlight() {
        const selectedActorId = this._getSelectedSpeakerActorId();
        const portraits = $(document).find('.lichsoma-speaker-backstage-container .actor-portrait');

        portraits.removeClass('selected-speaker');
        if (!selectedActorId) return;

        portraits.each((index, element) => {
            const portrait = $(element);
            const actorId = portrait.attr('data-actor-id');
            if (actorId && actorId === selectedActorId && portrait.hasClass('on-stage')) {
                portrait.addClass('selected-speaker');
            }
        });
    },

    // 스피커 셀렉터를 기본값(첫 번째 옵션)으로 되돌리기
    _resetSpeakerSelectorToDefault({broadcast = true} = {}) {
        const selector = document.querySelector('.lichsoma-speaker-selector .speaker-dropdown');
        if (!selector || !selector.options?.length) return;

        selector.selectedIndex = 0;
        const suppressed = this._suppressStageFocusBroadcast;
        this._suppressStageFocusBroadcast = !broadcast || suppressed;
        try { $(selector).trigger('change'); }
        finally { this._suppressStageFocusBroadcast = suppressed; }
        // change 훅 누락/지연 상황 대비 즉시 하이라이트와 스탠딩 포커스를 동기화한다.
        // 특히 이미 선택된 스피커를 다시 눌러 선택을 해제하는 경우, 기존 활성 스탠딩이
        // _activeStandingActorId에 남아 투명도/z-index가 갱신되지 않을 수 있으므로 명시적으로 비운다.
        this._updateBackstageSelectedSpeakerHighlight();
        if (broadcast && game.user?.isGM) {
            this._setActiveStandingActor(null, { broadcast: true });
        }
    },

    // 스피커 선택 토글: 이미 선택된 액터면 기본값으로 복귀, 아니면 해당 액터 선택
    _toggleSpeakerSelectionInSelector(actorId) {
        if (this._isActorSelectedInSelector(actorId)) {
            this._resetSpeakerSelectorToDefault();
        } else {
            this._selectSpeakerInSelector(actorId);
        }
    },
};
