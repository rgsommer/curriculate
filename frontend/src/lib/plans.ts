// frontend/src/lib/plans.ts

export type Plan = 'free' | 'teacher_plus' | 'teacher_pro' | 'school';

export const PLAN_ORDER: Plan[] = ['free', 'teacher_plus', 'teacher_pro', 'school'];

export function planAtLeast(current: Plan, required: Plan) {
  return PLAN_ORDER.indexOf(current) >= PLAN_ORDER.indexOf(required);
}

export function hasTeacherPlus(plan: Plan) {
  return planAtLeast(plan, 'teacher_plus');
}
