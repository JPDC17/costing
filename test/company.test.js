const test = require('node:test');
const assert = require('node:assert');
const Company = require('../src/company');

// 2x1 PNG and a tiny JPEG, as data URLs
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQYYAwAqZcI+NoFaNYAAAAASUVORK5CYII=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAACAAMBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

test('normalizeCompany keeps known fields, trims, caps length and drops bad logos', () => {
  const c = Company.normalizeCompany({ name: '  Northway Ltd.  ', address: 'Line 1\r\nLine 2', phone: '555', email: 'a@b.c', website: 'x.y', logo: 'javascript:alert(1)', extra: 'nope' });
  assert.deepStrictEqual(c, { name: 'Northway Ltd.', address: 'Line 1\nLine 2', phone: '555', email: 'a@b.c', website: 'x.y', logo: '' });
  assert.strictEqual(Company.normalizeCompany({ name: 'x'.repeat(500) }).name.length, 120);
  assert.deepStrictEqual(Company.normalizeCompany(null), Company.emptyCompany());
  assert.deepStrictEqual(Company.normalizeCompany({ name: 42, logo: 5 }), Company.emptyCompany());
  assert.strictEqual(Company.normalizeCompany({ name: 'A\u0000B\u0007C' }).name, 'ABC'); // control characters removed
});

test('only PNG and JPEG data URLs are accepted as logos', () => {
  assert.strictEqual(Company.isValidLogo(PNG), true);
  assert.strictEqual(Company.isValidLogo(JPEG), true);
  assert.strictEqual(Company.isValidLogo('data:image/svg+xml;base64,PHN2Zz4='), false); // SVGs are converted to PNG first
  assert.strictEqual(Company.isValidLogo('data:image/png;base64,abc def'), false);
  assert.strictEqual(Company.isValidLogo('https://example.com/logo.png'), false);
  assert.strictEqual(Company.isValidLogo('data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024)), false); // too large
});

test('imageSize reads PNG and JPEG dimensions', () => {
  assert.deepStrictEqual(Company.imageSize(PNG), { type: 'png', width: 2, height: 1 });
  assert.deepStrictEqual(Company.imageSize(JPEG), { type: 'jpeg', width: 3, height: 2 });
  assert.strictEqual(Company.imageSize('nope'), null);
});

test('hasCompany', () => {
  assert.strictEqual(Company.hasCompany(Company.emptyCompany()), false);
  assert.strictEqual(Company.hasCompany({ name: 'X' }), true);
});
