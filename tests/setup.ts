import 'dotenv/config'

// Tests always run against TEST_DATABASE_URL, never the dev or prod database.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL in .env to a separate, empty Postgres database before running tests')
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.JWT_SECRET ??= 'test-jwt-secret-test-jwt-secret-test-jwt-secret'
process.env.JWT_ADMIN_SECRET ??= 'test-admin-secret-test-admin-secret-test-admin'
process.env.OTP_PEPPER ??= 'test-otp-pepper'
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')
process.env.QR_SECRET ??= 'test-qr-secret'
