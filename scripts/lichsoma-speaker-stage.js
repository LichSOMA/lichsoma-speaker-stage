/** Speaker Stage entry point: shared state, feature composition, and Foundry lifecycle. */
import './lichsoma-speaker-stage-compat.js';
import { ActorEmotions } from '../../lichsoma-speaker-selector/scripts/lichsoma-actor-emotions.js';
import { stageSettingsMethods } from './lichsoma-stage-settings.js';
import { stageIntegrationsMethods } from './lichsoma-stage-integrations.js';
import { stageStandingMethods } from './lichsoma-stage-standing.js';
import { stageBackstageMethods } from './lichsoma-stage-backstage.js';
import { stageSocketMethods } from './lichsoma-stage-socket.js';
import { stageSyncMethods } from './lichsoma-stage-sync.js';
import { stageOverlayMethods } from './lichsoma-stage-overlay.js';
import { stagePortraitsMethods } from './lichsoma-stage-portraits.js';
import { stageChatMethods } from './lichsoma-stage-chat.js';
import { createStandingManagerApp } from './lichsoma-stage-standing-manager.js';
import { createStageWebfontEditors } from './lichsoma-stage-webfont-editor.js';

export class SpeakerStage {
    /** Speaker Selector와 동일한 설정 네임스페이스·키 (등록 스피커 그리드) */
    static SELECTOR_MODULE_ID = 'lichsoma-speaker-selector';
    static SELECTOR_SETTING_ACTOR_GRID = 'actorGridActors';

    static MODULE_ID = 'lichsoma-speaker-stage';
    static SETTINGS = {
        CHARACTER_NAME_WEBFONT_CSS: 'characterNameWebfontCSS',
        DIALOGUE_WEBFONT_CSS: 'dialogueWebfontCSS'
    };
    static _isRenderingBackstage = false;
    static _stageActive = false;
    static _gmStageActive = false; // GM의 스테이지 ON 상태(플레이어 표시용)
    static _primaryGMId = null;
    static _pendingSyncRequestId = null;
    static _pendingSyncAuthorityId = null;
    static _syncRequestCounter = 0;
    static _syncClock = 0;
    static _syncVersions = new Map();
    static _syncRecentPackets = new Map();
    static _pendingSyncEvents = new Map();
    static _syncReplaying = false;
    static _syncRetryTimer = null;
    static _syncRetryCount = 0;
    static _syncUnavailableAuthorities = new Set();
    static _syncReady = false;
    static _hasSynchronizedStage = false;
    static _stageRetirements = new Map();
    static _pendingStageChat = new Map();
    static _pendingStageFocus = new Map();
    static _suppressStageFocusBroadcast = false;
    static _waitingSyncRequests = new Map();
    static _waitingGMStageRequest = null;
    static _controlIntentStamp = null;
    static _activeActors = new Map(); // actorId -> { img, name, position, dialogueVisible }
    static _currentTypingAnimations = new Map(); // actorId -> typing timeout IDs
    static _textClearTimeouts = new Map(); // actorId -> clear timeout ID
    static _textFadeTimeouts = new Map(); // actorId -> { timeoutId, element, previousTransition }
    static _portraitFadeTimers = new WeakMap(); // 포트레잇 페이드 교체 타이머
    static _directChatInputDetectionBound = false; // 직접 입력 감지 이벤트 등록 여부
    static _directChatInputPendingUntil = 0; // 직접 입력으로 생성될 메시지 허용 시각
    static _directChatInputPendingText = ''; // 직접 입력 원문 비교용
    static _directChatInputPendingUserId = null; // 직접 입력 유저
    static STANDING_FLAG = 'standings'; // 액터별 스탠딩 이미지 플래그
    static _standingManagerApp = null; // 스탠딩 관리 창
    static _activeStandingActorId = null; // GM 영역에서 가장 앞에 표시할 액터
    static _activePlayerStandingActorId = null; // 플레이어 영역에서 마지막으로 말해 가장 앞에 표시할 액터
    static _standingDialogueActorIds = { gm: null, player: null }; // 좌/우 대화창에 마지막으로 표시된 액터
    static _lastStandingSpeakerSide = null; // 마지막으로 실제 발화한 진영(gm/player)
    static _stageOverlayHideTimer = null; // 배경 페이드아웃 완료 전 hidden 적용 지연
    static _stageOverlayShowTimer = null; // 스테이지 ON 시 기존 스피커 페이드인 클래스 정리
    static _standingExitTimers = new Map(); // 공통 캐릭터 퇴장 애니메이션 타이머
    static _standingDialogueExitTimer = null; // 공통 진영 대화창 퇴장 타이머
    static _backstageRegistrySyncTimers = new Set(); // 스피커 셀렉터 등록 목록 지연 동기화 타이머
    static _backstageMutationObserver = null; // 스피커 셀렉터 DOM 변경 감지
    static _backstageMutationRenderTimer = null; // DOM 변경 기반 백스테이지 렌더 디바운스
    static _externalHudIntegrationObserver = null; // 타 모듈 HUD와 스피커 스테이지 레이어 상태 동기화
    static _externalHudIntegrationTimer = null; // HUD 통합 상태 갱신 디바운스
    static _externalHudIntegrationStarted = false; // 중복 초기화 방지
    static _externalHudInteractionBlockerBound = false; // 외부 HUD 이벤트 캡처 차단 등록 여부

    /** @type {ResizeObserver | null} dx3rd-action-hud와 동일하게 #sidebar 관측 */
    static _stageSidebarRO = null;
    /** @type {Element | null} */
    static _stageSidebarROElement = null;
    static _stageSidebarLayoutBound = false;

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

        // 외부 HUD(CAIN Alter 등)와 스테이지 레이어 상태 동기화
        this.setupExternalHudIntegration();
        
        // 소켓 통신 설정
        this.setupSocket();
        
        // 플레이어 스테이지 토글 버튼 설정 (모든 유저)
        this.setupPlayerStageToggle();
        
        // 감정 변경 감지 설정
        this.setupEmotionChangeDetection();

        // 액터 시트 스탠딩 관리 버튼 설정
        this.setupStandingActorSheetButton();
        
        // 채팅 입력창에서 직접 보낸 메시지 감지 설정
        this.setupChatInputDetection();

        // 채팅 메시지 감지 설정
        this.setupChatMessageListener();
        
        // 월드 설정 변경 (본 모듈 + 스피커 셀렉터 등록 그리드)
        Hooks.once('ready', () => {
            Hooks.on('updateSetting', (setting) => {
                this._onWorldSettingChanged(setting);
                this._onSpeakerSelectorActorGridSetting(setting);
            });
        });
    }
}

// Keep the existing static API and a single set of actor/timer/socket state.
// Preserve class-method descriptors; duplicate names are an assembly error.
for (const methods of [
    stageSettingsMethods,
    stageIntegrationsMethods,
    stageStandingMethods,
    stageBackstageMethods,
    stageSocketMethods,
    stageSyncMethods,
    stageOverlayMethods,
    stagePortraitsMethods,
    stageChatMethods
]) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
        if (Object.hasOwn(SpeakerStage, name)) throw new Error(`Duplicate SpeakerStage method: ${name}`);
        Object.defineProperty(SpeakerStage, name, { ...descriptor, enumerable: false });
    }
}
SpeakerStage.applications = {
    LichsomaStandingManagerApp: createStandingManagerApp(SpeakerStage),
    ...createStageWebfontEditors(SpeakerStage)
};

// Hooks 등록
Hooks.once('init', () => {
    SpeakerStage.initialize();
});

Hooks.once('ready', () => {
    const dialogueWebfontCSS = game.settings.get(SpeakerStage.MODULE_ID, SpeakerStage.SETTINGS.DIALOGUE_WEBFONT_CSS);
    const dialogueFontSize = game.settings.get(SpeakerStage.MODULE_ID, 'dialogueFontSize');
    const characterNameWebfontCSS = game.settings.get(SpeakerStage.MODULE_ID, SpeakerStage.SETTINGS.CHARACTER_NAME_WEBFONT_CSS);
    const characterNameFontSize = game.settings.get(SpeakerStage.MODULE_ID, 'characterNameFontSize');

    SpeakerStage._updateDialogueWebfontCSS(dialogueWebfontCSS);
    SpeakerStage._updateDialogueFontSize(dialogueFontSize);
    SpeakerStage._updateCharacterNameWebfontCSS(characterNameWebfontCSS);
    SpeakerStage._updateCharacterNameFontSize(characterNameFontSize);
    
    if (game.user.isGM) {
        // GM: 백스테이지 설정
        SpeakerStage.setupBackstage();
        
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

    }

    // Secondary GMs also need the existing stage, not only late-joining PLs.
    SpeakerStage._requestStageSync({initial:true});
    SpeakerStage._scheduleExternalHudIntegrationSync();
});
