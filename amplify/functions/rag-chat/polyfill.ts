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

// Also polyfill other potential missing browser globals
if (typeof global.TextDecoder === 'undefined') {
    const { TextDecoder } = require('util');
    (global as any).TextDecoder = TextDecoder;
}

if (typeof global.ImageData === 'undefined') {
    (global as any).ImageData = class ImageData {
        width: number;
        height: number;
        data: Uint8ClampedArray;
        constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
            this.data = new Uint8ClampedArray(width * height * 4);
        }
    };
}

if (typeof global.Path2D === 'undefined') {
    (global as any).Path2D = class Path2D {
        constructor() { }
        addPath() { }
        closePath() { }
        moveTo() { }
        lineTo() { }
        bezierCurveTo() { }
        quadraticCurveTo() { }
        arc() { }
        arcTo() { }
        ellipse() { }
        rect() { }
    };
}
