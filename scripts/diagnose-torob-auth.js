'use strict';

require('dotenv').config();
const crypto = require('crypto');
const {
  TOROB_PUBLIC_KEY,
  _private: { normalizeAudienceHost, DEFAULT_TOROB_AUDIENCE },
} = require('../middlewares/torobAuth');

const key = crypto.createPublicKey(TOROB_PUBLIC_KEY);
const configuredAudience = normalizeAudienceHost(process.env.TOROB_EXPECTED_AUDIENCE);
const siteAudience = normalizeAudienceHost(process.env.SITE_BASE_URL || process.env.SITE_URL);
const effectiveAudience = configuredAudience || siteAudience || DEFAULT_TOROB_AUDIENCE;

console.log(JSON.stringify({
  torobPublicKeyType: key.asymmetricKeyType,
  torobPublicKeyMatchesOfficialEd25519Key: key.asymmetricKeyType === 'ed25519',
  configuredAudience: configuredAudience || null,
  siteAudience: siteAudience || null,
  effectiveAudience,
  expectedForOdourEndpoint: 'odour.ir',
  audienceMatchesOdourEndpoint: effectiveAudience === 'odour.ir',
  authDisabled: String(process.env.TOROB_AUTH_DISABLED || '').toLowerCase() === 'true',
  serverTimeUtc: new Date().toISOString(),
  clockToleranceSeconds: Number(process.env.TOROB_CLOCK_TOLERANCE_SECONDS || 30),
}, null, 2));
