import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
buildSync({
  entryPoints: ['lib/downloader-core.ts'],
  outfile: '.test-tmp/downloader-core-pinterest.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['playwright'],
});
const { pinterestImageCandidates, pinterestPageHasVideo } = require('../.test-tmp/downloader-core-pinterest.cjs');

const candidates = pinterestImageCandidates(`
  <meta property="og:image" content="https://i.pinimg.com/736x/aa/bb/cc/photo.jpg?x=1&amp;y=2">
  <meta content="https:\\/\\/i.pinimg.com\\/564x\\/11\\/22\\/33\\/other.webp" name="twitter:image">
  <meta property="og:image" content="https://evil.example/fake.jpg">
  <script>{"image":"https:\\u002F\\u002Fi.pinimg.com\\u002F236x\\u002F44\\u002F55\\u002F66\\u002Fthird.png"}</script>
`);

assert.deepEqual(candidates, [
  'https://i.pinimg.com/originals/aa/bb/cc/photo.jpg?x=1&y=2',
  'https://i.pinimg.com/736x/aa/bb/cc/photo.jpg?x=1&y=2',
  'https://i.pinimg.com/originals/11/22/33/other.webp',
  'https://i.pinimg.com/564x/11/22/33/other.webp',
  'https://i.pinimg.com/originals/44/55/66/third.png',
  'https://i.pinimg.com/236x/44/55/66/third.png',
]);
assert.deepEqual(pinterestImageCandidates('<meta property="og:image" content="javascript:alert(1)">'), []);
assert.deepEqual(pinterestImageCandidates('<meta property="og:image" content="https://i.pinimg.com/x/error.svg">'), []);
assert.equal(pinterestPageHasVideo('<meta property="og:video" content="https://v.pinimg.com/video.mp4">'), true);
assert.equal(pinterestPageHasVideo('<script>{"story_pin_data":{"pages":[]}}</script>'), true);
assert.equal(pinterestPageHasVideo('<meta property="og:image" content="https://i.pinimg.com/a.jpg">'), false);

console.log('PASS Pinterest metadata distinguishes video from image and prefers official original raster candidates');
