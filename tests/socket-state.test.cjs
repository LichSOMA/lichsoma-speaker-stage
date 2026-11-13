const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {stageTestSource}=require('./stage-test-loader.cjs');
const source=stageTestSource();

function world() {
    const users=[{id:'gm1',isGM:true,active:true},{id:'gm2',isGM:true,active:true},
        {id:'pl',isGM:false,active:true,character:'c'},{id:'other',isGM:false,active:true,character:'d'}];
    const collection={contents:users,get:id=>users.find(u=>u.id===id),get activeGM(){return users.find(u=>u.isGM&&u.active)}};
    const actors=new Map(['a','b','c','d'].map(id=>[id,{id,name:'Actor '+id,img:id+'.png',
        testUserPermission:user=>user.character===id}]));
    const queue=[],clients=[];
    function client(id) {
        const hooks=new Map(),chain={length:0,find(){return this},each(){return this},toggleClass(){return this},text(){return this},css(){return this},empty(){return this},remove(){return this}};
        let now=0,nextTimer=0;const timers=new Map();
        const network=new Map();
        const game={user:collection.get(id),users:collection,actors,socket:{
            on(channel,handler){network.set(channel,handler);if(channel==='module.lichsoma-speaker-stage')game.handler=handler},emit(channel,data){queue.push({from:id,data})}
        }};
        const context=vm.createContext({game,CONST:{CHAT_MESSAGE_STYLES:{IC:2}},document:{querySelectorAll:()=>[],querySelector:()=>null},$:()=>chain,
            Hooks:{on:(name,callback)=>hooks.set(name,callback),once(){}},
            setTimeout(callback,delay){const timer=++nextTimer;timers.set(timer,{callback,time:now+Number(delay)});return timer},
            clearTimeout(timer){timers.delete(timer)}});
        vm.runInContext(source,context);
        const stage=context.Stage;
        stage.isStageCentralControlEnabled=()=>true;
        for(const method of ['_showStageOverlay','_hideStageOverlay','_updateStageOverlay','_renderBackstage',
            '_updateBackstagePortraits','_syncPlayerActorToggleButtonWithStage','_updatePlayerStageButtonIndicator',
            '_clearStandingDialogueSide','_resetSpeakerSelectorToDefault'])stage[method]=()=>{};
        stage._isActorSelectedInSelector=()=>false;
        stage._syncReady=true;stage._hasSynchronizedStage=true;
        stage.setupSocket();stage._primaryGMId='gm1';
        const advance=ms=>{const end=now+ms;let guard=0;while(true){const entry=[...timers].filter(([,v])=>v.time<=end).sort((a,b)=>a[1].time-b[1].time)[0];if(!entry)break;assert.ok(++guard<100);now=entry[1].time;timers.delete(entry[0]);entry[1].callback()}now=end};
        const result={stage,game,hooks,network,advance,timers,context};clients.push(result);return result;
    }
    const gm1=client('gm1'),gm2=client('gm2'),pl=client('pl'),other=client('other');
    const initial=[['a',{userId:'gm1',img:'a.png',name:'A',placementId:'a-1',position:0}],['b',{userId:'gm2',img:'b.png',name:'B',placementId:'b-1',position:1}],['c',{userId:'pl',img:'c.png',name:'C',placementId:'c-1',position:2}]];
    clients.forEach(c=>c.stage._activeActors=new Map(initial.map(([id,v])=>[id,{...v}])));
    function drain() {
        let count=0;while(queue.length){assert.ok(++count<100,'socket loop');const {data}=queue.shift();
            clients.filter(c=>c.game.user.active&&c.game.socket.connected!==false).forEach(c=>c.game.handler(data));}
    }
    const ids=c=>[...c.stage._activeActors.keys()].sort();
    return {gm1,gm2,pl,other,queue,clients,collection,drain,ids,createClient:client};
}

test('only first active GM responds, and sync responses must match the pending request',()=>{
    const w=world();w.pl.stage._requestStageSync();const request=w.queue.shift().data;
    w.gm1.game.handler(request);w.gm2.game.handler(request);
    assert.equal(w.queue.length,1);assert.equal(w.queue[0].data.userId,'gm1');
    const response=w.queue.shift().data;
    w.pl.game.handler({...response,userId:'gm2'});assert.ok(w.pl.stage._pendingSyncRequestId);
    w.pl.game.handler({...response,requestId:'stale'});assert.ok(w.pl.stage._pendingSyncRequestId);
    w.pl.game.handler({...response,targetUserId:'other'});assert.ok(w.pl.stage._pendingSyncRequestId);
    w.pl.game.handler(response);assert.equal(w.pl.stage._pendingSyncRequestId,null);
    assert.deepEqual(w.ids(w.pl),['a','b','c']);
    w.pl.game.handler({...response,actors:[]});assert.deepEqual(w.ids(w.pl),['a','b','c'],'replayed snapshot is ignored');
});

test('race: late initial snapshot does not undo newer actor images or local edits',()=>{
    const w=world();w.pl.stage._requestStageSync();w.gm1.game.handler(w.queue.shift().data);
    const snapshot=w.queue.shift().data;
    w.gm1.stage._activeActors.get('a').img='remote-new.png';w.gm1.stage._broadcastStageState();
    const remote=w.queue.shift().data;w.pl.game.handler(remote);
    w.pl.stage._activeActors.get('c').img='local-new.png';w.pl.stage._broadcastStageState();
    w.pl.game.handler(snapshot);
    assert.equal(w.pl.stage._activeActors.get('a').img,'remote-new.png');
    assert.equal(w.pl.stage._activeActors.get('c').img,'local-new.png');
});

test('race: delayed owner snapshot cannot resurrect a GM-removed placement',()=>{
    const w=world();w.pl.stage._broadcastStageState();const stale=w.queue.shift().data;
    w.gm1.stage._requestActorRemoval('c');w.drain();
    for(const c of w.clients)c.game.handler(stale);
    for(const c of w.clients)assert.equal(c.stage._activeActors.has('c'),false);
});

test('race: delayed removal of an old placement does not remove a deliberate re-entry',()=>{
    const w=world();w.gm1.stage._requestActorRemoval('c');const removal=w.queue.shift().data;
    w.pl.game.handler(removal);
    w.pl.stage._activeActors.set('c',{userId:'pl',img:'new.png',name:'C',placementId:'c-2',position:3});
    w.pl.stage._broadcastStageState();const entry=w.queue.shift().data;
    w.clients.forEach(c=>c.game.handler(entry));w.clients.forEach(c=>c.game.handler(removal));
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('c')?.placementId,'c-2');
});

test('race: late initial snapshot cannot restore an older central-control value',()=>{
    const w=world();w.gm1.stage._stageActive=true;
    w.pl.stage._requestStageSync();w.gm1.game.handler(w.queue.shift().data);const snapshot=w.queue.shift().data;
    w.gm1.stage._stageActive=false;w.gm1.stage._broadcastGMStageState();w.pl.game.handler(w.queue.shift().data);
    w.pl.game.handler(snapshot);assert.equal(w.pl.stage._stageActive,false);
});

test('race: ordinary GM image updates do not rewind the last speaking side',()=>{
    const w=world();w.gm1.stage._lastStandingSpeakerSide='gm';w.pl.stage._lastStandingSpeakerSide='player';
    w.gm1.stage._broadcastStageState();w.pl.game.handler(w.queue.shift().data);
    assert.equal(w.pl.stage._lastStandingSpeakerSide,'player');
});

test('race: GM rendering preserves a remote focus instead of applying local dropdown selection',()=>{
    const w=world(),s=w.gm2.stage;s.isStandingEnabled=()=>true;
    s._getSelectedSpeakerActorId=()=> 'a';s._activeStandingActorId='b';s._updateStandingFocus();
    assert.equal(s._activeStandingActorId,'b');
});

test('race: GM emotion changes to a PL placement reach every client',()=>{
    const w=world(),s=w.gm1.stage;
    s._getActorEmotionData=()=>({img:'happy.png',emotionId:'happy',emotionPortrait:'happy.png',isStandingImage:false,emotionUserId:'gm1'});
    s._updateStagePortraitElement=()=>{};s._updateBackstagePortraitElement=()=>{};
    s._updateActorEmotionOnStage('c');w.drain();
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('c').img,'happy.png');
});

test('race: a lost sync response is retried and an older response stays invalid',()=>{
    const w=world();w.pl.stage._requestStageSync();const first=w.queue.shift().data;
    w.pl.advance(2500);assert.ok(w.queue.length,'retry request emitted');
    const retry=w.queue.shift().data;assert.notEqual(retry.requestId,first.requestId);
    w.gm1.game.handler(first);w.pl.game.handler(w.queue.shift().data);
    assert.equal(w.pl.stage._pendingSyncRequestId,retry.requestId);
    w.gm1.game.handler(retry);w.pl.game.handler(w.queue.shift().data);
    assert.equal(w.pl.stage._pendingSyncRequestId,null);assert.equal(w.pl.timers.size,0);
});

test('race: first staged chat arriving before its placement is replayed once',()=>{
    const w=world(),s=w.gm1.stage; s._activeActors.delete('c');s.isStandingEnabled=()=>true;
    const displayed=[];s._updateDialogueBox=(id,text)=>displayed.push([id,text]);
    const message={id:'m1',speaker:{actor:'c'},user:'pl',style:2,content:'First line',
        flags:{[s.MODULE_ID]:{directChatInput:true,stagedPlacementId:'c-1',syncStamp:w.pl.stage._nextSyncStamp()}}};
    s._onChatMessage(message);assert.equal(displayed.length,0);
    w.pl.stage._broadcastStageState();w.gm1.game.handler(w.queue.shift().data);
    assert.deepEqual(displayed,[['c','First line']]);assert.equal(s._pendingStageChat.size,0);
    s._onChatMessage(message);assert.equal(displayed.length,1,'duplicate chat is ignored');
});

test('race: a live chat focus and front side survive an older initial snapshot',()=>{
    const w=world(),s=w.pl.stage;s.isStandingEnabled=()=>true;
    s._updateDialogueBox=(id,text,{updateFocus,updateFront})=>{if(updateFocus)s._activePlayerStandingActorId=id;if(updateFront)s._lastStandingSpeakerSide='player'};
    w.gm1.stage._activePlayerStandingActorId=null;w.gm1.stage._lastStandingSpeakerSide='gm';
    s._requestStageSync();w.gm1.game.handler(w.queue.shift().data);const snapshot=w.queue.shift().data;
    s._onChatMessage({id:'m2',speaker:{actor:'c'},user:'pl',style:2,content:'New line',
        flags:{[s.MODULE_ID]:{directChatInput:true,stagedPlacementId:'c-1',syncStamp:s._nextSyncStamp()}}});
    s._receiveSyncState(snapshot);
    assert.equal(s._activePlayerStandingActorId,'c');assert.equal(s._lastStandingSpeakerSide,'player');
});

test('race: snapshot recovery republishes an owner update the authority never received',()=>{
    const w=world();w.gm1.stage._activeActors.delete('c');
    w.pl.stage._activeActors.get('c').img='offline-edit.png';w.pl.stage._broadcastStageState();w.queue.length=0;
    w.pl.stage._requestStageSync();w.drain();
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('c')?.img,'offline-edit.png');
});

test('race: an unrelated owner snapshot cannot overwrite a newer GM emotion',()=>{
    const w=world();w.pl.stage._activeActors.get('c').img='old.png';
    w.gm1.stage._activeActors.get('c').img='gm-emotion.png';w.gm1.stage._broadcastActorEmotion('c');
    const emotion=w.queue.shift().data;
    w.pl.stage._broadcastStageState();const unrelated=w.queue.shift().data;
    [w.gm2,w.other].forEach(c=>{c.game.handler(emotion);c.game.handler(unrelated)});
    [w.gm2,w.other].forEach(c=>assert.equal(c.stage._activeActors.get('c').img,'gm-emotion.png'));
});

test('race: owner updates delivered out of order retain the latest image',()=>{
    const w=world();w.pl.stage._activeActors.get('c').img='first.png';w.pl.stage._broadcastStageState();
    const first=w.queue.shift().data;w.pl.stage._activeActors.get('c').img='second.png';w.pl.stage._broadcastStageState();
    const second=w.queue.shift().data;
    for(const c of [w.gm1,w.gm2,w.other]){c.game.handler(second);c.game.handler(first);assert.equal(c.stage._activeActors.get('c').img,'second.png')}
});

test('race: concurrent different actor placements converge on the same ordering',()=>{
    const w=world();w.clients.forEach(c=>c.stage._activeActors.delete('c'));
    w.pl.stage._activeActors.set('c',{userId:'pl',name:'C',img:'c.png',placementId:'c-2',position:2});
    w.other.stage._activeActors.set('d',{userId:'other',name:'D',img:'d.png',placementId:'d-1',position:2});
    w.pl.stage._broadcastStageState();w.other.stage._broadcastStageState();w.drain();
    const expected=[...w.gm1.stage._activeActors.keys()];
    for(const c of w.clients)assert.deepEqual([...c.stage._activeActors.keys()],expected);
});

test('race: two GMs concurrently placing the same actor converge on one placement',()=>{
    const w=world();w.clients.forEach(c=>c.stage._activeActors.delete('a'));
    w.gm1.stage._activeActors.set('a',{userId:'gm1',placementId:'a-gm1',img:'one.png',position:3});
    w.gm2.stage._activeActors.set('a',{userId:'gm2',placementId:'a-gm2',img:'two.png',position:3});
    w.gm1.stage._broadcastStageState();w.gm2.stage._broadcastStageState();w.drain();
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('a').placementId,'a-gm1');
});

test('race: concurrent GM/PL placement of the same character converges and retired loser cannot reappear',()=>{
    const w=world();w.clients.forEach(c=>c.stage._activeActors.delete('c'));
    w.gm1.stage._activeActors.set('c',{userId:'gm1',placementId:'c-gm',img:'gm.png',position:3});
    w.pl.stage._activeActors.set('c',{userId:'pl',placementId:'c-pl',img:'pl.png',position:3});
    w.gm1.stage._broadcastStageState();w.pl.stage._broadcastStageState();const old=w.queue[1].data;w.drain();
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('c').placementId,'c-gm');
    w.gm1.stage._requestActorRemoval('c');w.drain();w.clients.forEach(c=>c.game.handler(old));
    for(const c of w.clients)assert.equal(c.stage._activeActors.has('c'),false);
});

test('race: the primary queues requests until its ready phase instead of sending an empty stage',()=>{
    const w=world();w.gm1.stage._syncReady=false;
    w.pl.stage._requestStageSync();w.gm1.game.handler(w.queue.shift().data);
    assert.equal(w.queue.length,0);assert.equal(w.gm1.stage._waitingSyncRequests.size,1);
    w.gm1.stage._requestStageSync({initial:true});w.drain();
    assert.equal(w.pl.stage._pendingSyncRequestId,null);assert.deepEqual(w.ids(w.pl),['a','b','c']);
});

test('race: an unsynchronized backup is not used as an empty authoritative snapshot',()=>{
    const w=world();w.gm2.stage._hasSynchronizedStage=false;w.gm2.stage._activeActors.clear();
    w.gm1.stage._stageActive=true;w.gm1.stage._requestStageSync();w.drain();
    assert.deepEqual(w.ids(w.gm1),['a','b','c']);assert.equal(w.gm1.stage._stageActive,true);
    assert.equal(w.gm1.stage._pendingSyncRequestId,null);assert.equal(w.gm1.timers.size,0);
});

test('recovery: an unavailable first backup falls back to another synchronized GM',()=>{
    const w=world();w.gm2.stage._hasSynchronizedStage=false;w.gm2.stage._activeActors.clear();
    w.collection.contents.push({id:'gm3',isGM:true,active:true});const third=w.createClient('gm3');
    third.stage._activeActors=new Map([...w.gm1.stage._activeActors].map(([id,data])=>[id,{...data}]));
    third.stage._gmStageActive=true;
    w.gm1.stage._requestStageSync();w.drain();
    assert.equal(w.gm1.stage._stageActive,true);assert.deepEqual(w.ids(w.gm1),['a','b','c']);
    assert.equal(w.gm1.stage._pendingSyncRequestId,null);
});

test('recovery: with central control disabled, GM bootstrap preserves personal visibility',()=>{
    const w=world();w.clients.forEach(c=>c.stage.isStageCentralControlEnabled=()=>false);
    w.gm1.stage._stageActive=true;w.gm2.stage._gmStageActive=false;w.pl.stage._stageActive=false;
    w.gm1.stage._requestStageSync();w.drain();
    assert.equal(w.gm1.stage._stageActive,true);assert.equal(w.pl.stage._stageActive,false);
    assert.equal(w.pl.stage._gmStageActive,true,'the primary indicator still updates independently');
});

test('race: a silent backup times out without keeping queued clients waiting forever',()=>{
    const w=world();w.gm1.stage._requestStageSync();w.queue.length=0;
    w.pl.stage._requestStageSync();w.gm1.game.handler(w.queue.pop().data);
    w.gm1.advance(7000);w.drain();
    assert.equal(w.gm1.stage._pendingSyncRequestId,null);assert.equal(w.pl.stage._pendingSyncRequestId,null);
    assert.deepEqual(w.ids(w.pl),['a','b','c']);
});

test('race: a primary GM toggle during bootstrap survives the recovered old control value',()=>{
    const w=world();w.clients.forEach(c=>{c.stage._stageActive=true;c.stage._gmStageActive=true});
    w.gm1.stage._requestStageSync();w.gm1.stage._stageActive=false;w.gm1.stage._broadcastGMStageState({request:true});
    w.drain();for(const c of w.clients)assert.equal(c.stage._stageActive,false);
});

test('race: focus arriving before placement is applied once the actor exists',()=>{
    const w=world();w.clients.forEach(c=>c.stage.isStandingEnabled=()=>true);
    w.gm2.stage._activeActors.delete('a');w.gm1.stage._broadcastStageFocus('gm','a');
    const focus=w.queue.shift().data;w.gm2.game.handler(focus);assert.equal(w.gm2.stage._pendingStageFocus.size,1);
    w.gm1.stage._broadcastStageState();w.gm2.game.handler(w.queue.shift().data);
    assert.equal(w.gm2.stage._activeStandingActorId,'a');assert.equal(w.gm2.stage._pendingStageFocus.size,0);
});

test('recovery: socket reconnection repairs missed changes without a userConnected event',()=>{
    const w=world();w.pl.game.socket.connected=false;
    w.gm1.stage._requestActorRemoval('a');w.drain();assert.equal(w.pl.stage._activeActors.has('a'),true);
    w.pl.game.socket.connected=true;w.pl.network.get('connect')();w.drain();
    assert.equal(w.pl.stage._activeActors.has('a'),false);assert.equal(w.pl.stage._pendingSyncRequestId,null);
});

test('recovery: an older secondary control intent does not undo a newer primary intent',()=>{
    const w=world();w.gm2.stage._stageActive=false;w.gm2.stage._broadcastGMStageState({request:true});
    const older=w.queue.shift().data;
    w.gm1.stage._syncClock=older.stamp.clock;w.gm1.stage._stageActive=true;w.gm1.stage._broadcastGMStageState({request:true});
    w.gm1.game.handler(older);w.drain();
    for(const c of w.clients)assert.equal(c.stage._stageActive,true);
    w.gm1.game.handler(older);assert.equal(w.queue.length,0,'duplicate control request does not emit another change');
});

test('recovery: a secondary becoming primary retains its unacknowledged central-control intent',()=>{
    const w=world();w.gm2.stage._stageActive=true;w.gm2.stage._broadcastGMStageState({request:true});w.queue.length=0;
    w.collection.get('gm1').active=false;
    [w.gm2,w.pl,w.other].forEach(c=>c.hooks.get('userConnected')(w.collection.get('gm1'),false));w.drain();
    for(const c of [w.gm2,w.pl,w.other])assert.equal(c.stage._stageActive,true);
});

test('ordering: an acknowledged snapshot does not replay an older buffered image',()=>{
    const w=world();w.gm1.stage._activeActors.get('a').img='first.png';w.gm1.stage._broadcastStageState();w.drain();
    w.pl.stage._requestStageSync();const request=w.queue.shift().data;
    w.gm1.stage._activeActors.get('a').img='newest.png';w.gm1.stage._broadcastStageState();w.drain();
    w.gm1.game.handler(request);w.pl.game.handler(w.queue.shift().data);
    assert.equal(w.pl.stage._activeActors.get('a').img,'newest.png');
});

test('ordering: late emotion packets target only their original placement',()=>{
    const w=world();w.gm1.stage._activeActors.get('c').img='old-emotion.png';w.gm1.stage._broadcastActorEmotion('c');
    const old=w.queue.shift().data;
    w.clients.forEach(c=>c.stage._activeActors.set('c',{userId:'pl',placementId:'c-2',img:'new-placement.png'}));
    w.clients.forEach(c=>c.game.handler(old));
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('c').img,'new-placement.png');
});

test('permissions: a PL cannot focus, recolor or retire a GM placement by claiming its ownership',()=>{
    const w=world(),s=w.gm1.stage;const stamp=w.other.stage._nextSyncStamp();
    s._activeStandingActorId='a';
    w.gm1.game.handler({action:'updateStageFocus',side:'gm',actorId:'b',placementId:'b-1',userId:'other',stamp});
    w.gm1.game.handler({action:'updateActorEmotion',actorId:'a',placementId:'a-1',img:'bad.png',isStandingImage:false,userId:'other',stamp});
    w.gm1.game.handler({action:'removeStageActor',actorId:'a',placementId:'a-1',ownerUserId:'other',userId:'other',stamp});
    assert.equal(s._activeStandingActorId,'a');assert.equal(s._activeActors.get('a').img,'a.png');
    assert.equal(s._isStagePlacementRetired('a',s._activeActors.get('a')),false);
});

test('privacy: whispers and socket-forged chat do not enter the live replay journal',()=>{
    const w=world(),s=w.gm1.stage;s._activeActors.delete('c');
    const message={speaker:{actor:'c'},user:'pl',style:2,content:'Private',whisper:['gm1'],
        flags:{[s.MODULE_ID]:{directChatInput:true,stagedPlacementId:'c-1',syncStamp:w.pl.stage._nextSyncStamp()}}};
    let displayed=0;s._updateDialogueBox=()=>displayed++;
    s._onChatMessage(message);w.gm1.game.handler({action:'stageChat',message,userId:'pl'});
    assert.equal(s._pendingStageChat.size,0);assert.equal(s._syncRecentPackets.size,0);assert.equal(displayed,0);
});

test('ordering: a message from a retired appearance cannot speak for its new appearance',()=>{
    const w=world(),s=w.gm1.stage;s._activeActors.get('c').placementId='c-2';
    let displayed=0;s._updateDialogueBox=()=>displayed++;
    s._onChatMessage({speaker:{actor:'c'},user:'pl',style:2,content:'Old line',
        flags:{[s.MODULE_ID]:{directChatInput:true,stagedPlacementId:'c-1',syncStamp:w.pl.stage._nextSyncStamp()}}});
    assert.equal(displayed,0);
});

test('ordering: a new appearance clears old dialogue timers while retaining snapshot focus',()=>{
    const w=world(),s=w.pl.stage;s._clearStandingDialogueSide=vm.runInContext('stageStandingMethods._clearStandingDialogueSide',w.pl.context);
    s._standingDialogueActorIds.gm='b';s._currentTypingAnimations.set('standing:gm',[1]);
    const actors=w.gm1.stage._serializeActiveActors();actors.find(actor=>actor.id==='b').placementId='b-2';
    s._receiveStageState({action:'syncState',userId:'gm1',actors,activeStandingActorId:'b'}, {fullSnapshot:true,skipSenderCheck:true});
    assert.equal(s._currentTypingAnimations.has('standing:gm'),false);assert.equal(s._standingDialogueActorIds.gm,null);
    assert.equal(s._activeStandingActorId,'b');assert.equal(s._activeActors.get('b').placementId,'b-2');
});

test('ordering: an older snapshot cannot retire a newly re-entered local appearance',()=>{
    const w=world(),s=w.pl.stage;s._requestStageSync();w.gm1.game.handler(w.queue.shift().data);const snapshot=w.queue.shift().data;
    s._requestActorRemoval('c');s._activeActors.set('c',{userId:'pl',placementId:'c-2',img:'new.png',position:3});s._broadcastStageState();
    s._receiveSyncState(snapshot);assert.equal(s._activeActors.get('c')?.placementId,'c-2');
    assert.equal(s._isStagePlacementRetired('c',s._activeActors.get('c')),false);
});

test('malformed packets and unauthorized GM control cannot change stage state',()=>{
    const w=world(),c=w.pl;
    for(const packet of [null,[],{}, {action:'updateStage',userId:'missing',actors:[]},
        {action:'updateStage',userId:'gm1',actors:null},
        {action:'updateStage',userId:'gm1',actors:[{id:'missing',userId:'gm1'}]},
        {action:'updateStage',userId:'gm1',actors:[{id:'a',userId:'gm1'},{id:'a',userId:'gm1'}]},
        {action:'updateStage',userId:'gm1',actors:[{id:'a',userId:'gm1',img:3}]},
        {action:'updateStage',userId:'gm1',actors:[{id:'a',userId:'gm1',position:NaN}]},
        {action:'updateGMStage',userId:'pl',stageActive:true},
        {action:'updateGMStage',userId:'gm2',stageActive:true},
        {action:'updateGMStage',userId:'gm1',stageActive:'yes'},
        {action:'requestGMStage',userId:'pl',stageActive:true}])c.game.handler(packet);
    assert.deepEqual(w.ids(c),['a','b','c']);assert.equal(c.stage._gmStageActive,false);
    c.game.handler({action:'updateGMStage',userId:'gm1',stageActive:true});assert.equal(c.stage._stageActive,true);
});

test('PL placement requires assigned/owned actor and cannot claim a GM actor',()=>{
    const w=world();
    for(const actorId of ['a','d'])w.gm1.game.handler({action:'updateStage',userId:'pl',actors:[{id:actorId,userId:'pl'}]});
    assert.deepEqual(w.ids(w.gm1),['a','b','c']);
    w.gm1.game.handler({action:'updateStage',userId:'pl',actors:[{id:'c',userId:'pl',name:'untrusted',img:'new.png'}]});
    assert.equal(w.gm1.stage._activeActors.get('c').name,'Actor c');
    assert.equal(w.gm1.stage._activeActors.get('c').img,'new.png');
    w.gm1.game.handler({action:'updateStage',userId:'pl',actors:[]});assert.deepEqual(w.ids(w.gm1),['a','b']);
});

test('GM updates preserve another GM and PL actors; explicit GM removal still removes either',()=>{
    const w=world();
    w.gm1.game.handler({action:'updateStage',userId:'gm2',actors:[{id:'b',userId:'gm2',img:'changed.png'}]});
    assert.deepEqual(w.ids(w.gm1),['a','b','c']);
    w.gm1.game.handler({action:'updateStage',userId:'gm2',actors:[]});assert.deepEqual(w.ids(w.gm1),['a','c']);
    w.gm2.stage._requestActorRemoval('a');w.drain();
    assert.equal(w.gm1.stage._activeActors.has('a'),false);
    w.gm1.stage._requestActorRemoval('c');w.drain();
    assert.equal(w.pl.stage._activeActors.has('c'),false);
});

test('secondary GM central-control requests are processed once by primary GM',()=>{
    const w=world();w.gm2.stage._stageActive=true;
    w.gm2.stage._broadcastGMStageState();assert.equal(w.queue.length,0,'ready broadcast cannot reset primary state');
    w.gm2.stage._broadcastGMStageState({request:true});assert.equal(w.queue[0].data.action,'requestGMStage');w.drain();
    for(const c of w.clients)assert.equal(c.stage._stageActive,true);
});

test('primary GM departure elects next GM and returning primary recovers state before replying',()=>{
    const w=world();w.clients.forEach(c=>{c.stage._stageActive=true;c.stage._gmStageActive=true});
    w.collection.get('gm1').active=false;
    w.clients.filter(c=>c.game.user.active).forEach(c=>c.hooks.get('userConnected')());w.drain();
    assert.equal(w.gm2.stage._getPrimaryGM().id,'gm2');assert.deepEqual(w.ids(w.pl),['a','b','c']);
    w.collection.get('gm1').active=true;w.gm1.stage._activeActors.clear();w.gm1.stage._stageActive=false;w.gm1.stage._gmStageActive=false;
    // Existing clients notice the election before the returning GM finishes bootstrap.
    [w.gm2,w.pl,w.other,w.gm1].forEach(c=>c.hooks.get('userConnected')(w.collection.get('gm1'),true));w.drain();
    for(const c of w.clients){assert.deepEqual(w.ids(c),['a','b','c']);assert.equal(c.stage._stageActive,true)}
    assert.equal(w.gm1.stage._waitingSyncRequests.size,0);
    assert.equal(w.gm1.stage._pendingSyncRequestId,null);
});

test('central control during primary recovery applies after recovery instead of being overwritten',()=>{
    const w=world();w.clients.forEach(c=>{c.stage._stageActive=true;c.stage._gmStageActive=true});
    w.gm1.stage._requestStageSync();
    w.gm1.stage._receiveGMStageRequest({userId:'gm2',stageActive:false});
    assert.equal(w.gm1.stage._stageActive,true,'control waits while the primary recovers');
    w.drain();for(const c of w.clients)assert.equal(c.stage._stageActive,false);
});

test('backup departure during recovery releases pending sync requests',()=>{
    const w=world();w.gm1.stage._requestStageSync();
    w.pl.stage._requestStageSync();const request=w.queue.pop().data;
    w.gm1.game.handler(request);assert.equal(w.gm1.stage._waitingSyncRequests.size,1);
    w.collection.get('gm2').active=false;
    w.gm1.hooks.get('userConnected')(w.collection.get('gm2'),false);w.drain();
    assert.equal(w.gm1.stage._pendingSyncRequestId,null);
    assert.equal(w.pl.stage._pendingSyncRequestId,null);
    assert.deepEqual(w.ids(w.pl),['a','b','c']);
});

for (const useStanding of [false,true]) {
    const label=useStanding?'standing images':'portraits';
    function sharedWorld() {
        const w=world();
        for(const c of w.clients) {
            const s=c.stage;s.isStandingEnabled=()=>useStanding;
            s._activeActors.set('d',{userId:'other',img:'d.png',name:'D',placementId:'d-1',position:3});
            c.dialogue={};
            s._updateDialogueBox=(id,content,{updateFocus,updateFront})=>{
                const side=s._getStandingSideForActor(id);c.dialogue[side]={id,content};
                s._standingDialogueActorIds[side]=id;
                if(updateFront)s._lastStandingSpeakerSide=side;
                if(updateFocus)side==='player'?s._setActivePlayerStandingActor(id):s._setActiveStandingActor(id);
            };
        }
        return w;
    }
    const message=(actor,user,clock,content,placement=actor+'-1')=>({speaker:{actor},user,style:2,content,
        flags:{'lichsoma-speaker-stage':{directChatInput:true,stagedPlacementId:placement,syncStamp:{clock,userId:user}}}});
    test(label+': two PL speakers converge on the same shared latest line despite reverse/duplicate delivery',()=>{
        const w=sharedWorld();const a=message('c','pl',1001,'A'),b=message('d','other',1002,'B'),gm=message('a','gm1',1003,'GM');
        w.clients.forEach((c,i)=>{
            (i%2?[a,b,gm,a,b]:[b,a,b,gm]).forEach(m=>c.stage._onChatMessage(m));
            assert.deepEqual(c.dialogue.player,{id:'d',content:'B'});
            assert.deepEqual(c.dialogue.gm,{id:'a',content:'GM'});
            assert.equal(c.stage._activePlayerStandingActorId,'d');
            assert.equal(c.stage._activeStandingActorId,'a');
            assert.equal(c.stage._lastStandingSpeakerSide,'gm');
            assert.equal(c.stage._syncVersions.has('dialogue:actor:c'),false);
        });
    });
    test(label+': remote GM selection works independently of the image setting and ignores old focus',()=>{
        const w=sharedWorld();w.gm2.stage._setActiveStandingActor('b',{broadcast:true});const focus=w.queue.shift().data;
        w.clients.forEach(c=>c.game.handler(focus));
        for(const c of w.clients)assert.equal(c.stage._activeStandingActorId,'b');
        const line=message('a','gm1',focus.stamp.clock+1,'New GM line');
        w.clients.forEach(c=>{c.stage._onChatMessage(line);c.game.handler(focus)});
        for(const c of w.clients)assert.equal(c.stage._activeStandingActorId,'a');
    });
    test(label+': a late initial snapshot preserves the newer shared PL line and focus',()=>{
        const w=sharedWorld();w.clients.forEach(c=>c.stage._onChatMessage(message('c','pl',4001,'First')));
        w.pl.stage._requestStageSync();w.gm1.game.handler(w.queue.shift().data);const snapshot=w.queue.shift().data;
        const line=message('d','other',w.pl.stage._syncClock+10,'Second');
        w.clients.forEach(c=>c.stage._onChatMessage(line));w.pl.game.handler(snapshot);
        assert.deepEqual(w.pl.dialogue.player,{id:'d',content:'Second'});
        assert.equal(w.pl.stage._activePlayerStandingActorId,'d');
        assert.equal(w.pl.stage._lastStandingSpeakerSide,'player');
    });
    test(label+': first PL line waits for its placement and replaces the previous shared speaker once',()=>{
        const w=sharedWorld(),s=w.gm2.stage;
        s._onChatMessage(message('c','pl',5001,'First'));s._activeActors.delete('d');
        s._onChatMessage(message('d','other',5002,'Second'));
        assert.deepEqual(w.gm2.dialogue.player,{id:'c',content:'First'});
        w.other.stage._broadcastStageState();w.gm2.game.handler(w.queue.shift().data);
        assert.deepEqual(w.gm2.dialogue.player,{id:'d',content:'Second'});
        assert.equal(s._activePlayerStandingActorId,'d');assert.equal(s._pendingStageChat.size,0);
    });
    test(label+': removing a previous PL speaker preserves the current speaker and stale re-entry chat is rejected',()=>{
        const w=sharedWorld();w.clients.forEach(c=>{c.stage._onChatMessage(message('c','pl',2001,'A'));c.stage._onChatMessage(message('d','other',2002,'B'))});
        w.gm1.stage._requestActorRemoval('c');w.drain();
        for(const c of w.clients){assert.equal(c.stage._standingDialogueActorIds.player,'d');assert.equal(c.stage._activePlayerStandingActorId,'d')}
        w.pl.stage._activeActors.set('c',{userId:'pl',img:'c.png',name:'C',placementId:'c-2',position:4});w.pl.stage._broadcastStageState();w.drain();
        w.clients.forEach(c=>{
            c.stage._onChatMessage(message('c','pl',3000,'OLD','c-1'));
            assert.deepEqual(c.dialogue.player,{id:'d',content:'B'});
            c.stage._onChatMessage(message('c','pl',c.stage._syncClock+1,'NEW','c-2'));
            assert.deepEqual(c.dialogue.player,{id:'c',content:'NEW'});
        });
    });
}

function policyWorld() {
    const w=world();let disabled=false;
    for(const c of w.clients){
        c.game.settings={get:(namespace,key)=>key==='disablePlayerStage'?disabled:false};
        c.stage._renderPlayerStageToggle=()=>{};
    }
    w.setPolicy=(value,refresh=true)=>{disabled=value;if(refresh)w.clients.forEach(c=>c.stage._refreshPlayerStagePolicy())};
    return w;
}
test('player-stage policy: enabling retires PL placements on every client while preserving all GM placements',()=>{
    const w=policyWorld();w.pl.stage._broadcastStageState();const old=w.queue.shift().data;
    w.setPolicy(true);w.drain();
    for(const c of w.clients){assert.deepEqual(w.ids(c),['a','b']);assert.equal(c.stage._canRemoveStageActor('a'),c.game.user.isGM)}
    w.setPolicy(false);w.clients.forEach(c=>c.game.handler(old));
    for(const c of w.clients)assert.equal(c.stage._activeActors.has('c'),false,'old placement cannot reappear after policy is lifted');
    w.pl.stage._activeActors.set('c',{userId:'pl',img:'c.png',name:'C',placementId:'c-policy-new',position:3});
    w.pl.stage._broadcastStageState();w.drain();
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('c')?.placementId,'c-policy-new');
});
test('player-stage policy: direct player placement, removal, focus, emotion and dialogue are blocked',()=>{
    const w=policyWorld();w.setPolicy(true,false);
    const s=w.pl.stage,original=s._activeActors.get('c').img;
    assert.equal(s._requestActorRemoval('c'),false);
    s._activeActors.delete('c');s._onPlayerActorToggle('c');assert.equal(s._activeActors.has('c'),false);
    s._activeActors.set('c',{userId:'pl',img:original,name:'C',placementId:'c-1',position:2});
    s._broadcastStageState();const state=w.queue.shift().data;
    w.gm1.stage._activeActors.delete('c');w.gm1.game.handler(state);assert.equal(w.gm1.stage._activeActors.has('c'),false);
    const stamp={clock:Date.now()+1000,userId:'pl'};
    w.gm2.game.handler({action:'removeStageActor',userId:'pl',actorId:'c',placementId:'c-1',ownerUserId:'pl',stamp});
    assert.equal(w.gm2.stage._activeActors.has('c'),true);
    w.gm2.game.handler({action:'updateStageFocus',userId:'pl',side:'player',actorId:'c',placementId:'c-1',stamp});
    assert.equal(w.gm2.stage._activePlayerStandingActorId,null);
    w.gm2.game.handler({action:'updateActorEmotion',userId:'pl',actorId:'c',placementId:'c-1',img:'blocked.png',isStandingImage:false,stamp});
    assert.equal(w.gm2.stage._activeActors.get('c').img,original);
    let calls=0;w.gm2.stage._updateDialogueBox=()=>calls++;
    w.gm2.stage._onChatMessage({speaker:{actor:'c'},user:'pl',style:2,content:'Blocked',flags:{[s.MODULE_ID]:{directChatInput:true,stagedPlacementId:'c-1',syncStamp:stamp}}});
    assert.equal(calls,0);
});
test('player-stage policy: a full recovery snapshot filters PL placements even before onChange runs',()=>{
    const w=policyWorld();w.gm1.stage._handleSyncRequest({action:'requestSync',requestUserId:'pl',requestId:'policy-snapshot',userId:'pl'});
    const snapshot=w.queue.shift().data;w.setPolicy(true,false);
    w.pl.stage._receiveStageState(snapshot,{fullSnapshot:true,skipSenderCheck:true});
    assert.deepEqual(w.ids(w.pl),['a','b']);
});
test('player-stage policy: GM placement and shared NPC dialogue remain available',()=>{
    const w=policyWorld();w.setPolicy(true);w.drain();
    w.gm1.stage._activeActors.set('d',{userId:'gm1',name:'NPC',img:'d.png',placementId:'gm-npc',position:3});
    w.gm1.stage._broadcastStageState();w.drain();
    for(const c of w.clients)assert.equal(c.stage._activeActors.get('d')?.userId,'gm1');
    const s=w.pl.stage;let line=null;s._updateDialogueBox=(id,content)=>line=[id,content];
    s._onChatMessage({speaker:{actor:'d'},user:'gm1',style:2,content:'NPC line',flags:{[s.MODULE_ID]:{directChatInput:true,stagedPlacementId:'gm-npc',syncStamp:{clock:s._syncClock+1,userId:'gm1'}}}});
    assert.deepEqual(line,['d','NPC line']);
    assert.equal(s._canChangeStageEmotion('d',w.collection.get('gm1')),true);
    assert.equal(w.gm1.stage._requestActorRemoval('d'),true);w.drain();
    for(const c of w.clients)assert.equal(c.stage._activeActors.has('d'),false);
});
