import { ChatRubyHandler } from '../../lichsoma-speaker-selector/scripts/lichsoma-chat-handler.js';

export function escapeStageHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function safeStageImageSource(value) {
    const source = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const scheme = source.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (!source || (scheme && !['http','https','blob'].includes(scheme)
        && !/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml|bmp|x-icon)[;,]/i.test(source))) {
        return 'icons/svg/mystery-man.svg';
    }
    return source;
}

const TEXT_TAGS = new Set(['p','div','span','b','strong','i','em','u','s','del','br','ruby','rb','rt','rp',
    'a','img','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','hr']);
const DROP_TAGS = new Set(['script','style','iframe','object','embed','svg','math','form','input','button','select','textarea']);
const PRESENTATION = ['color','font-weight','font-style','text-decoration','font-family','font-size'];

/* Parse in an inert template, then rebuild a presentation tree.
 * Never copy event handlers, IDs, arbitrary attributes, or executable elements. */
export function formatStageDialogue(content) {
    const template = document.createElement('template');
    template.innerHTML = String(content ?? '');
    const root = document.createElement('div');
    function copy(node, parent) {
        if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.data)); return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.localName;
        if (DROP_TAGS.has(tag)) return;
        if (!TEXT_TAGS.has(tag)) {
            [...node.childNodes].forEach(child => copy(child, parent)); return;
        }
        const element = document.createElement(tag);
        if (tag === 'ruby') element.className = 'lichsoma-ruby';
        if (tag === 'img') {
            element.setAttribute('src', safeStageImageSource(node.getAttribute('src')));
            element.setAttribute('alt', node.getAttribute('alt') ?? '');
            for (const dimension of ['width','height']) {
                const value = node.getAttribute(dimension);
                if (/^\d{1,4}$/.test(value ?? '') && Number(value) > 0) element.setAttribute(dimension,value);
            }
        }
        if (tag === 'a') {
            const href = (node.getAttribute('href') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
            const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
            if (href && (!scheme || ['http','https','mailto'].includes(scheme))) element.setAttribute('href', href);
            element.setAttribute('rel', 'noopener noreferrer');
        }
        for (const property of PRESENTATION) {
            const value = node.style.getPropertyValue(property);
            if (value) element.style.setProperty(property, value);
        }
        parent.appendChild(element);
        [...node.childNodes].forEach(child => copy(child, element));
    }
    [...template.content.childNodes].forEach(node => copy(node, root));
    // Reuse Speaker Selector's text-node parser, including its code/link exclusions.
    ChatRubyHandler.processFormatting(root);
    const fragment = document.createDocumentFragment();
    fragment.append(...root.childNodes);
    return fragment;
}

function graphemes(value) {
    const text = String(value ?? '');
    if (typeof Intl.Segmenter === 'function') {
        return Array.from(new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(text), item => item.segment);
    }
    return Array.from(text);
}

/* Like the narrator, build once and progressively reveal text nodes. Ruby
 * readings reserve their full width and reveal in proportion to the base. */
export function buildStageTypingPlan(content) {
    const fragment = typeof content === 'string' ? formatStageDialogue(content) : content;
    const steps = [], rubies = [];
    function walk(node, ruby = null) {
        if (node.nodeType === Node.ELEMENT_NODE && node.localName === 'img') {
            node.style.visibility = 'hidden';
            steps.push({grapheme:'',reveal:()=>{node.style.visibility=''}}); return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const characters = graphemes(node.data); node.data = '';
            characters.forEach(grapheme => {
                const step = {grapheme, reveal:() => node.appendData(grapheme)};
                steps.push(step); if (ruby) ruby.steps.push(step);
            }); return;
        }
        if (node.nodeType === Node.ELEMENT_NODE && node.localName === 'ruby') {
            const rt = node.querySelector(':scope > rt');
            if (rt) {
                const reading = graphemes(rt.textContent);
                const shell = document.createElement('span'); shell.className = 'lichsoma-stage-ruby-reading-shell';
                const ghost = document.createElement('span'); ghost.className = 'lichsoma-stage-ruby-reading-ghost'; ghost.textContent = reading.join('');
                const visible = document.createElement('span'); visible.className = 'lichsoma-stage-ruby-reading-visible';
                shell.setAttribute('aria-hidden','true'); shell.append(ghost,visible);
                rt.replaceChildren(shell); rt.setAttribute('aria-label',reading.join(''));
                const context = {rt,reading,visible,steps:[]}; rubies.push(context);
                [...node.childNodes].filter(child => !['rt','rp'].includes(child.localName)).forEach(child => walk(child, context));
                context.steps.forEach((step,index) => {
                    const reveal = step.reveal;
                    step.reveal = () => {
                        reveal();
                        const count = Math.max(1, Math.round((index+1)*reading.length/context.steps.length));
                        visible.textContent = reading.slice(0,count).join('');
                    };
                }); return;
            }
        }
        [...node.childNodes].forEach(child => walk(child,ruby));
    }
    walk(fragment);
    return {fragment,steps,finish(){
        rubies.forEach(({rt,reading}) => {rt.textContent=reading.join('');rt.removeAttribute('aria-label')});
    }};
}
