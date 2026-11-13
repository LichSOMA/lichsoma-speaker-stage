/** chat: methods are attached to SpeakerStage; this is the shared stage controller. */
import { formatStageDialogue, buildStageTypingPlan, escapeStageHTML } from './lichsoma-stage-dialogue.js';

export const stageChatMethods = {
    _isChatInputElement(element) {
        if (!element) return false;

        if (element.closest?.('.app.window-app.actor, .application.actor, .actor.sheet, .item.sheet')) {
            return false;
        }

        const form = element.closest?.('#chat-form, .chat-form, form[data-application-part="chat-form"], form');
        if (!form) return false;

        return !!form.closest?.('#sidebar, #chat, .chat-sidebar, [data-tab="chat"]')
            || form.id === 'chat-form'
            || form.classList?.contains('chat-form')
            || form.matches?.('form[data-application-part="chat-form"]');
    },

    _getChatInputTextFromElement(element) {
        const form = element?.closest?.('#chat-form, .chat-form, form[data-application-part="chat-form"], form') || null;
        const input = form?.querySelector?.('textarea[name="message"], textarea, [contenteditable="true"]')
            || (element?.matches?.('textarea, [contenteditable="true"]') ? element : null);

        if (!input) return '';

        if (input.matches?.('[contenteditable="true"]')) {
            return input.innerText || input.textContent || '';
        }

        return input.value || '';
    },

    _isDirectChatInputExcludedCommand(text) {
        if (!text) return false;

        // /desc는 장면/묘사용 채팅으로 취급하고 스테이지 대화창에는 표시하지 않는다.
        return /^\s*\/desc\b/i.test(String(text));
    },

    _normalizeDirectDialogueText(text) {
        if (!text) return '';

        let value = String(text);

        if (/<[a-z][\s\S]*>/i.test(value)) {
            const fragment = formatStageDialogue(value);
            fragment.querySelectorAll('rt').forEach(rt => rt.remove());
            value = fragment.textContent || '';
        }

        return value
            // Foundry /ic, /em 같은 직접 입력 명령은 원문 비교에서 명령어 부분만 제거
            .replace(/^\s*\/[a-zA-Z]+\s+/, '')
            // LichSOMA 루비 원문 [[텍스트|루비]]는 표시 텍스트 기준으로 비교
            .replace(/\[\[([^|\]]+?)\|[^\]]+?\]\]/g, '$1')
            // 간단한 마크다운 기호 제거
            .replace(/\*\*\*([^*]+?)\*\*\*/g, '$1')
            .replace(/\*\*([^*]+?)\*\*/g, '$1')
            .replace(/\*([^*]+?)\*/g, '$1')
            .replace(/~~([^~]+?)~~/g, '$1')
            .replace(/~([^~]+?)~/g, '$1')
            .replace(/[`_]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    },

    _markDirectChatInput(element) {
        if (!this._isChatInputElement(element)) return;

        const text = this._getChatInputTextFromElement(element);
        if (!text || !text.trim()) return;

        this._directChatInputPendingText = text;
        this._directChatInputPendingUntil = Date.now() + 3000;
        this._directChatInputPendingUserId = game.user?.id || null;
    },

    setupChatInputDetection() {
        if (this._directChatInputDetectionBound) return;
        this._directChatInputDetectionBound = true;

        document.addEventListener('submit', (event) => {
            if (this._isChatInputElement(event.target)) {
                this._markDirectChatInput(event.target);
            }
        }, true);

        document.addEventListener('keydown', (event) => {
            if (event.isComposing) return;
            if (event.key !== 'Enter') return;
            if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
            if (!this._isChatInputElement(event.target)) return;

            this._markDirectChatInput(event.target);
        }, true);

        document.addEventListener('click', (event) => {
            const button = event.target?.closest?.('button, a, [role="button"]');
            if (!button) return;

            const action = button.dataset?.action || '';
            const looksLikeSend =
                action === 'send' ||
                action === 'sendMessage' ||
                action === 'createMessage' ||
                button.classList?.contains('chat-submit') ||
                button.querySelector?.('.fa-paper-plane, .fa-comment, .fa-message');

            if (!looksLikeSend) return;
            if (!this._isChatInputElement(button)) return;

            this._markDirectChatInput(button);
        }, true);
    },

    _consumeDirectChatInputForMessage(message) {
        const now = Date.now();
        if (now > this._directChatInputPendingUntil) return false;
        if (this._directChatInputPendingUserId && this._directChatInputPendingUserId !== game.user?.id) return false;

        if (this._isDirectChatInputExcludedCommand(this._directChatInputPendingText)) {
            this._directChatInputPendingUntil = 0;
            this._directChatInputPendingText = '';
            this._directChatInputPendingUserId = null;
            return false;
        }

        const pendingText = this._normalizeDirectDialogueText(this._directChatInputPendingText);
        const messageText = this._normalizeDirectDialogueText(message?.content || '');

        if (pendingText && messageText) {
            const matches = pendingText === messageText
                || pendingText.includes(messageText)
                || messageText.includes(pendingText);

            if (!matches) return false;
        }

        this._directChatInputPendingUntil = 0;
        this._directChatInputPendingText = '';
        this._directChatInputPendingUserId = null;

        return true;
    },

    _markMessageAsDirectChatInput(message) {
        if (!message) return;

        const existingFlags = message.flags?.[this.MODULE_ID] || {};
        const actorId = message.speaker?.actor;
        const actorData = this._activeActors.get(String(actorId));
        const stageFlags = foundry.utils.mergeObject(existingFlags, {
            directChatInput: true,
            syncStamp:this._nextSyncStamp(),
            stagedPlacementId:actorData ? this._getStagePlacementId(actorId,actorData) : null
        }, { inplace: false });

        message.updateSource({
            flags: {
                [this.MODULE_ID]: stageFlags
            }
        });
    },

    _isDirectChatInputMessage(message) {
        return message?.flags?.[this.MODULE_ID]?.directChatInput === true;
    },

    // 채팅 메시지 리스너 설정
    setupChatMessageListener() {
        Hooks.on('preCreateChatMessage', (message, data, options, userId) => {
            if (userId !== game.user?.id) return;

            if (this._consumeDirectChatInputForMessage(message)) {
                this._markMessageAsDirectChatInput(message);
            }
        });

        Hooks.on('createChatMessage', (message) => {
            this._onChatMessage(message);
        });
    },

    // 채팅 메시지 처리
    _onChatMessage(message) {
        // smartphone 모듈의 공유 메시지 제외
        if (message.flags?.['lichsoma-fvtt-smartphone']) {
            return;
        }
        
        // 채팅 입력창에서 직접 작성한 메시지만 스테이지 대화창에 표시한다.
        // 액터 시트, 아이템 시트, 시스템 카드에서 출력한 IC 메시지는 제외한다.
        if (!this._isDirectChatInputMessage(message)) return;

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
        
        const authorId = message.author?.id ?? message.user?.id ?? message.user
            ?? message.flags?.[this.MODULE_ID]?.syncStamp?.userId;
        if (this.isPlayerStageDisabled() && !this._getSocketUser(authorId)?.isGM) return;
        const actorId = message.speaker?.actor ? String(message.speaker.actor) : null;
        if (!actorId) return;
        const stageFlags = message.flags?.[this.MODULE_ID] || {};
        const placementId = stageFlags.stagedPlacementId;
        if (placementId != null && (typeof placementId !== 'string' || placementId.length > 512
            || this._stageRetirements.has(`${actorId}:${placementId}`))) return;

        // 스테이지에 있는 액터만 처리한다.
        // 이미지 종류와 무관하게 발화 액터의 소속에 따라 GM/플레이어 대화창을 갱신한다.
        if (!this._canChatMessageUpdateDialogue(actorId)) {
            // A staged sender can reach the chat service before its module socket
            // placement reaches this client. Keep only a short, bounded last line.
            if (placementId && game.actors.get(actorId)) {
                this._pendingStageChat.delete(actorId);
                this._pendingStageChat.set(actorId,{message,until:Date.now()+5000});
                if (this._pendingStageChat.size > 50) this._pendingStageChat.delete(this._pendingStageChat.keys().next().value);
            }
            return;
        }
        if (placementId && this._getStagePlacementId(actorId,this._activeActors.get(actorId)) !== placementId) return;
        const side = this._getStandingSideForActor(actorId);
        const stamp = stageFlags.syncStamp ?? (Number.isSafeInteger(message.timestamp) && typeof authorId === 'string'
            ? {clock:message.timestamp,userId:authorId} : null);
        if (stamp && (!this._isSyncStamp(stamp) || stamp.userId !== authorId)) return;
        if (!this._recordSyncPacket({action:'stageChat',side,userId:authorId,stamp,message})) return;
        const updateFocus = !stamp || this._compareSyncStamps(stamp,this._syncVersions.get(`focus:${side}`)) > 0;
        const updateFront = !stamp || this._compareSyncStamps(stamp,this._syncVersions.get('spoken')) > 0;
        if (stamp && updateFocus) this._syncVersions.set(`focus:${side}`,{...stamp});
        if (stamp && updateFront) this._syncVersions.set('spoken',{...stamp});

        this._updateDialogueBox(actorId, message.content, {updateFocus,updateFront});
    },

    _flushPendingStageChat() {
        for (const [actorId,queued] of this._pendingStageChat) {
            if (queued.until < Date.now()) { this._pendingStageChat.delete(actorId); continue; }
            if (!this._activeActors.has(actorId)) continue;
            this._pendingStageChat.delete(actorId);
            this._onChatMessage(queued.message);
        }
    },

    _canChatMessageUpdateDialogue(actorId) {
        if (!actorId || !this._activeActors.has(String(actorId))) return false;
        // 실제로 말한 액터가 자기 진영의 공유 대화창을 갱신하고
        // 해당 진영에서 가장 앞에 표시된다.
        return true;
    },

    // 다이얼로그 박스 내용 업데이트 (타이핑 효과)
    _updateDialogueBox(actorId, content, {updateFocus = true, updateFront = true} = {}) {
        const overlay = $('#lichsoma-stage-overlay');
        if (!overlay.length) return;
        if (!this._activeActors.size || !actorId || !this._activeActors.has(actorId)) return;

        const actorKey = String(actorId);
        const side = this._getStandingSideForActor(actorKey);
        this._standingDialogueActorIds[side] = actorKey;
        if (updateFront) this._lastStandingSpeakerSide = side;
        if (!updateFocus) {
            this._updateStandingFocus();
        } else if (side === 'player') {
            this._setActivePlayerStandingActor(actorKey);
        } else {
            this._setActiveStandingActor(actorKey);
        }

        const region = overlay.find(`.stage-standing-dialogue-region-${side}`);
        const dialogueContent = region.find('.stage-standing-dialogue-box .dialogue-content');
        if (!dialogueContent.length) return;
        const actorName = this._activeActors.get(actorKey)?.name || game.actors.get(actorKey)?.name || '';
        region.find('.stage-standing-dialogue-name').text(actorName);
        
        // 마크다운과 루비를 안전한 DOM으로 한 번 구성한다.
        const formattedContent = this._processMessageText(content);
        
        const typingSpeed = game.settings.get(this.MODULE_ID, 'typingSpeed');
        
        // 각 진영은 독립된 타이핑/제거 타이머를 사용한다.
        this._typeText(`standing:${side}`, dialogueContent[0], formattedContent, typingSpeed);
    },

    // Share Speaker Selector's inline syntax; retain safe rich-text elements.
    _processMessageText(content) { return formatStageDialogue(content); },

    _escapeHtml(text) { return escapeStageHTML(text); },

    _clearTypingEffectsForActor(actorId) {
        if (this._currentTypingAnimations.has(actorId)) {
            const timeoutIds = this._currentTypingAnimations.get(actorId);
            timeoutIds.forEach((id) => clearTimeout(id));
            this._currentTypingAnimations.delete(actorId);
        }
        if (this._textClearTimeouts.has(actorId)) {
            clearTimeout(this._textClearTimeouts.get(actorId));
            this._textClearTimeouts.delete(actorId);
        }
        const fade = this._textFadeTimeouts.get(actorId);
        if (fade) {
            clearTimeout(fade.timeoutId);
            fade.element.style.transition = fade.previousTransition;
            fade.element.style.opacity = '1';
            this._textFadeTimeouts.delete(actorId);
        }
    },

    // 타이핑 효과 (HTML 지원)
    _typeText(actorId, element, formattedContent, speed) {
        this._clearTypingEffectsForActor(actorId);

        // 텍스트 초기화
        const plan = buildStageTypingPlan(formattedContent);
        element.replaceChildren(plan.fragment);
        element.style.opacity = '1'; // 페이드아웃에서 복원
        
        const timeouts = [];
        let index = 0;

        const typeChar = () => {
            if (index < plan.steps.length) {
                const currentChar = plan.steps[index].grapheme;
                
                // 공백이 아닌 문자일 때만 사운드 재생
                if (currentChar && currentChar.trim() !== '') {
                    this._playTypingSound();
                }
                
                plan.steps[index].reveal();
                
                index++;
                const timeoutId = setTimeout(typeChar, speed);
                timeouts.push(timeoutId);
            } else {
                // DOM을 교체하지 않고 루비 읽기의 임시 표시만 마무리한다.
                plan.finish();
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
                        this._textClearTimeouts.delete(actorId);
                        const previousTransition = element.style.transition;
                        // 페이드아웃 효과
                        element.style.transition = 'opacity 0.5s ease-out';
                        element.style.opacity = '0';
                        
                        // 페이드아웃 완료 후 텍스트 제거
                        const fadeTimeoutId = setTimeout(() => {
                            element.replaceChildren();
                            element.style.transition = previousTransition;
                            element.style.opacity = '1'; // 다음 텍스트를 위해 복원
                            this._textFadeTimeouts.delete(actorId);
                        }, 500); // 페이드아웃 애니메이션 시간
                        this._textFadeTimeouts.set(actorId, {
                            timeoutId: fadeTimeoutId, element, previousTransition
                        });
                    }, clearDelay * 1000);
                    
                    this._textClearTimeouts.set(actorId, clearTimeoutId);
                }
            }
        };

        this._currentTypingAnimations.set(actorId, timeouts);
        typeChar();
    },

    // 타이핑 사운드 재생
    _playTypingSound() {
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
    },
};
