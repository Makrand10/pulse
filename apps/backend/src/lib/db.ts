import mongoose from 'mongoose';

export async function connectDb(uri: string): Promise<typeof mongoose.connection> {
  await mongoose.connect(uri);
  return mongoose.connection;
}

export function getConnection(): typeof mongoose.connection {
  return mongoose.connection;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.connection.close();
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}