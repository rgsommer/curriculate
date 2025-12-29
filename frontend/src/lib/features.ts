// frontend/src/lib/features.ts

import type { Plan } from './plans';
import { planAtLeast } from './plans';

export type FeatureKey =
  | 'AI_TASKSETS'
  | 'REPORTS'
  | 'SESSION_HISTORY'
  | 'STATION_POSTERS'
  | 'SAVED_TASKSETS'
  | 'EARLY_FEATURES'
  | 'ADVANCED_ANALYTICS'
  | 'MULTI_CLASS_DASHBOARD'
  | 'SCHOOL_ADMIN'
  | 'LICENSE_SEATS';

export const FEATURES: Record<FeatureKey, Plan> = {
  AI_TASKSETS: 'teacher_plus',
  REPORTS: 'teacher_plus',
  SESSION_HISTORY: 'teacher_plus',
  STATION_POSTERS: 'teacher_plus',
  SAVED_TASKSETS: 'teacher_plus',
  EARLY_FEATURES: 'teacher_plus',

  ADVANCED_ANALYTICS: 'teacher_pro',
  MULTI_CLASS_DASHBOARD: 'teacher_pro',

  SCHOOL_ADMIN: 'school',
  LICENSE_SEATS: 'school',
};

export function hasFeature(plan: Plan, feature: FeatureKey) {
  return planAtLeast(plan, FEATURES[feature]);
}
