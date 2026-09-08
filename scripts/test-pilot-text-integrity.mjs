import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync('lib/pilot-text-integrity.ts', 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = vm.createContext({ exports: {}, String, RegExp });
vm.runInContext(js, ctx);
const { hasScenePlanJsonLeak, findPilotTextIntegrityIssue } = ctx.exports;

const leaked = JSON.stringify({
  AD102VN: [{ cena: 'Body', avatarId: 'avatar-1', voiceId: 'voice-1', motor: 'III' }],
});

assert.equal(hasScenePlanJsonLeak(leaked), true);
assert.equal(hasScenePlanJsonLeak(`fala valida\n${leaked}`), true);
assert.equal(hasScenePlanJsonLeak('{"produto":"exemplo"}'), false);
assert.equal(hasScenePlanJsonLeak('O texto menciona avatarId e voiceId, mas nao e um plano.'), false);

const issue = findPilotTextIntegrityIssue([
  { label: 'HOOK 1', text: 'fala valida' },
  { label: 'BODY 3', text: leaked },
]);
assert.equal(issue?.index, 1);
assert.equal(issue?.label, 'BODY 3');
assert.equal(issue?.reason, 'scene-plan-json');
assert.equal(findPilotTextIntegrityIssue([{ label: 'BODY 1', text: 'fala valida' }]), null);

console.log('pilot text integrity: 6 checks passed');
