const fs = require('node:fs');
const path = require('node:path');
const scripts = path.resolve(__dirname, '../scripts');
const imports = /^import\s+(?:[^'"\n]*?\s+from\s+)?(['"])([^'"\n]+)\1;?\s*$/gm;
const read = file => fs.readFileSync(file, 'utf8');
const dataURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');

// Unit-test VMs supply the formatter/timers as globals. Read all internal
// dependencies rather than cutting a class out of a particular source layout.
function stageTestSource() {
    const seen = new Set(), parts = [];
    function visit(file) {
        if (seen.has(file)) return;
        seen.add(file);
        if (file.endsWith('lichsoma-actor-emotions.js')) {
            parts.push('const ActorEmotions = {};');
            return;
        }
        if (file.endsWith('lichsoma-stage-dialogue.js')) return;
        const source = read(file);
        for (const match of source.matchAll(imports)) visit(path.resolve(path.dirname(file), match[2]));
        parts.push(source.replace(imports, '').replace(/^export (?=(?:class|const|function)\b)/gm, ''));
    }
    visit(path.join(scripts, 'lichsoma-speaker-stage.js'));
    return 'globalThis.window ??= globalThis; globalThis.foundry ??= {}; globalThis.Hooks ??= {on(){},once(){}};\n'
        + parts.join('\n\n') + '\nglobalThis.Stage = SpeakerStage;';
}

// Browser checks use real ES modules and their real imports. Only the external
// emotion service/render-hook registration are stubbed; formatter code is real.
function stageModuleURL(entry = 'lichsoma-speaker-stage.js') {
    const cache = new Map();
    function visit(file) {
        if (cache.has(file)) return cache.get(file);
        let source = read(file);
        if (file.endsWith('lichsoma-actor-emotions.js')) source = 'export class ActorEmotions {}';
        if (file.endsWith('lichsoma-chat-render-pipeline.js')) source = 'export function registerChatRenderProcessor() {}';
        source = source.replace(imports, (statement, quote, specifier) => {
            if (!specifier.startsWith('.')) throw new Error('Unexpected test import: ' + specifier);
            return statement.replace(quote + specifier + quote, JSON.stringify(visit(path.resolve(path.dirname(file), specifier))));
        });
        const url = dataURL(source);
        cache.set(file, url);
        return url;
    }
    return visit(path.join(scripts, entry));
}

module.exports = {stageTestSource, stageModuleURL};
