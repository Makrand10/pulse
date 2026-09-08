import { Router, type Request, type Response } from 'express';
import { createApi, listApis, getApi, updateApi, deleteApi } from './repository';
import { toApiDto } from './serializers';
import { apiCreateSchema, apiUpdateSchema } from '@pulse/shared-types';
import { assertUrlProbeable } from '../../lib/ssrf';
import { authGuard, requireTeam } from '../../middleware/auth';

const router = Router();

router.use(authGuard, requireTeam());

router.post('/', async (req: Request, res: Response) => {
  const input = apiCreateSchema.parse(req.body);
  assertUrlProbeable(input.url);
  const api = await createApi(req.teamId!, input);
  res.status(201).json(toApiDto(api));
});

router.get('/', async (req: Request, res: Response) => {
  const apis = await listApis(req.teamId!);
  res.json(apis.map(toApiDto));
});

router.get('/:apiId', async (req: Request, res: Response) => {
  const api = await getApi(req.teamId!, String(req.params.apiId));
  res.json(toApiDto(api));
});

router.patch('/:apiId', async (req: Request, res: Response) => {
  const input = apiUpdateSchema.parse(req.body);
  if (input.url) {
    assertUrlProbeable(input.url);
  }
  const api = await updateApi(req.teamId!, String(req.params.apiId), input);
  res.json(toApiDto(api));
});

router.delete('/:apiId', async (req: Request, res: Response) => {
  await deleteApi(req.teamId!, String(req.params.apiId));
  res.status(204).send();
});

export default router;