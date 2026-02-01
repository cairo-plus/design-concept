import * as pdfPkg from 'pdf-parse';

console.log('---------------------------------------------------');
console.log('Type of module:', typeof pdfPkg);
console.log('Keys of module:', Object.keys(pdfPkg));
console.log('Has default export:', 'default' in pdfPkg);
if (pdfPkg.default) {
    console.log('Type of default export:', typeof pdfPkg.default);
}
console.log('---------------------------------------------------');
try {
    const pdf = await import('pdf-parse');
    console.log('Dynamic Import Keys:', Object.keys(pdf));
} catch (e) {
    console.error('Dynamic import failed', e);
}
