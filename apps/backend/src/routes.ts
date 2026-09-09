import { Router } from 'express';
import authRoutes from './modules/auth/routes';
import teamRoutes from './modules/teams/routes';
import apiRoutes from './modules/apis/routes';
import incidentRoutes from './modules/incidents/routes';

export const router = Router();

router.use('/auth', authRoutes);
router.use('/teams', teamRoutes);
router.use('/apis', apiRoutes);
router.use('/incidents', incidentRoutes);