// Polyfill for DOMMatrix (required by some PDF parsers in non-browser envs like AWS Lambda)
// Found issue where 'DOMMatrix is not defined' causes lambda crash.

if (typeof global.DOMMatrix === 'undefined') {
    // Minimal stub for DOMMatrix
    (global as any).DOMMatrix = class DOMMatrix {
        constructor() { }

        // Some libraries might check for these methods or toString validity
        toString() { return "[]"; }
    };
}

// Also polyfill other potential missing browser globals if needed by canvas/pdf-lib
if (typeof global.TextDecoder === 'undefined') {
    const { TextDecoder } = require('util');
    (global as any).TextDecoder = TextDecoder;
}
