import { Router } from 'express';
import authRoutes from './modules/auth/routes';
import teamRoutes from './modules/teams/routes';

export const router = Router();

router.use('/auth', authRoutes);
router.use('/teams', teamRoutes);