// scripts/seedPlans.js
require('dotenv').config();
const mongoose = require('mongoose');
const SubscriptionPlan = require('../models/SubscriptionPlan');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const plans = [
    {
      name: 'FREE',
      monthlyPriceCents: 0,
      features: {
        maxAiGenerationsPerMonth: 5,
        canSaveTasksets: false,
        canEditGeneratedTasksets: false,
        canAccessSharedLibrary: false,
        allowedCurriculumLenses: ['GENERIC_CHRISTIAN', 'SECULAR_NEUTRAL'],
        hasAnalyticsDashboard: false,
        canViewTasksetAnalytics: false,
        canEmailReports: false
      }
    },
    {
      name: 'TEACHER_PLUS',
      monthlyPriceCents: 1500,
      features: {
        maxAiGenerationsPerMonth: 200,
        canSaveTasksets: true,
        canEditGeneratedTasksets: true,
        canAccessSharedLibrary: true,
        allowedCurriculumLenses: [
          'BIBLICAL_CHRISTIAN',
          'CLASSICAL_CHRISTIAN',
          'GENERIC_CHRISTIAN',
          'SECULAR_NEUTRAL'
        ],
        hasAnalyticsDashboard: true,
        canViewTasksetAnalytics: true,
        canEmailReports: true
      }
    },
    {
      name: 'SCHOOL',
      monthlyPriceCents: 5000,
      features: {
        maxAiGenerationsPerMonth: null, // unlimited
        canSaveTasksets: true,
        canEditGeneratedTasksets: true,
        canAccessSharedLibrary: true,
        allowedCurriculumLenses: [
          'BIBLICAL_CHRISTIAN',
          'CLASSICAL_CHRISTIAN',
          'GENERIC_CHRISTIAN',
          'SECULAR_NEUTRAL'
        ],
        hasAnalyticsDashboard: true,
        canViewTasksetAnalytics: true,
        canEmailReports: true
      }
    }
  ];

  for (const p of plans) {
    await SubscriptionPlan.findOneAndUpdate(
      { name: p.name },
      { $set: p },
      { upsert: true, new: true }
    );
    console.log('Upserted plan', p.name);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
