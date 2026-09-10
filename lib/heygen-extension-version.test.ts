import assert from 'node:assert/strict';
import { ECONOMY_EXTENSION_VERSION, extensionVersionAtLeast } from './heygen-extension-bridge';

assert.equal(ECONOMY_EXTENSION_VERSION, '4.42.0');
assert(extensionVersionAtLeast('4.42.0'));
assert(!extensionVersionAtLeast('4.40.9'));
assert(!extensionVersionAtLeast('?'));
assert(!extensionVersionAtLeast(undefined));
console.log('PASS: economy dispatch accepts only the current extension protocol or newer.');
