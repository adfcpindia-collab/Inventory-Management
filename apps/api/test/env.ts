// Runs before each test file, before any app module reads process.env.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://inv:inv@localhost:5432/inventory_test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.LOGIN_RATE_LIMIT_MAX = '1000';
