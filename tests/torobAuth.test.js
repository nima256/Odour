'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  TOROB_PUBLIC_KEY,
  _private: {
    normalizeAudienceHost,
    resolveExpectedAudience,
    verifyEd25519Jwt,
  },
} = require('../middlewares/torobAuth');

const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const makeToken = ({ privateKey, payload, header = {} }) => {
  const encodedHeader = base64urlJson({ alg: 'EdDSA', typ: 'JWT', v: 1, ...header });
  const encodedPayload = base64urlJson(payload);
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
  const signature = crypto.sign(null, signingInput, privateKey).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

const keyPair = crypto.generateKeyPairSync('ed25519');
const NOW = 2_000_000_000;

test('official Torob public key is parsed as Ed25519', () => {
  const key = crypto.createPublicKey(TOROB_PUBLIC_KEY);
  assert.equal(key.asymmetricKeyType, 'ed25519');
});

test('accepts a valid EdDSA/Ed25519 token with exact audience', () => {
  const token = makeToken({
    privateKey: keyPair.privateKey,
    payload: { aud: 'odour.ir', exp: NOW + 300, nbf: NOW - 10 },
  });

  const payload = verifyEd25519Jwt({
    token,
    expectedAudience: 'odour.ir',
    publicKey: keyPair.publicKey,
    nowSeconds: NOW,
    clockToleranceSeconds: 0,
  });

  assert.equal(payload.aud, 'odour.ir');
});

test('nbf is optional, matching Torob token-guide semantics', () => {
  const token = makeToken({
    privateKey: keyPair.privateKey,
    payload: { aud: 'odour.ir', exp: NOW + 300 },
  });

  assert.doesNotThrow(() => verifyEd25519Jwt({
    token,
    expectedAudience: 'odour.ir',
    publicKey: keyPair.publicKey,
    nowSeconds: NOW,
    clockToleranceSeconds: 0,
  }));
});

test('rejects a token with a different audience', () => {
  const token = makeToken({
    privateKey: keyPair.privateKey,
    payload: { aud: 'www.odour.ir', exp: NOW + 300 },
  });

  assert.throws(
    () => verifyEd25519Jwt({
      token,
      expectedAudience: 'odour.ir',
      publicKey: keyPair.publicKey,
      nowSeconds: NOW,
      clockToleranceSeconds: 0,
    }),
    /Invalid JWT audience/
  );
});

test('rejects an expired token', () => {
  const token = makeToken({
    privateKey: keyPair.privateKey,
    payload: { aud: 'odour.ir', exp: NOW - 1 },
  });

  assert.throws(
    () => verifyEd25519Jwt({
      token,
      expectedAudience: 'odour.ir',
      publicKey: keyPair.publicKey,
      nowSeconds: NOW,
      clockToleranceSeconds: 0,
    }),
    /expired/
  );
});

test('rejects a JWT that advertises a non-EdDSA algorithm', () => {
  const token = makeToken({
    privateKey: keyPair.privateKey,
    header: { alg: 'RS256' },
    payload: { aud: 'odour.ir', exp: NOW + 300 },
  });

  assert.throws(
    () => verifyEd25519Jwt({
      token,
      expectedAudience: 'odour.ir',
      publicKey: keyPair.publicKey,
      nowSeconds: NOW,
      clockToleranceSeconds: 0,
    }),
    /algorithm/
  );
});

test('audience resolver prefers configured/canonical public hostname over proxy host', () => {
  const oldExpected = process.env.TOROB_EXPECTED_AUDIENCE;
  const oldBase = process.env.SITE_BASE_URL;
  const oldSite = process.env.SITE_URL;

  try {
    delete process.env.TOROB_EXPECTED_AUDIENCE;
    process.env.SITE_BASE_URL = 'https://odour.ir';
    delete process.env.SITE_URL;

    const req = {
      get(name) {
        if (String(name).toLowerCase() === 'host') return '127.0.0.1:3000';
        if (String(name).toLowerCase() === 'x-forwarded-host') return 'internal-proxy.local';
        return '';
      },
    };

    assert.equal(resolveExpectedAudience(req), 'odour.ir');
  } finally {
    if (oldExpected === undefined) delete process.env.TOROB_EXPECTED_AUDIENCE;
    else process.env.TOROB_EXPECTED_AUDIENCE = oldExpected;
    if (oldBase === undefined) delete process.env.SITE_BASE_URL;
    else process.env.SITE_BASE_URL = oldBase;
    if (oldSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = oldSite;
  }
});

test('normalizes a full URL config to the exact host audience', () => {
  assert.equal(normalizeAudienceHost('https://odour.ir/torob_api/v3/products'), 'odour.ir');
  assert.equal(normalizeAudienceHost('odour.ir'), 'odour.ir');
  assert.equal(normalizeAudienceHost('www.odour.ir'), 'www.odour.ir');
});
