import { Router } from 'express';
import {
  appendTimelineEvent,
  getIncident,
  listIncidents,
  transitionIncidentStatus,
} from './repository';
import { toIncidentDto } from './serializers';
import { incidentCommentSchema, incidentStatusUpdateSchema, incidentStatusSchema } from '@pulse/shared-types';
import { authGuard, requireTeam, adminOnly } from '../../middleware/auth';
import { NotFoundError, ConflictError } from '../../lib/errors';

const router = Router();

router.use(authGuard, requireTeam());

router.get('/', async (req, res) => {
  const rawStatus = req.query.status;
  const status = rawStatus ? incidentStatusSchema.parse(rawStatus) : undefined;
  const incidents = await listIncidents(req.teamId!, status);
  res.json(incidents.map(toIncidentDto));
});

router.get('/:incidentId', async (req, res) => {
  const incident = await getIncident(req.teamId!, String(req.params.incidentId));
  if (!incident) throw new NotFoundError('Incident not found');
  res.json(toIncidentDto(incident));
});

router.post('/:incidentId/comments', async (req, res) => {
  const { message } = incidentCommentSchema.parse(req.body);
  const incident = await getIncident(req.teamId!, String(req.params.incidentId));
  if (!incident) throw new NotFoundError('Incident not found');
  const updated = await appendTimelineEvent(req.teamId!, String(req.params.incidentId), {
    type: 'COMMENT',
    message,
    actorId: req.userId,
  });
  res.json(toIncidentDto(updated!));
});

router.patch('/:incidentId', adminOnly, async (req, res) => {
  const { status } = incidentStatusUpdateSchema.parse(req.body);
  const incident = await getIncident(req.teamId!, String(req.params.incidentId));
  if (!incident) throw new NotFoundError('Incident not found');
  if (incident.status === 'RESOLVED' && status === 'RESOLVED') {
    throw new ConflictError('Incident is already resolved');
  }
  const updated = await transitionIncidentStatus(
    req.teamId!,
    String(req.params.incidentId),
    status,
    `Status changed to ${status} by admin`,
    req.userId,
  );
  res.json(toIncidentDto(updated!));
});

export default router;