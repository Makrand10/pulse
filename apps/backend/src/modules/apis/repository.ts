import { Api, type ApiDoc } from '../../db/models/Api';
import { encryptSecret } from './crypto';
import { NotFoundError } from '../../lib/errors';
import type { ApiCreateInput, ApiUpdateInput } from '@pulse/shared-types';

type StoredApiInput = Omit<ApiCreateInput, 'authToken'> & { authTokenEncrypted?: string };

function prepareDoc(input: ApiCreateInput): StoredApiInput {
  const { authToken, ...rest } = input;
  const doc: StoredApiInput = { ...rest };
  if (authToken) {
    doc.authTokenEncrypted = encryptSecret(authToken);
  }
  return doc;
}

export async function createApi(teamId: string, input: ApiCreateInput): Promise<ApiDoc> {
  return Api.create({ teamId, ...prepareDoc(input) });
}

export async function listApis(teamId: string): Promise<ApiDoc[]> {
  return Api.find({ teamId }).sort({ createdAt: -1 });
}

export async function getApi(teamId: string, apiId: string): Promise<ApiDoc> {
  const api = await Api.findOne({ _id: apiId, teamId });
  if (!api) {
    throw new NotFoundError('API not found');
  }
  return api;
}

export async function updateApi(
  teamId: string,
  apiId: string,
  input: ApiUpdateInput,
): Promise<ApiDoc> {
  const api = await getApi(teamId, apiId);
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'authToken') {
      if (value) update.authTokenEncrypted = encryptSecret(value as string);
    } else if (value !== undefined) {
      update[key] = value;
    }
  }
  if (Object.keys(update).length > 0) {
    api.set(update);
    await api.save();
  }
  return api;
}

export async function deleteApi(teamId: string, apiId: string): Promise<void> {
  const result = await Api.deleteOne({ _id: apiId, teamId });
  if (result.deletedCount === 0) {
    throw new NotFoundError('API not found');
  }
}