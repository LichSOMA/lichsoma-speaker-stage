/**
 * LichSOMA Speaker Stage
 * 비주얼노벨 스타일의 캐릭터 스탠딩과 대화창 표시
 */

// Speaker Selector 모듈의 ActorEmotions (형제 모듈 경로)
import { ActorEmotions } from '../../lichsoma-speaker-selector/scripts/lichsoma-actor-emotions.js';

export class SpeakerStage {
    /** Speaker Selector와 동일한 설정 네임스페이스·키 (등록 스피커 그리드) */
    static SELECTOR_MODULE_ID = 'lichsoma-speaker-selector';
    static SELECTOR_SETTING_ACTOR_GRID = 'actorGridActors';

    static MODULE_ID = 'lichsoma-speaker-stage';
    static _isRenderingBackstage = false;
    static _stageActive = false;
    static _gmStageActive = false; // GM의 스테이지 ON 상태(플레이어 표시용)
    static _activeActors = new Map(); // actorId -> { img, name, position, dialogueVisible }
    static _previousActorIds = new Set(); // 이전 프레임의 액터 ID 추적
    static _currentTypingAnimations = new Map(); // actorId -> timeout ID
    static _textClearTimeouts = new Map(); // actorId -> clear timeout ID
    static _fontChoicesUpdated = false; // 폰트 목록 업데이트 완료 플래그

    /** @type {ResizeObserver | null} dx3rd-action-hud와 동일하게 #sidebar 관측 */
    static _stageSidebarRO = null;
    /** @type {Element | null} */
    static _stageSidebarROElement = null;
    static _stageSidebarLayoutBound = false;

    /**
     * `document.fonts` / 월드 설정에 들어간 패밀리 이름 앞뒤의 ASCII 따옴표 제거.
     * Speaker Selector(`lichsoma-speaker-selector`)와 동일한 규칙.
     */
    static _normalizeFontFamilyName(name) {
        if (name == null || typeof name !== 'string') return '';
        let s = name.trim();
        while (s.length >= 2) {
            const open = s[0];
            const close = s[s.length - 1];
            if ((open === '"' && close === '"') || (open === "'" && close === "'")) {
                s = s.slice(1, -1).trim();
            } else {
                break;
            }
        }
        return s;
    }

    // ActorEmotions 클래스 접근
    static get ActorEmotions() {
        return ActorEmotions;
    }

    // 모듈 초기화
    static initialize() {
        // 설정 등록
        this.registerSettings();
        
        // 스테이지 오버레이 초기화 (모든 유저)
        this.setupStageOverlay();
        
        // 윈도우 리사이즈 감지 (사이드바 넓이 변경 반영)
        this.setupResizeObserver();
        
        // 스피커 액터 목록 변경 감지
        this.setupActorListObserver();
        
        // 소켓 통신 설정
        this.setupSocket();
        
        // 플레이어 스테이지 토글 버튼 설정 (모든 유저)
        this.setupPlayerStageToggle();
        
        // 감정 변경 감지 설정
        this.setupEmotionChangeDetection();
        
        // 채팅 메시지 감지 설정
        this.setupChatMessageListener();
        
        // 폰트 목록 업데이트 (폰트 로드 완료 후)
        this._waitForFontsAndUpdate();

        // 월드 설정 변경 (본 모듈 + 스피커 셀렉터 등록 그리드)
        Hooks.once('ready', () => {
            Hooks.on('updateSetting', (setting) => {
                this._onWorldSettingChanged(setting);
                this._onSpeakerSelectorActorGridSetting(setting);
            });
        });
    }

    /** 월드 설정 변경 (스테이지 중앙 제어) */
    static _onWorldSettingChanged(setting) {
        if (!setting) return;
        const ns = setting.namespace ?? setting.parent?.namespace;
        const k = setting.key;
        if (ns !== this.MODULE_ID || k !== 'stageCentralControl') return;
        if (game.user?.isGM) return;
        if (game.settings.get(this.MODULE_ID, 'stageCentralControl')) {
            game.socket.emit('module.lichsoma-speaker-stage', {
                action: 'requestSync',
                requestUserId: game.user.id
            });
        }
        this._renderPlayerStageToggle($(document));
    }

    // 설정 등록
    static registerSettings() {
        // 초기 폰트 목록 (동적으로 업데이트됨)
        const fontChoices = this._getAvailableFonts();

        // 1. 캐릭터 이름 폰트
        game.settings.register(this.MODULE_ID, 'characterNameFont', {
            name: '캐릭터 이름 폰트',
            hint: '캐릭터 이름의 폰트를 선택합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            choices: fontChoices,
            default: '',
            onChange: value => {
                this._updateCharacterNameFontFamily(value);
            }
        });

        // 2. 캐릭터 이름 폰트 크기
        game.settings.register(this.MODULE_ID, 'characterNameFontSize', {
            name: '캐릭터 이름 폰트 크기',
            hint: '캐릭터 이름의 폰트 크기를 설정합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 36,
            range: {
                min: 32,
                max: 50,
                step: 1
            },
            onChange: value => {
                this._updateCharacterNameFontSize(value);
            }
        });

        // 3. 대화창 폰트
        game.settings.register(this.MODULE_ID, 'dialogueFont', {
            name: '대화창 폰트',
            hint: '대화창의 텍스트 폰트를 선택합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            choices: fontChoices,
            default: '',
            onChange: value => {
                this._updateDialogueFontFamily(value);
            }
        });

        // 4. 대화창 폰트 크기
        game.settings.register(this.MODULE_ID, 'dialogueFontSize', {
            name: '대화창 폰트 크기',
            hint: '대화창의 텍스트 폰트 크기를 설정합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 16,
            range: {
                min: 12,
                max: 20,
                step: 1
            },
            onChange: value => {
                this._updateDialogueFontSize(value);
            }
        });

        // 5. 대화창 타이핑 속도
        game.settings.register(this.MODULE_ID, 'typingSpeed', {
            name: '대화창 타이핑 속도',
            hint: '한 글자당 표시 시간 (밀리초). 낮을수록 빠릅니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 100,
            range: {
                min: 50,
                max: 150,
                step: 10
            }
        });

        // 6. 대화창 텍스트 제거 딜레이
        game.settings.register(this.MODULE_ID, 'textClearDelay', {
            name: '대화창 텍스트 제거 딜레이',
            hint: '타이핑 완료 후 텍스트가 자동으로 제거되기까지의 시간(초). 0이면 자동 제거되지 않습니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 0,
            range: {
                min: 0,
                max: 30,
                step: 1
            }
        });

        // 7. 타이핑 사운드
        game.settings.register(this.MODULE_ID, 'typingSoundPath', {
            name: '타이핑 사운드',
            hint: '글자가 입력될 때 재생할 사운드 파일을 선택합니다. 비워두면 사운드가 재생되지 않습니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            filePicker: 'audio',
            default: ''
        });

        // 8. 타이핑 사운드 볼륨
        game.settings.register(this.MODULE_ID, 'typingSoundVolume', {
            name: '타이핑 사운드 볼륨',
            hint: '타이핑 사운드의 볼륨을 조절합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 0.5,
            range: {
                min: 0,
                max: 1,
                step: 0.1
            }
        });

        // 9. 스테이지 중앙 제어 (GM이 스테이지 표시를 켜면 모든 클라이언트에 표시)
        game.settings.register(this.MODULE_ID, 'stageCentralControl', {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.StageCentralControl.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.StageCentralControl.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                if (game.user?.isGM) {
                    this._broadcastGMStageState();
                }
            }
        });
    }

    /** 월드 설정 — GM 스테이지 표시가 모든 클라이언트에 강제 동기화 */
    static isStageCentralControlEnabled() {
        try {
            return !!game.settings.get(this.MODULE_ID, 'stageCentralControl');
        } catch {
            return false;
        }
    }

    // 다이얼로그 폰트 패밀리 업데이트
    static _updateDialogueFontFamily(font) {
        const style = document.getElementById('lichsoma-stage-dialogue-font-family');
        if (style) {
            style.remove();
        }

        const normalized = this._normalizeFontFamilyName(font);
        if (normalized) {
            const newStyle = document.createElement('style');
            newStyle.id = 'lichsoma-stage-dialogue-font-family';
            newStyle.textContent = `
                .dialogue-content {
                    font-family: "${normalized}", sans-serif !important;
                }
            `;
            document.head.appendChild(newStyle);
        }
    }

    // 다이얼로그 폰트 크기 업데이트
    static _updateDialogueFontSize(size) {
        const style = document.getElementById('lichsoma-stage-dialogue-font-size');
        if (style) {
            style.remove();
        }

        const newStyle = document.createElement('style');
        newStyle.id = 'lichsoma-stage-dialogue-font-size';
        newStyle.textContent = `
            .dialogue-content {
                font-size: ${size}px !important;
            }
        `;
        document.head.appendChild(newStyle);
    }

    // 캐릭터 이름 폰트 패밀리 업데이트
    static _updateCharacterNameFontFamily(font) {
        const style = document.getElementById('lichsoma-stage-character-name-font-family');
        if (style) {
            style.remove();
        }

        const normalized = this._normalizeFontFamilyName(font);
        if (normalized) {
            const newStyle = document.createElement('style');
            newStyle.id = 'lichsoma-stage-character-name-font-family';
            newStyle.textContent = `
                .character-name {
                    font-family: "${normalized}", sans-serif !important;
                }
            `;
            document.head.appendChild(newStyle);
        }
    }

    // 캐릭터 이름 폰트 크기 업데이트
    static _updateCharacterNameFontSize(size) {
        const style = document.getElementById('lichsoma-stage-character-name-font-size');
        if (style) {
            style.remove();
        }

        const newStyle = document.createElement('style');
        newStyle.id = 'lichsoma-stage-character-name-font-size';
        newStyle.textContent = `
            .character-name {
                font-size: ${size}px !important;
            }
        `;
        document.head.appendChild(newStyle);
    }

    // 사용 가능한 폰트 목록 가져오기 (Speaker Selector와 동일한 수집·필터 규칙)
    static _getAvailableFonts() {
        try {
            const loadedFonts = [];

            try {
                if (document.fonts && document.fonts.forEach) {
                    document.fonts.forEach(font => {
                        const family = font.family;
                        if (family && typeof family === 'string') {
                            const n = this._normalizeFontFamilyName(family);
                            if (n) loadedFonts.push(n);
                        }
                    });
                }
            } catch (e) {
                // document.fonts 접근 실패 (무시)
            }

            // 제외할 폰트들 (패턴 매칭)
            const excludePatterns = [
                'modesto condensed',
                'modesto',
                'amiri',
                'signika',
                'bruno ace',
                'font awesome',
                'fontawesome',
                'fallback'
            ];

            // 필터링 및 중복 제거
            const filteredFonts = loadedFonts.filter(font => {
                if (!font || typeof font !== 'string') return false;
                const lowerFont = font.toLowerCase().trim();
                return !excludePatterns.some(pattern => lowerFont.includes(pattern));
            });
            
            const uniqueFonts = [...new Set(filteredFonts)];
            
            // 기본 폰트와 결합
            const allFonts = ['', ...uniqueFonts.filter(f => f && f.trim() !== '')];
            
            // 폰트 정렬: 빈 문자열을 제외하고 한글, 영어, 숫자 순으로 정렬
            const sortedFonts = allFonts.sort((a, b) => {
                if (a === '') return -1;
                if (b === '') return 1;
                return a.localeCompare(b, ['ko', 'en'], { numeric: true, sensitivity: 'base' });
            });
            
            // 폰트 선택 옵션 객체 생성
            const fontChoices = {};
            sortedFonts.forEach(font => {
                if (font === '') {
                    fontChoices[font] = '기본';
                } else {
                    fontChoices[font] = font;
                }
            });
            
            return fontChoices;
        } catch (error) {
            console.warn('LichSOMA Speaker Stage | 폰트 목록 가져오기 실패:', error);
            // 폴백 폰트 목록
            return {
                '': '기본',
                'Arial': 'Arial',
                'Times New Roman': 'Times New Roman',
                'Courier New': 'Courier New',
                'Verdana': 'Verdana',
                'Georgia': 'Georgia'
            };
        }
    }

    // 폰트 로드 완료 후 폰트 목록 업데이트 (Speaker Selector와 동일한 재시도 간격)
    static _waitForFontsAndUpdate() {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                setTimeout(() => {
                    this._updateFontChoices();
                }, 500);
            }).catch(() => {
                setTimeout(() => {
                    this._updateFontChoices();
                }, 1000);
            });
        } else {
            setTimeout(() => {
                this._updateFontChoices();
            }, 1000);
        }

        setTimeout(() => {
            this._updateFontChoices(true);
        }, 5000);

        setTimeout(() => {
            this._updateFontChoices(true);
        }, 10000);
    }

    // 폰트 선택 옵션 업데이트
    static _updateFontChoices(force = false) {
        if (this._fontChoicesUpdated && !force) {
            return;
        }

        try {
            const availableFonts = this._getAvailableFonts();
            
            // 폰트 설정 키 목록
            const fontSettings = [
                'characterNameFont',
                'dialogueFont'
            ];
            
            fontSettings.forEach(settingKey => {
                const rawFont = game.settings.get(this.MODULE_ID, settingKey);
                const currentFont = this._normalizeFontFamilyName(rawFont);

                if (currentFont && currentFont !== '' && !availableFonts[currentFont]) {
                    availableFonts[currentFont] = currentFont;
                }
                
                // 설정 메뉴에서 폰트 선택 옵션 업데이트
                const setting = game.settings.settings.get(`${this.MODULE_ID}.${settingKey}`);
                if (setting) {
                    setting.choices = availableFonts;
                }
            });
            
            this._fontChoicesUpdated = true;
        } catch (error) {
            console.error('LichSOMA Speaker Stage | 폰트 선택 옵션 업데이트 실패:', error);
        }
    }

    // 리사이즈 옵저버 설정 (사이드바 넓이 변경 감지)
    static setupResizeObserver() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this._onSidebarLayoutChanged();
            }, 100);
        });

        this._bindStageSidebarLayout();
    }

    /**
     * 우측 aside#sidebar 실제 차지 너비(px). dx3rd-action-hud의 getBoundingClientRect()와 동일 기준.
     */
    static _getSidebarWidthPx() {
        const side = document.getElementById('sidebar');
        if (!side) return 300;
        const r = side.getBoundingClientRect();
        if (r.width > 0) return Math.round(r.width);
        return 0;
    }

    /** 사이드바 폭·접기 등 변경 시 CSS 변수 반영 + 스테이지 켜짐이면 오버레이 DOM 갱신 */
    static _onSidebarLayoutChanged() {
        this._syncStageOverlaySidebarVar();
        if (this._stageActive) {
            this._updateStageOverlay();
        }
    }

    /**
     * dx3rd-action-hud `_bindEnemyHudSidebarLayout` 와 동일 패턴:
     * ResizeObserver + collapse/expand/tab + 지연 재부착(ready 이후 sidebar 존재 대비).
     */
    static _bindStageSidebarLayout() {
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
    }

    // 액터 목록 변경 감지
    static setupActorListObserver() {
        // 스피커 셀렉터의 설정 변경 감지
        Hooks.on('updateSetting', (setting, value) => {
            if (setting.key === `${this.SELECTOR_MODULE_ID}.${this.SELECTOR_SETTING_ACTOR_GRID}`) {
                // 백스테이지 다시 렌더링
                setTimeout(() => {
                    this._renderBackstage($(document));
                }, 100);
            }
        });
    }

    // 백스테이지 설정
    static setupBackstage() {
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
    }

    // 플레이어 스테이지 토글 버튼 설정 (플레이어만)
    static setupPlayerStageToggle() {
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
                const complete = hasActorButton && (!needLightbulb || hasStageButton);

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
    }

    // 플레이어 스테이지 토글 버튼 렌더링 (모든 유저)
    static _renderPlayerStageToggle(html) {
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

        // 자신의 캐릭터 ID 확인
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

                const wasSelected = this._isActorSelectedInSelector(actorId);

                // 스테이지에서 내리기
                this._activeActors.delete(actorId);
                this._updateStageOverlay();
                this._broadcastStageState();

                // 현재 선택된 액터를 내렸다면 스피커 기본값으로 복귀
                if (wasSelected) {
                    this._resetSpeakerSelectorToDefault();
                }
                
                // 버튼 상태 업데이트
                actorToggleBtn.attr('aria-pressed', 'false');
            }
        });

        // speaker selector에 추가: 마스크(왼쪽)는 항상, 전구(오른쪽)는 스테이지 중앙 제어 OFF일 때만 표시
        speakerSelector.append(actorToggleBtn);
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
    }

    // 사이드바 상태 확인
    static _isSidebarCollapsed() {
        const sidebarElement = document.querySelector('#sidebar');
        if (sidebarElement) {
            return sidebarElement.classList.contains('collapsed') ||
                   sidebarElement.offsetWidth === 0 ||
                   (ui?.sidebar && ui.sidebar.collapsed);
        }
        return false;
    }

    // 백스테이지 렌더링
    static _renderBackstage(html) {
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
            });

            // 초기 하이라이트 적용
            this._updateBackstageSelectedSpeakerHighlight();
        } catch (error) {
            console.error('LichSOMA Speaker Stage | 백스테이지 추가 실패:', error);
        } finally {
            this._isRenderingBackstage = false;
        }
    }

    // 등록된 스피커 액터 목록 가져오기
    static _getRegisteredSpeakers() {
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
    }

    /** 스피커 셀렉터 월드 설정 `actorGridActors`의 ID 집합 (읽기 실패 시 null → 호출부에서 스테이지 전체 삭제 방지) */
    static _getRegisteredSpeakerIdSet() {
        try {
            const ids = game.settings.get(this.SELECTOR_MODULE_ID, this.SELECTOR_SETTING_ACTOR_GRID);
            const arr = Array.isArray(ids) ? ids : [];
            return new Set(arr.map((id) => String(id)));
        } catch {
            return null;
        }
    }

    /** 등록에서 빠진 액터는 스테이지에서도 제거 (스피커 셀렉터 설정 동기화, 소켓으로 전 클라이언트 반영) */
    static _pruneStageActorsNotInSpeakerRegistry() {
        const allowed = this._getRegisteredSpeakerIdSet();
        if (allowed === null) return;

        const toRemove = [...this._activeActors.keys()].filter((id) => !allowed.has(String(id)));
        if (toRemove.length === 0) return;

        let needResetSelector = false;
        for (const actorId of toRemove) {
            if (this._isActorSelectedInSelector(actorId)) {
                needResetSelector = true;
            }
            this._clearTypingEffectsForActor(actorId);
            this._activeActors.delete(actorId);
        }

        if (needResetSelector) {
            this._resetSpeakerSelectorToDefault();
        }

        this._updateStageOverlay();

        if (game.user?.isGM) {
            this._broadcastStageState();
            this._renderBackstage($(document));
        } else {
            this._renderPlayerStageToggle($(document));
        }
    }

    static _onSpeakerSelectorActorGridSetting(setting) {
        if (!setting) return;
        const ns = setting.namespace ?? setting.parent?.namespace;
        const k = setting.key;
        if (ns !== this.SELECTOR_MODULE_ID || k !== this.SELECTOR_SETTING_ACTOR_GRID) return;
        this._pruneStageActorsNotInSpeakerRegistry();
    }

    // 액터 포트레잇 HTML 생성
    static _generateActorPortraits(actors) {
        if (!actors || actors.length === 0) {
            return '<div class="no-actors">(등록된 액터 없음)</div>';
        }
        const selectedActorId = this._getSelectedSpeakerActorId();
        
        return actors.map(actor => {
            const isOnStage = this._activeActors.has(actor.id);
            const stageClass = isOnStage ? 'on-stage' : '';
            const selectedClass = isOnStage && selectedActorId === actor.id ? 'selected-speaker' : '';
            
            const actorImg = this._getActorImage(actor.id) || actor.img;
            return `
                <div class="actor-portrait ${stageClass} ${selectedClass}" data-actor-id="${actor.id}" title="${actor.name}">
                    <img src="${actorImg}" alt="${actor.name}">
                </div>
            `;
        }).join('');
    }

    // 스테이지 토글 (개인 설정; 중앙 제어 시 플레이어는 GM만 제어)
    static _toggleStage() {
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
            this._broadcastGMStageState();
        }
    }

    // 액터 포트레잇 좌클릭 처리 (스테이지에 올리기 또는 스피커 선택)
    static _onActorPortraitLeftClick(actorId) {
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
            const actorImg = this._getActorImage(actorId) || actor.img;
            const emotion = this.ActorEmotions?.getSavedEmotion(actorId);
            this._activeActors.set(actorId, {
                img: actorImg,
                name: actor.name,
                emotionId: emotion?.emotionId || null,
                emotionPortrait: emotion?.emotionPortrait || null,
                position: this._activeActors.size,
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
    }

    // 플레이어 캐릭터를 스테이지에 올리기 (플레이어만)
    static _onPlayerActorToggle(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }

        // 스테이지에 없으면 올리기 (이미 있으면 아무것도 하지 않음)
        if (!this._activeActors.has(actorId)) {
            // 새로운 액터를 스테이지에 올리기
            const actorImg = this._getActorImage(actorId) || actor.img;
            const emotion = this.ActorEmotions?.getSavedEmotion(actorId);
            this._activeActors.set(actorId, {
                img: actorImg,
                name: actor.name,
                emotionId: emotion?.emotionId || null,
                emotionPortrait: emotion?.emotionPortrait || null,
                position: this._activeActors.size,
                dialogueVisible: true,
                userId: game.user.id, // 액터를 올린 유저 ID
                emotionUserId: emotion?.emotionId ? game.user.id : undefined // 감정이 있으면 현재 유저
            });
            
            // 항상 DOM 업데이트 (hidden 상태와 관계없이)
            this._updateStageOverlay();
            
            // 모든 유저에게 액터 변경 브로드캐스트
            this._broadcastStageState();
        }
        
        // 스피커 셀렉터에서 선택
        this._selectSpeakerInSelector(actorId);
    }

    // 액터 포트레잇 우클릭 처리 (스테이지 올리기/내리기, GM만)
    static _onActorPortraitRightClick(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }

        // 이미 스테이지에 있으면 내리기
        if (this._activeActors.has(actorId)) {
            const wasSelected = this._isActorSelectedInSelector(actorId);
            this._activeActors.delete(actorId);

            // 현재 선택된 액터를 내렸다면 스피커 기본값으로 복귀
            if (wasSelected) {
                this._resetSpeakerSelectorToDefault();
            }
        } else {
            // 새로운 액터를 스테이지에 올리기
            const actorImg = this._getActorImage(actorId) || actor.img;
            const emotion = this.ActorEmotions?.getSavedEmotion(actorId);
            this._activeActors.set(actorId, {
                img: actorImg,
                name: actor.name,
                emotionId: emotion?.emotionId || null,
                emotionPortrait: emotion?.emotionPortrait || null,
                position: this._activeActors.size,
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
    }

    // 스피커 셀렉터에서 액터 선택
    static _selectSpeakerInSelector(actorId) {
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
        }
    }

    // 현재 스피커 셀렉터에서 특정 액터가 선택되어 있는지 확인
    static _isActorSelectedInSelector(actorId) {
        const selector = document.querySelector('.lichsoma-speaker-selector .speaker-dropdown');
        if (!selector) return false;

        const userCharacterId = game.user.character instanceof Actor
            ? game.user.character.id
            : game.user.character;
        const expectedValue = userCharacterId === actorId ? 'character' : `actor:${actorId}`;

        return selector.value === expectedValue || selector.value === `actor:${actorId}`;
    }

    // 현재 스피커 셀렉터에서 선택된 액터 ID 가져오기
    static _getSelectedSpeakerActorId() {
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
    }

    // 백스테이지에서 현재 선택된 스피커 하이라이트 상태 갱신
    static _updateBackstageSelectedSpeakerHighlight() {
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
    }

    // 스피커 셀렉터를 기본값(첫 번째 옵션)으로 되돌리기
    static _resetSpeakerSelectorToDefault() {
        const selector = document.querySelector('.lichsoma-speaker-selector .speaker-dropdown');
        if (!selector || !selector.options?.length) return;

        selector.selectedIndex = 0;
        $(selector).trigger('change');
        // change 훅 누락/지연 상황 대비 즉시 하이라이트 동기화
        this._updateBackstageSelectedSpeakerHighlight();
    }

    // 스피커 선택 토글: 이미 선택된 액터면 기본값으로 복귀, 아니면 해당 액터 선택
    static _toggleSpeakerSelectionInSelector(actorId) {
        if (this._isActorSelectedInSelector(actorId)) {
            this._resetSpeakerSelectorToDefault();
        } else {
            this._selectSpeakerInSelector(actorId);
        }
    }

    // 소켓 통신 설정
    static setupSocket() {
        game.socket.on('module.lichsoma-speaker-stage', (data) => {
            if (data.action === 'updateStage') {
                this._receiveStageState(data);
            } else if (data.action === 'updateGMStage') {
                this._receiveGMStageState(data);
            } else if (data.action === 'requestSync') {
                this._handleSyncRequest(data);
            } else if (data.action === 'syncState') {
                this._receiveSyncState(data);
            }
        });
    }

    // 현재 활성 액터 목록 직렬화
    static _serializeActiveActors() {
        return Array.from(this._activeActors.entries()).map(([id, data]) => {
            return {
                id,
                img: data.img,
                name: data.name,
                emotionId: data.emotionId || null,
                emotionPortrait: data.emotionPortrait || null,
                position: data.position,
                dialogueVisible: data.dialogueVisible,
                userId: data.userId,
                emotionUserId: data.emotionUserId
            };
        });
    }

    // GM 스테이지 상태 브로드캐스트
    static _broadcastGMStageState() {
        game.socket.emit('module.lichsoma-speaker-stage', {
            action: 'updateGMStage',
            stageActive: this._stageActive,
            userId: game.user.id
        });
    }

    // GM 스테이지 상태 수신
    static _receiveGMStageState(data) {
        if (data.userId === game.user.id) return;
        this._gmStageActive = !!data.stageActive;
        if (this.isStageCentralControlEnabled() && !game.user?.isGM) {
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
    }

    // 플레이어 스테이지 버튼에 GM 상태 표시 반영
    static _updatePlayerStageButtonIndicator() {
        if (game.user?.isGM) return;
        const btn = $(document).find('.lichsoma-speaker-selector .player-stage-toggle-btn');
        if (!btn.length) return;
        if (this.isStageCentralControlEnabled()) {
            btn.attr('aria-pressed', this._stageActive ? 'true' : 'false');
            btn.removeClass('gm-stage-on');
        } else {
            btn.toggleClass('gm-stage-on', this._gmStageActive);
        }
    }

    // 동기화 요청 처리 (GM만 응답)
    static _handleSyncRequest(data) {
        if (!game.user?.isGM) return;
        if (!data?.requestUserId) return;

        game.socket.emit('module.lichsoma-speaker-stage', {
            action: 'syncState',
            targetUserId: data.requestUserId,
            userId: game.user.id,
            gmStageActive: this._stageActive,
            actors: this._serializeActiveActors()
        });
    }

    // 전체 상태 동기화 수신 (요청한 유저만 반영)
    static _receiveSyncState(data) {
        if (data?.targetUserId !== game.user.id) return;
        this._gmStageActive = !!data.gmStageActive;
        if (this.isStageCentralControlEnabled() && !game.user?.isGM) {
            this._stageActive = this._gmStageActive;
            if (this._stageActive) {
                this._showStageOverlay();
            } else {
                this._hideStageOverlay();
            }
        }
        this._updatePlayerStageButtonIndicator();
        this._receiveStageState(data, { skipSenderCheck: true });
    }

    // 스테이지 액터 목록 브로드캐스트
    static _broadcastStageState() {
        const stageData = {
            action: 'updateStage',
            actors: this._serializeActiveActors(),
            userId: game.user.id
        };

        game.socket.emit('module.lichsoma-speaker-stage', stageData);
    }

    // 스테이지 액터 목록 수신
    static _receiveStageState(data, options = {}) {
        // 자신이 보낸 메시지는 무시
        if (!options.skipSenderCheck && data.userId === game.user.id) return;

        // 현재 DOM에 있는 액터들을 _previousActorIds로 설정
        const container = $('#lichsoma-stage-overlay .stage-characters-container');
        this._previousActorIds.clear();
        container.find('.stage-character-wrapper').each((index, element) => {
            const actorId = $(element).attr('data-actor-id');
            if (actorId) {
                this._previousActorIds.add(actorId);
            }
        });

        // 액터 목록 업데이트
        this._activeActors.clear();
        data.actors.forEach(actorData => {
            const actorImg = actorData.emotionPortrait || actorData.img;
            this._activeActors.set(actorData.id, {
                img: actorImg,
                name: actorData.name,
                emotionId: actorData.emotionId,
                emotionPortrait: actorData.emotionPortrait,
                position: actorData.position,
                dialogueVisible: actorData.dialogueVisible,
                userId: actorData.userId,
                emotionUserId: actorData.emotionUserId
            });
        });

        // UI 업데이트
        if (this._stageActive) {
            this._showStageOverlay();
            this._updateStageOverlay();
        } else {
            this._hideStageOverlay();
        }

        // GM인 경우에만 백스테이지 업데이트
        if (game.user.isGM) {
            this._renderBackstage($(document));
        }

        if (!game.user.isGM) {
            this._syncPlayerActorToggleButtonWithStage();
        }
    }

    /** 소켓 등으로 스테이지 액터 목록이 바뀐 뒤 PL 캐릭터 토글(마스크 버튼) pressed 상태 동기화 */
    static _syncPlayerActorToggleButtonWithStage() {
        if (game.user?.isGM) return;
        const characterId =
            game.user.character instanceof Actor ? game.user.character.id : game.user.character;
        const onStage = !!(characterId && this._activeActors.has(characterId));
        $(document)
            .find('.lichsoma-speaker-selector .player-actor-toggle-btn')
            .attr('aria-pressed', onStage ? 'true' : 'false');
    }

    // 스테이지 오버레이 초기화
    static setupStageOverlay() {
        // 이미 존재하면 제거
        $('#lichsoma-stage-overlay').remove();
        
        // 스테이지 오버레이 HTML 생성
        const overlayHTML = $(`
            <div id="lichsoma-stage-overlay" class="hidden">
                <div class="stage-characters-container"></div>
            </div>
        `);
        
        // #interface 안에 추가
        const interfaceElement = $('#interface');
        if (interfaceElement.length) {
            interfaceElement.append(overlayHTML);
        } else {
            // fallback: interface가 없으면 body에 추가
            $('body').append(overlayHTML);
        }
    }

    // 스테이지 오버레이 표시
    static _showStageOverlay() {
        const overlay = $('#lichsoma-stage-overlay');
        overlay.removeClass('hidden');
        this._syncStageOverlaySidebarVar();
    }

    /** 오버레이는 전체 화면; 캐릭터 영역 너비용 --sidebar-width만 갱신 */
    static _syncStageOverlaySidebarVar() {
        const overlay = $('#lichsoma-stage-overlay');
        if (overlay.length) {
            const sidebarWidth = this._getSidebarWidthPx();
            overlay.css('--sidebar-width', `${sidebarWidth}px`);
        }
        Hooks.callAll('lichsomaSpeakerStageLayout');
    }

    // 스테이지 오버레이 숨기기
    static _hideStageOverlay() {
        const overlay = $('#lichsoma-stage-overlay');
        overlay.addClass('hidden');
        // DOM은 유지하여 다시 켤 때 슬라이드 인 애니메이션이 반복되지 않도록 함
    }

    // 스테이지 오버레이 업데이트
    static _updateStageOverlay() {
        this._syncStageOverlaySidebarVar();

        const container = $('#lichsoma-stage-overlay .stage-characters-container');

        // 현재 액터 ID 목록
        const currentActorIds = new Set(this._activeActors.keys());
        
        // 새로 추가된 액터 찾기
        const newActorIds = new Set([...currentActorIds].filter(id => !this._previousActorIds.has(id)));
        
        // 제거된 액터 찾기
        const removedActorIds = new Set([...this._previousActorIds].filter(id => !currentActorIds.has(id)));

        // 제거된 액터 처리
        removedActorIds.forEach(actorId => {
            const wrapper = container.find(`[data-actor-id="${actorId}"]`);
            if (wrapper.length) {
                // 1단계: 슬라이드 아웃 (0.4초)
                wrapper.addClass('removing');
                
                setTimeout(() => {
                    // 2단계: 공간 축소 시작 (0.6초)
                    // 남은 액터들의 폭이 자연스럽게 늘어남
                    wrapper.removeClass('removing').addClass('shrinking');
                    
                    setTimeout(() => {
                        // 3단계: DOM 제거
                        wrapper.remove();
                        // 모든 액터가 제거되었으면 _previousActorIds도 정리
                        if (this._activeActors.size === 0 && container.find('.stage-character-wrapper').length === 0) {
                            this._previousActorIds.clear();
                        }
                    }, 600); // transition 시간(0.6초) 대기
                }, 650); // 슬라이드 아웃 애니메이션(0.65초) 대기
            }
        });

        // 캐릭터 배치 규칙
        const actors = Array.from(this._activeActors.entries());
        const getPositions = (count) => {
            if (count === 1) return ['left'];
            if (count === 2) return ['left', 'right'];
            return ['left', 'center', 'right'];
        };
        const positions = getPositions(actors.length);

        // 나머지 액터들의 위치와 크기 조정 함수
        const updateRemainingActors = () => {
            const gapPx = 12;
            const n = Math.min(actors.length, 5);
            const columnMax =
                n <= 1
                    ? 'calc(50% - 6px)'
                    : `calc((100% - ${(n - 1) * gapPx}px) / ${n})`;
            if (container[0]) {
                container[0].style.setProperty('--stage-column-max', columnMax);
            }

            actors.forEach(([actorId, actorData], index) => {
                if (index >= 5) return;
            
            const position = positions[index] || 'center';
            const existingWrapper = container.find(`[data-actor-id="${actorId}"]`);
            
                if (existingWrapper.length) {
                    // 제거 중인 wrapper인지 확인
                    if (existingWrapper.hasClass('removing') || existingWrapper.hasClass('shrinking')) {
                        // 제거 중인 wrapper는 즉시 제거하고 새로 생성
                        existingWrapper.remove();
                        
                        // 새 액터로 처리
                        const characterWithDialogueHTML = `
                            <div class="stage-character-wrapper ${position} preparing" data-actor-id="${actorId}">
                                <div class="stage-character">
                                    <div class="stage-character-portrait">
                                        <img src="${actorData.img}" alt="${actorData.name}">
                                    </div>
                                    <div class="character-name">${actorData.name}</div>
                                </div>
                                <div class="stage-dialogue-box">
                                    <div class="dialogue-content"></div>
                                </div>
                            </div>
                        `;
                        container.append(characterWithDialogueHTML);
                        
                        // 강제로 reflow 유도
                        const wrapper = container.find(`[data-actor-id="${actorId}"]`);
                        wrapper[0].offsetHeight;
                        
                        // 다음 프레임에 공간 확보 시작 (기존 액터 폭 줄어듦)
                        requestAnimationFrame(() => {
                            wrapper.removeClass('preparing').addClass('expanding');
                            
                            // 폭 확대 애니메이션이 끝난 후 슬라이드 인
                            setTimeout(() => {
                                wrapper.removeClass('expanding').addClass('slide-in-new');
                                
                                // 슬라이드 인 애니메이션 후 클래스 제거
                                setTimeout(() => {
                                    wrapper.removeClass('slide-in-new');
                                }, 500);
                            }, 600); // transition 시간(0.6초) 대기
                        });
                    } else {
                        // 정상적인 기존 액터 - 위치 클래스 업데이트
                        existingWrapper.removeClass('left center right auto');
                        if (position !== 'auto') {
                            existingWrapper.addClass(position);
                        }
                        
                        // 이미지 업데이트 (감정 변경 시)
                        const currentImg = existingWrapper.find('.stage-character-portrait img').attr('src');
                        if (currentImg !== actorData.img) {
                            existingWrapper.find('.stage-character-portrait img').attr('src', actorData.img);
                        }
                    }
            } else {
                // 새 액터 - 추가
                const isNew = newActorIds.has(actorId);
                
                if (isNew) {
                    // 새 액터는 preparing 상태로 시작 (공간을 차지하지 않음)
                    const characterWithDialogueHTML = `
                        <div class="stage-character-wrapper ${position} preparing" data-actor-id="${actorId}">
                            <div class="stage-character">
                                <div class="stage-character-portrait">
                                    <img src="${actorData.img}" alt="${actorData.name}">
                                </div>
                                <div class="character-name">${actorData.name}</div>
                            </div>
                            <div class="stage-dialogue-box">
                                <div class="dialogue-content"></div>
                            </div>
                        </div>
                    `;
                    container.append(characterWithDialogueHTML);
                    
                    // 강제로 reflow 유도
                    const wrapper = container.find(`[data-actor-id="${actorId}"]`);
                    wrapper[0].offsetHeight;
                    
                    // 다음 프레임에 공간 확보 시작 (기존 액터 폭 줄어듦)
                    requestAnimationFrame(() => {
                        wrapper.removeClass('preparing').addClass('expanding');
                        
                        // 폭 확대 애니메이션이 끝난 후 슬라이드 인
                        setTimeout(() => {
                            wrapper.removeClass('expanding').addClass('slide-in-new');
                            
                            // 슬라이드 인 애니메이션 후 클래스 제거
                            setTimeout(() => {
                                wrapper.removeClass('slide-in-new');
                            }, 500);
                        }, 600); // transition 시간(0.6초) 대기
                    });
                } else {
                    // 기존 액터 (소켓으로 받은 경우 등)
                    const characterWithDialogueHTML = `
                        <div class="stage-character-wrapper ${position}" data-actor-id="${actorId}">
                            <div class="stage-character">
                                <div class="stage-character-portrait">
                                    <img src="${actorData.img}" alt="${actorData.name}">
                                </div>
                                <div class="character-name">${actorData.name}</div>
                            </div>
                            <div class="stage-dialogue-box">
                                <div class="dialogue-content"></div>
                            </div>
                        </div>
                    `;
                    container.append(characterWithDialogueHTML);
                }
            }
            });
        };

        // 제거가 있으면 슬라이드 아웃 완료 후(0.4초) 조정 시작
        // 제거가 없으면 즉시 조정
        if (removedActorIds.size > 0) {
            setTimeout(updateRemainingActors, 400);
        } else {
            updateRemainingActors();
        }

        // 이전 액터 ID 목록 업데이트
        this._previousActorIds = new Set(currentActorIds);
    }

    // 액터 이미지 가져오기 (감정 포트레잇 우선)
    static _getActorImage(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;

        // 감정 포트레잇 확인
        if (this.ActorEmotions) {
            const savedEmotion = this.ActorEmotions.getSavedEmotion(actorId);
            if (savedEmotion?.emotionPortrait) {
                return savedEmotion.emotionPortrait;
            }
        }

        // 기본 액터 이미지
        return actor.img;
    }

    // 스테이지의 모든 액터 이미지 업데이트
    static _updateStageActorImages() {
        const overlay = $('#lichsoma-stage-overlay');
        if (!overlay.length) return;

        let emotionChanged = false;

        this._activeActors.forEach((actorData, actorId) => {
            // 다른 유저가 이미 감정을 설정했으면 건드리지 않음
            if (actorData.emotionUserId && actorData.emotionUserId !== game.user.id) {
                return;
            }
            
            // 최신 감정 정보 가져오기 (현재 유저의 감정 설정)
            const emotion = this.ActorEmotions?.getSavedEmotion(actorId);
            const newEmotionPortrait = emotion?.emotionPortrait || null;
            
            // 감정이 변경되었는지 확인
            if (actorData.emotionPortrait !== newEmotionPortrait) {
                emotionChanged = true;
                
                // _activeActors의 감정 정보 업데이트
                actorData.emotionId = emotion?.emotionId || null;
                actorData.emotionPortrait = newEmotionPortrait;
                actorData.img = newEmotionPortrait || game.actors.get(actorId)?.img || actorData.img;
                actorData.emotionUserId = game.user.id;
            }
            
            const wrapper = overlay.find(`[data-actor-id="${actorId}"]`);
            if (wrapper.length && actorData.img) {
                wrapper.find('.stage-character-portrait img').attr('src', actorData.img);
            }
        });

        // 백스테이지 포트레잇도 업데이트
        if (game.user.isGM) {
            this._updateBackstagePortraits();
        }

        // 감정이 변경되었으면 브로드캐스트
        if (emotionChanged) {
            this._broadcastStageState();
        }
    }

    // 백스테이지 포트레잇 업데이트
    static _updateBackstagePortraits() {
        const backstage = $(document).find('.lichsoma-speaker-backstage-container');
        if (!backstage.length) return;

        backstage.find('.actor-portrait').each((index, element) => {
            const actorId = $(element).data('actor-id');
            if (actorId) {
                const img = this._getActorImage(actorId);
                if (img) {
                    $(element).find('img').attr('src', img);
                }
            }
        });
    }

    // 감정 변경 감지 설정
    static setupEmotionChangeDetection() {
        // Dialog 닫힘 감지 (감정 선택 다이얼로그)
        Hooks.on('closeDialog', (dialog) => {
            if (dialog?.data?.title && dialog.data.title.includes('감정')) {
                setTimeout(() => {
                    this._updateStageActorImages();
                }, 100);
            }
        });

        // 액터 업데이트 감지 (감정 관리 창에서 저장)
        Hooks.on('updateActor', (actor, changes) => {
            if (changes.system?.emotions) {
                setTimeout(() => {
                    this._updateStageActorImages();
                }, 100);
            }
        });
    }

    // 채팅 메시지 리스너 설정
    static setupChatMessageListener() {
        Hooks.on('createChatMessage', (message) => {
            this._onChatMessage(message);
        });
    }

    // 채팅 메시지 처리
    static _onChatMessage(message) {
        // smartphone 모듈의 공유 메시지 제외
        if (message.flags?.['lichsoma-fvtt-smartphone']) {
            return;
        }
        
        // IC 메시지만 처리 (일반 채팅)
        const messageStyle = message.style ?? message.type;
        const messageType = message.type;
        const IC_STYLE = CONST.CHAT_MESSAGE_STYLES?.IC ?? CONST.CHAT_MESSAGE_TYPES?.IC ?? 2;
        
        // IC 메시지 체크: style이 IC이거나, type이 'base'이거나, style이 1 또는 2
        const isICMessage = messageStyle === IC_STYLE || 
                           messageType === 'base' || 
                           messageStyle === 1 || 
                           messageStyle === 2;
        
        if (!isICMessage) return;
        
        // 주사위 굴림이 포함된 메시지 제외
        if (message.rolls && message.rolls.length > 0) return;
        
        // flavor가 있는 메시지 제외 (시스템 메시지)
        if (message.flavor) return;
        
        // whisper 메시지 제외
        if (message.whisper && message.whisper.length > 0) return;
        
        const actorId = message.speaker?.actor;
        if (!actorId) return;

        // 스테이지에 있는 액터만 처리
        if (this._activeActors.has(actorId)) {
            this._updateDialogueBox(actorId, message.content);
        }
    }

    // 다이얼로그 박스 내용 업데이트 (타이핑 효과)
    static _updateDialogueBox(actorId, content) {
        const overlay = $('#lichsoma-stage-overlay');
        if (!overlay.length) return;

        const wrapper = overlay.find(`[data-actor-id="${actorId}"]`);
        if (wrapper.length) {
            const dialogueContent = wrapper.find('.dialogue-content');
            
            // 마크다운과 루비 처리
            const processedHtml = this._processMessageText(content);
            
            // 타이핑을 위한 텍스트 추출 (HTML 태그 제외, 루비 주석 제외)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = processedHtml;
            
            // 루비 주석(<rt>) 제거
            const rtElements = tempDiv.querySelectorAll('rt');
            rtElements.forEach(rt => rt.remove());
            
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            
            // 타이핑 속도 가져오기
            const typingSpeed = game.settings.get(this.MODULE_ID, 'typingSpeed');
            
            // 타이핑 효과로 텍스트 업데이트 (HTML 지원)
            this._typeText(actorId, dialogueContent[0], plainText, processedHtml, typingSpeed);
        }
    }

    // 메시지 텍스트 처리 (마크다운 + 루비)
    static _processMessageText(content) {
        if (!content) return '';
        
        // 1. 루비: [[텍스트|루비]] → <ruby>텍스트<rt>루비</rt></ruby>
        content = content.replace(/\[\[([^\|\]]+?)\|([^\]]+?)\]\]/g, '<ruby class="lichsoma-ruby">$1<rt>$2</rt></ruby>');
        
        // 2. 이탤릭 볼드: ***텍스트*** → <strong><em>텍스트</em></strong> (먼저 처리)
        content = content.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        
        // 3. 볼드: **텍스트** → <strong>텍스트</strong>
        content = content.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
        
        // 4. 이탤릭: *텍스트* → <em>텍스트</em>
        content = content.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
        
        // 5. 취소선: ~텍스트~ → <del>텍스트</del>
        content = content.replace(/~([^~]+?)~/g, '<del>$1</del>');
        
        return content;
    }

    // 루비 처리 (지정된 길이만큼만 처리) - 타이핑 효과용
    static _processRubyForTyping(text, maxLength) {
        if (!text) return '';
        
        let result = '';
        let pos = 0;
        let remainingLength = maxLength;
        
        while (pos < text.length && remainingLength > 0) {
            const nextRuby = text.substring(pos).search(/\[\[/);
            if (nextRuby === -1) {
                // 루비 패턴이 더 이상 없음
                const plainPart = text.substring(pos, pos + remainingLength);
                result += this._escapeHtml(plainPart);
                break;
            }
            
            // 루비 패턴 이전의 일반 텍스트
            if (nextRuby > 0) {
                const plainPart = text.substring(pos, pos + Math.min(nextRuby, remainingLength));
                result += this._escapeHtml(plainPart);
                remainingLength -= plainPart.length;
                pos += nextRuby;
            }
            
            // 루비 패턴 찾기
            const rubyMatch = text.substring(pos).match(/^\[\[([^\|\]]+?)\|([^\]]+?)\]\]/);
            if (rubyMatch) {
                const rubyText = rubyMatch[1];
                if (rubyText.length <= remainingLength) {
                    // 전체 루비 표시
                    result += `<ruby class="lichsoma-ruby">${this._escapeHtml(rubyText)}<rt>${this._escapeHtml(rubyMatch[2])}</rt></ruby>`;
                    remainingLength -= rubyText.length;
                    pos += rubyMatch[0].length;
                } else {
                    // 일부만 표시
                    const partial = rubyText.substring(0, remainingLength);
                    result += `<ruby class="lichsoma-ruby">${this._escapeHtml(partial)}<rt>${this._escapeHtml(rubyMatch[2])}</rt></ruby>`;
                    break;
                }
            } else {
                // 루비 패턴이 아님
                result += this._escapeHtml(text[pos]);
                remainingLength--;
                pos++;
            }
        }
        
        return result;
    }

    // HTML 이스케이프
    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    static _clearTypingEffectsForActor(actorId) {
        if (this._currentTypingAnimations.has(actorId)) {
            const timeoutIds = this._currentTypingAnimations.get(actorId);
            timeoutIds.forEach((id) => clearTimeout(id));
            this._currentTypingAnimations.delete(actorId);
        }
        if (this._textClearTimeouts.has(actorId)) {
            clearTimeout(this._textClearTimeouts.get(actorId));
            this._textClearTimeouts.delete(actorId);
        }
    }

    // 타이핑 효과 (HTML 지원)
    static _typeText(actorId, element, plainText, processedHtml, speed) {
        this._clearTypingEffectsForActor(actorId);

        // 텍스트 초기화
        element.innerHTML = '';
        element.style.opacity = '1'; // 페이드아웃에서 복원
        
        const timeouts = [];
        let index = 0;

        const typeChar = () => {
            if (index < plainText.length) {
                const currentChar = plainText[index];
                
                // 공백이 아닌 문자일 때만 사운드 재생
                if (currentChar && currentChar.trim() !== '') {
                    this._playTypingSound();
                }
                
                // 현재까지의 HTML 생성 (마크다운 처리된 상태로)
                const currentHtml = this._processMessageText(plainText.substring(0, index + 1));
                element.innerHTML = currentHtml;
                
                index++;
                const timeoutId = setTimeout(typeChar, speed);
                timeouts.push(timeoutId);
            } else {
                // 타이핑 완료 - 전체 처리된 HTML 표시
                element.innerHTML = processedHtml;
                this._currentTypingAnimations.delete(actorId);
                
                // 텍스트 제거 딜레이 적용
                const clearDelay = game.settings.get(this.MODULE_ID, 'textClearDelay');
                if (clearDelay > 0) {
                    // 기존 제거 타이머가 있으면 취소
                    if (this._textClearTimeouts.has(actorId)) {
                        clearTimeout(this._textClearTimeouts.get(actorId));
                    }
                    
                    // 새 제거 타이머 설정
                    const clearTimeoutId = setTimeout(() => {
                        // 페이드아웃 효과
                        element.style.transition = 'opacity 0.5s ease-out';
                        element.style.opacity = '0';
                        
                        // 페이드아웃 완료 후 텍스트 제거
                        setTimeout(() => {
                            element.innerHTML = '';
                            element.style.opacity = '1'; // 다음 텍스트를 위해 복원
                            this._textClearTimeouts.delete(actorId);
                        }, 500); // 페이드아웃 애니메이션 시간
                    }, clearDelay * 1000);
                    
                    this._textClearTimeouts.set(actorId, clearTimeoutId);
                }
            }
        };

        this._currentTypingAnimations.set(actorId, timeouts);
        typeChar();
    }

    // 타이핑 사운드 재생
    static _playTypingSound() {
        // 스테이지가 활성화되어 있을 때만 재생
        if (!this._stageActive) return;
        
        const soundPath = game.settings.get(this.MODULE_ID, 'typingSoundPath');
        const volume = game.settings.get(this.MODULE_ID, 'typingSoundVolume');
        
        if (!soundPath || soundPath.trim() === '') return;
        
        try {
            // Foundry V12+: foundry.audio.AudioHelper 사용
            // 하위 호환성을 위해 fallback 추가
            const AudioHelperClass = foundry?.audio?.AudioHelper ?? AudioHelper;
            AudioHelperClass.play({
                src: soundPath,
                volume: volume,
                loop: false
            }, false);
        } catch (error) {
            // 사운드 재생 실패 시 무시
            console.warn('LichSOMA Speaker Stage | 타이핑 사운드 재생 실패:', error);
        }
    }
}

// Hooks 등록
Hooks.once('init', () => {
    SpeakerStage.initialize();
});

Hooks.once('ready', () => {
    // 폰트 설정 초기 적용 (저장값 따옴표 정규화는 Selector와 동일)
    const dialogueFont = SpeakerStage._normalizeFontFamilyName(
        game.settings.get(SpeakerStage.MODULE_ID, 'dialogueFont')
    );
    const dialogueFontSize = game.settings.get(SpeakerStage.MODULE_ID, 'dialogueFontSize');
    const characterNameFont = SpeakerStage._normalizeFontFamilyName(
        game.settings.get(SpeakerStage.MODULE_ID, 'characterNameFont')
    );
    const characterNameFontSize = game.settings.get(SpeakerStage.MODULE_ID, 'characterNameFontSize');

    SpeakerStage._updateDialogueFontFamily(dialogueFont);
    SpeakerStage._updateDialogueFontSize(dialogueFontSize);
    SpeakerStage._updateCharacterNameFontFamily(characterNameFont);
    SpeakerStage._updateCharacterNameFontSize(characterNameFontSize);
    
    if (game.user.isGM) {
        // GM: 백스테이지 설정
        SpeakerStage.setupBackstage();
        SpeakerStage._broadcastGMStageState();
        
        // 초기 렌더링 (speaker selector가 준비될 때까지 폴링)
        let attempts = 0;
        const maxAttempts = 10;
        const checkAndRender = () => {
            attempts++;
            const chatForm = $('#sidebar .chat-form');
            const speakerSelector = chatForm.find('.lichsoma-speaker-selector');
            
            if (!SpeakerStage._isSidebarCollapsed() && chatForm.length && speakerSelector.length) {
                SpeakerStage._renderBackstage($(document));
            } else if (attempts < maxAttempts) {
                setTimeout(checkAndRender, 100);
            }
        };
        checkAndRender();
    } else {
        // 플레이어: 스테이지 토글 버튼 초기 렌더링 (speaker selector가 준비될 때까지 폴링)
        let attempts = 0;
        const maxAttempts = 10;
        const checkAndRender = () => {
            attempts++;
            const speakerSelector = $(document).find('.lichsoma-speaker-selector');
            
            if (!SpeakerStage._isSidebarCollapsed() && speakerSelector.length) {
                SpeakerStage._renderPlayerStageToggle($(document));
            } else if (attempts < maxAttempts) {
                setTimeout(checkAndRender, 100);
            }
        };
        checkAndRender();

        // 지연 접속 플레이어를 위한 초기 상태 동기화 요청
        game.socket.emit('module.lichsoma-speaker-stage', {
            action: 'requestSync',
            requestUserId: game.user.id
        });
    }
});
