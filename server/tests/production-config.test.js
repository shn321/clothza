/* CLOTHZA Step 33 — production configuration validation.
   Pure function checks: development never blocks, production fails fast
   on missing MONGODB_URI / JWT_SECRET and warns on short secrets or a
   missing CLIENT_URL. No database, no network. */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { checkProductionConfig } = await import('../src/utils/prodConfig.js')

describe('production configuration check', () => {
  it('development is never blocked', () => {
    for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }, { NODE_ENV: '' }]) {
      const { fatal } = checkProductionConfig(env)
      assert.deepEqual(fatal, [])
    }
  })

  it('production without MONGODB_URI / JWT_SECRET is fatal', () => {
    const { fatal } = checkProductionConfig({ NODE_ENV: 'production' })
    assert.ok(fatal.some((m) => m.includes('MONGODB_URI')))
    assert.ok(fatal.some((m) => m.includes('JWT_SECRET')))
  })

  it('production with only one required value still fails fast', () => {
    assert.ok(
      checkProductionConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://x' }).fatal.some((m) =>
        m.includes('JWT_SECRET'),
      ),
    )
    assert.ok(
      checkProductionConfig({ NODE_ENV: 'production', JWT_SECRET: 's'.repeat(40) }).fatal.some((m) =>
        m.includes('MONGODB_URI'),
      ),
    )
  })

  it('complete production config is clean; short secret + missing CLIENT_URL warn', () => {
    const good = checkProductionConfig({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://x',
      JWT_SECRET: 's'.repeat(40),
      CLIENT_URL: 'https://shop.example.com',
    })
    assert.deepEqual(good.fatal, [])
    assert.deepEqual(good.warnings, [])

    const weak = checkProductionConfig({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://x',
      JWT_SECRET: 'short',
    })
    assert.deepEqual(weak.fatal, [])
    assert.ok(weak.warnings.some((m) => m.includes('JWT_SECRET')))
    assert.ok(weak.warnings.some((m) => m.includes('CLIENT_URL')))
  })

  it('never echoes secret values, only variable names', () => {
    const secret = 'super-secret-value-12345678901234567890'
    const { fatal, warnings } = checkProductionConfig({ NODE_ENV: 'production', JWT_SECRET: secret })
    assert.doesNotMatch(JSON.stringify({ fatal, warnings }), /super-secret-value/)
  })
})
