// Company details shown on reports and exports. Saved once per computer (not per job).
// Pure functions so they can be unit-tested; main.js does the file reading/writing.

const FIELDS = ['name', 'address', 'phone', 'email', 'website'];
const MAX_TEXT = { name: 120, address: 300, phone: 60, email: 120, website: 120 };
// The app stores the logo as a resized PNG or JPEG data URL (done in the window).
const LOGO_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const MAX_LOGO_CHARS = 3 * 1024 * 1024; // ~2.2 MB of image data

function emptyCompany() {
  return { name: '', address: '', phone: '', email: '', website: '', logo: '' };
}

function isValidLogo(logo) {
  return typeof logo === 'string' && logo.length <= MAX_LOGO_CHARS && LOGO_RE.test(logo);
}

// Keep only known fields, as trimmed text of a sensible length; drop a bad logo.
function normalizeCompany(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = emptyCompany();
  for (const k of FIELDS) {
    const v = typeof src[k] === 'string' ? src[k] : '';
    out[k] = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT[k]);
  }
  out.logo = isValidLogo(src.logo) ? src.logo : '';
  return out;
}

function hasCompany(c) {
  return !!(c && (c.name || c.logo));
}

// Width and height of a PNG or JPEG data URL, read from the file header.
function imageSize(dataUrl) {
  if (!isValidLogo(dataUrl)) return null;
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) hold the size
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

module.exports = { FIELDS, MAX_TEXT, emptyCompany, normalizeCompany, isValidLogo, hasCompany, imageSize };
