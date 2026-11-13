const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');

function setup() {
    let now=0, nextId=0, clearDelay=1;
    const pending=new Map();
    const context=vm.createContext({
        game:{settings:{get:()=>clearDelay}},
        buildStageTypingPlan(html){
            const fragment={element:null};
            const text=html.replace(/<[^>]*>/g,'');
            return {fragment,steps:Array.from(text,grapheme=>({grapheme,reveal(){fragment.element.innerHTML+=grapheme}})),
                finish(){fragment.element.innerHTML=html}};
        },
        setTimeout(callback,delay){const id=++nextId;pending.set(id,{callback,time:now+Math.max(0,Number(delay)||0)});return id},
        clearTimeout(id){pending.delete(id)}
    });
    const source=require('./stage-test-loader.cjs').stageTestSource();
    vm.runInContext(source,context);
    const stage=context.Stage;
    stage._playTypingSound=()=>{};
    function advance(ms) {
        const end=now+ms;
        while(true) {
            const entry=[...pending.entries()].filter(([,v])=>v.time<=end).sort((a,b)=>a[1].time-b[1].time||a[0]-b[0])[0];
            if(!entry)break;
            now=entry[1].time;pending.delete(entry[0]);entry[1].callback();
        }
        now=end;
    }
    return {stage,advance,pending,setDelay:value=>clearDelay=value};
}
const element=()=>({innerHTML:'',replaceChildren(fragment){this.innerHTML='';if(fragment)fragment.element=this},style:{opacity:'1',transition:'color 0.2s'}});
function assertClean(stage,pending) {
    assert.equal(stage._currentTypingAnimations.size,0);
    assert.equal(stage._textClearTimeouts.size,0);
    assert.equal(stage._textFadeTimeouts.size,0);
    assert.equal(pending.size,0);
}

test('new dialogue during the previous fade is not cleared or dimmed by its timer',()=>{
    const {stage,advance,pending,setDelay}=setup(),el=element();
    stage._typeText('a',el,'<p>A</p>',10);
    advance(1010);assert.equal(el.style.opacity,'0');
    advance(200);setDelay(0);
    stage._typeText('a',el,'<p>NEW</p>',10);
    advance(1000);
    assert.equal(el.innerHTML,'<p>NEW</p>');
    assert.equal(el.style.opacity,'1');
    assert.equal(el.style.transition,'color 0.2s');
    assertClean(stage,pending);
});
test('replacement during typing or before auto-clear cancels old work',()=>{
    for(const elapsed of [10,100]) {
        const {stage,advance,pending,setDelay}=setup(),el=element();
        stage._typeText('a',el,'OLD',20);advance(elapsed);setDelay(0);
        stage._typeText('a',el,'NEW',20);advance(2000);
        assert.equal(el.innerHTML,'NEW');assertClean(stage,pending);
    }
});
test('actor removal or side cleanup cancels every phase without touching another side',()=>{
    for(const elapsed of [5,100,1100]) {
        const {stage,advance,pending,setDelay}=setup(),el=element(),other=element();
        stage._typeText('standing:gm',el,'OLD',20);advance(elapsed);
        stage._clearTypingEffectsForActor('standing:gm');el.innerHTML='';
        setDelay(0);stage._typeText('standing:player',other,'PL',10);advance(2000);
        assert.equal(el.innerHTML,'');assert.equal(other.innerHTML,'PL');
        assert.equal(el.style.opacity,'1');assert.equal(el.style.transition,'color 0.2s');
        assertClean(stage,pending);
    }
});
test('normal auto-clear still fades and cleans up, including an empty message',()=>{
    for(const text of ['A','']) {
        const {stage,advance,pending}=setup(),el=element();
        stage._typeText('a',el,text,10);advance(1010);
        assert.equal(el.style.opacity,'0');advance(500);
        assert.equal(el.innerHTML,'');assert.equal(el.style.opacity,'1');
        assert.equal(el.style.transition,'color 0.2s');assertClean(stage,pending);
    }
});
