process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/pulse_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS ?? '4';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'JXn4tT8sdTDPLnRQiJRLeMrYr6o+dE9DrFrryjNUZJM=';
