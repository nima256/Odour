'use strict';

const crypto = require('crypto');

// Official Torob Product API v3 Ed25519 public key.
// Keep the PEM exactly as provided by Torob (all three lines).
const TOROB_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAt6Mu4T0pBORY11W+QeM35UsmLO3vsf+6yKpFDEImFk0=
-----END PUBLIC KEY-----`;

const TOROB_PUBLIC_KEY = crypto.createPublicKey(TOROB_PUBLIC_KEY_PEM);
if (TOROB_PUBLIC_KEY.asymmetricKeyType !== 'ed25519') {
  throw new Error('Torob public key is not an Ed25519 key');
}

const DEFAULT_TOROB_AUDIENCE = 'odour.ir';
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

const asFiniteNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const decodeBase64UrlJson = (value, label) => {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Malformed JWT ${label}`);
  }

  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (_) {
    throw new Error(`Malformed JWT ${label}`);
  }
};

const normalizeAudienceHost = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Be forgiving when an environment variable was accidentally configured as
  // a full URL, while the JWT "aud" claim itself must still be the hostname.
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).host;
    } catch (_) {
      return '';
    }
  }

  // Audience is a host[:port], never a path.
  return raw.split('/')[0].trim();
};

const firstForwardedHost = (req) => {
  const forwarded = String(req?.get?.('x-forwarded-host') || '').trim();
  return forwarded ? forwarded.split(',')[0].trim() : '';
};

const resolveExpectedAudience = (req) => {
  const configured = normalizeAudienceHost(process.env.TOROB_EXPECTED_AUDIENCE);
  if (configured) return configured;

  // Prefer the canonical public site URL over req.host. On cPanel/reverse proxy
  // setups the internal Host can differ from the public hostname Torob signs.
  const canonical = normalizeAudienceHost(
    process.env.SITE_BASE_URL || process.env.SITE_URL
  );
  if (canonical) return canonical;

  const forwarded = normalizeAudienceHost(firstForwardedHost(req));
  if (forwarded) return forwarded;

  const requestHost = normalizeAudienceHost(req?.get?.('host'));
  return requestHost || DEFAULT_TOROB_AUDIENCE;
};

const audienceMatches = (claim, expected) => {
  if (!expected) return false;
  if (Array.isArray(claim)) return claim.some((value) => String(value) === expected);
  return typeof claim === 'string' && claim === expected;
};

const verifyEd25519Jwt = ({
  token,
  expectedAudience,
  publicKey,
  nowSeconds = Math.floor(Date.now() / 1000),
  clockToleranceSeconds = DEFAULT_CLOCK_TOLERANCE_SECONDS,
}) => {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Missing Torob token');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeBase64UrlJson(encodedHeader, 'header');
  const payload = decodeBase64UrlJson(encodedPayload, 'payload');

  // Torob explicitly signs v3 requests with EdDSA / Ed25519. Never accept a
  // fallback algorithm (HS*, RS*, none, etc.).
  if (header.alg !== 'EdDSA') throw new Error('Invalid JWT algorithm');
  if (header.v !== undefined && Number(header.v) !== 1) {
    throw new Error('Unsupported JWT version');
  }

  const key = publicKey instanceof crypto.KeyObject
    ? publicKey
    : crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('JWT verification key is not Ed25519');
  }

  let signature;
  try {
    signature = Buffer.from(encodedSignature, 'base64url');
  } catch (_) {
    throw new Error('Malformed JWT signature');
  }
  if (signature.length !== 64) throw new Error('Malformed JWT signature');

  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
  const isValidSignature = crypto.verify(null, signingInput, key, signature);
  if (!isValidSignature) throw new Error('Invalid JWT signature');

  const tolerance = Math.max(0, Math.min(300, Number(clockToleranceSeconds) || 0));
  const now = Number(nowSeconds);

  // exp is required by Torob's v3 token contract.
  const exp = asFiniteNumber(payload.exp);
  if (exp === null) throw new Error('JWT exp is missing or invalid');
  if (now >= exp + tolerance) throw new Error('JWT has expired');

  // Torob's documentation says to CHECK nbf when present. Do not require the
  // claim itself; some valid issuer tokens may omit it.
  if (payload.nbf !== undefined && payload.nbf !== null) {
    const nbf = asFiniteNumber(payload.nbf);
    if (nbf === null) throw new Error('JWT nbf is invalid');
    if (now + tolerance < nbf) throw new Error('JWT is not active yet');
  }

  if (!audienceMatches(payload.aud, expectedAudience)) {
    const received = Array.isArray(payload.aud)
      ? payload.aud.map(String).join(',')
      : String(payload.aud ?? '');
    throw new Error(
      `Invalid JWT audience (expected ${expectedAudience}, received ${received || '<missing>'})`
    );
  }

  return payload;
};

const getClockToleranceSeconds = () => {
  const configured = asFiniteNumber(process.env.TOROB_CLOCK_TOLERANCE_SECONDS);
  if (configured === null) return DEFAULT_CLOCK_TOLERANCE_SECONDS;
  return Math.max(0, Math.min(300, configured));
};

const verifyTorobJwt = (
  token,
  expectedAudience,
  nowSeconds = Math.floor(Date.now() / 1000)
) => verifyEd25519Jwt({
  token,
  expectedAudience,
  publicKey: TOROB_PUBLIC_KEY,
  nowSeconds,
  clockToleranceSeconds: getClockToleranceSeconds(),
});

const torobAuth = (req, res, next) => {
  // Local-only escape hatch. Never enable this on production.
  if (String(process.env.TOROB_AUTH_DISABLED || '').trim().toLowerCase() === 'true') {
    return next();
  }

  const tokenVersion = String(req.get('X-Torob-Token-Version') || '').trim();
  const token = String(req.get('X-Torob-Token') || '').trim();

  if (tokenVersion !== '1' || !token) {
    console.warn('Torob JWT validation failed: missing/invalid Torob auth headers');
    return res.status(401).json({ error: 'Unauthorized Torob request' });
  }

  const expectedAudience = resolveExpectedAudience(req);
  if (!expectedAudience) {
    console.error('Torob JWT validation failed: expected audience is not configured');
    return res.status(500).json({ error: 'Torob authentication is not configured' });
  }

  try {
    req.torobTokenPayload = verifyTorobJwt(token, expectedAudience);
    return next();
  } catch (error) {
    // Never log the token. The reason/expected audience is enough to diagnose
    // public-key, algorithm, clock and audience mismatches safely.
    console.warn(`Torob JWT validation failed: ${error.message}`);
    return res.status(401).json({ error: 'Unauthorized Torob request' });
  }
};

module.exports = {
  TOROB_PUBLIC_KEY: TOROB_PUBLIC_KEY_PEM,
  verifyTorobJwt,
  torobAuth,
  _private: {
    audienceMatches,
    normalizeAudienceHost,
    resolveExpectedAudience,
    verifyEd25519Jwt,
    DEFAULT_TOROB_AUDIENCE,
    DEFAULT_CLOCK_TOLERANCE_SECONDS,
  },
};
