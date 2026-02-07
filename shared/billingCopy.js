/**
 * Stripe-aligned, non-salesy upgrade copy for Curriculate.
 * Keep these short for dialogs, tooltips, banners.
 */

export const PLAN_LABELS = {
  FREE: "Free",
  TEACHER_PLUS: "Teacher Plus",
  TEACHER_PRO: "Teacher Pro",
  SCHOOL_PLUS: "School Plus",
  SCHOOL_PRO: "School Pro",
};

export const PRO_FEATURE_BULLETS = [
  "Higher student limits than Plus",
  "Expanded AI task generation",
  "Advanced student and session reports",
  "Designed for full classrooms and multiple classes",
];

export const TOOLTIP_COPY = {
  studentDetail: {
    title: "Student-level reporting",
    body: "Student detail reports are available on Plus and Pro plans. Upgrade to access per-student insights and exports.",
    cta: "View plans",
  },
  exportsPdf: {
    title: "PDF exports",
    body: "PDF exports are available on Plus and Pro plans. Upgrade to export session and student reports as PDFs.",
    cta: "Upgrade",
  },
  aiQuota: {
    title: "AI task generation limit",
    body: "You’ve reached the AI limit for your plan. Upgrade to increase AI task generation capacity.",
    cta: "Upgrade",
  },
  seats: {
    title: "Student capacity",
    body: "This action exceeds your current student capacity. Upgrade to increase student limits for full-class sessions.",
    cta: "View plans",
  },
  pastDue: {
    title: "Payment issue",
    body: "Your payment is past due. During the grace period, features remain available. Please update payment details to avoid interruptions.",
    cta: "Manage billing",
  },
  downgradePeriodEnd: {
    title: "Plan change scheduled",
    body: "Your plan remains active until the end of the current billing period. Downgrade will apply automatically at period end.",
    cta: "OK",
  },
};
