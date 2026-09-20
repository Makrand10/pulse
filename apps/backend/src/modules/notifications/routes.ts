import { Router } from 'express';
import { listNotifications, markNotificationRead, getNotification } from './repository';
import { toNotificationDto } from './serializers';
import { authGuard, requireTeam } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { notificationTypeSchema } from '@pulse/shared-types';

const router = Router();

router.use(authGuard, requireTeam());

router.get('/', async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const type = req.query.type ? notificationTypeSchema.parse(req.query.type) : undefined;
  const docs = await listNotifications(req.teamId!, { unreadOnly });
  const filtered = type ? docs.filter((d) => d.type === type) : docs;
  res.json(filtered.map(toNotificationDto));
});

router.post('/:notificationId/read', async (req, res) => {
  const updated = await markNotificationRead(req.teamId!, String(req.params.notificationId));
  if (!updated) {
    const exists = await getNotification(req.teamId!, String(req.params.notificationId));
    if (!exists) throw new NotFoundError('Notification not found');
    // Already read → idempotent success with current state.
  }
  const current = (await getNotification(req.teamId!, String(req.params.notificationId)))!;
  res.json(toNotificationDto(current));
});

export default router;