// models/UserSubscription.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    planName: {
      type: String,
      enum: ['FREE', 'TEACHER_PLUS', 'SCHOOL'],
      required: true,
      default: 'FREE'
    },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    aiGenerationsUsedThisPeriod: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserSubscription', userSubscriptionSchema);
