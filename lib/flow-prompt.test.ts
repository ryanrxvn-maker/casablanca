import assert from 'node:assert/strict';
import { flowPromptStrategy, localFlowPrompt, parseFlowPrompt, type FlowPromptRequest } from './flow-prompt';

const base: FlowPromptRequest = {
  excerpt: 'Uma mulher fecha a porta do banheiro e finalmente respira aliviada.',
  context: 'Uma história íntima sobre recuperar a rotina.',
  mode: 'image-video',
  aspectRatio: '9:16',
  durationSeconds: 8,
};

assert.equal(flowPromptStrategy('A inflamação pressiona a bexiga e irrita os nervos'), 'medical-3d');
assert.equal(flowPromptStrategy('Misture duas gotas do ingrediente no pote'), 'product-macro');
assert.equal(flowPromptStrategy('Uma mulher volta a caminhar com a família'), 'human-story');
assert.equal(flowPromptStrategy('O tempo escapa sem que ninguém perceba'), 'cinematic-metaphor');

const paired = localFlowPrompt(base);
assert.equal(paired.source, 'local');
assert.equal(paired.strategy, 'human-story');
assert.ok(paired.imagePrompt && paired.imagePrompt.length > 80);
assert.ok(paired.videoPrompt.length > 80);
assert.match(paired.imagePrompt!, /No visible text/i);
assert.match(paired.videoPrompt, /No visible text/i);
assert.match(paired.videoPrompt, /8-second/i);
assert.match(paired.videoPrompt, /vertical 9:16/i);

const videoOnly = localFlowPrompt({ ...base, mode: 'video-only', aspectRatio: '16:9', durationSeconds: 99 });
assert.equal(videoOnly.imagePrompt, undefined);
assert.match(videoOnly.videoPrompt, /10-second/i);
assert.match(videoOnly.videoPrompt, /horizontal 16:9/i);

assert.equal(parseFlowPrompt({ strategy: 'human-story', imagePrompt: 'short', videoPrompt: 'short' }, base), null);
assert.equal(parseFlowPrompt({ strategy: 'invented', imagePrompt: 'x'.repeat(100), videoPrompt: 'y'.repeat(100) }, base), null);
const parsed = parseFlowPrompt({
  strategy: 'human-story',
  imagePrompt: 'An authentic woman in a lived-in Brazilian home, framed on a 35mm lens with natural window light and restrained documentary texture. '.repeat(2),
  videoPrompt: 'The camera slowly moves closer while she opens the door, pauses, and exhales with coherent natural motion and physically accurate light. '.repeat(2),
}, base);
assert.ok(parsed);
assert.equal(parsed?.source, 'claude');
assert.match(parsed?.imagePrompt || '', /No visible text/i);
assert.match(parsed?.videoPrompt || '', /No visible text/i);

console.log('Flow prompt director: strategy, paired prompts, video-only prompts and hard visual guards passed.');
