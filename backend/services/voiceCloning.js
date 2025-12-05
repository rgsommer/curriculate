// backend/services/voiceCloning.js
const teacherVoices = new Map(); // In prod: use Redis or DB

export async function getTeacherVoice(teacherId) {
  if (teacherVoices.has(teacherId)) {
    return teacherVoices.get(teacherId);
  }

  // Check if teacher has already cloned voice
  const existing = await Teacher.findOne({ _id: teacherId, voiceId: { $exists: true } });
  if (existing?.voiceId) {
    teacherVoices.set(teacherId, existing.voiceId);
    return existing.voiceId;
  }

  // First time: create cloned voice from sample
  const sampleUrl = existing?.voiceSampleUrl; // 15–30 sec recording from profile

  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Teacher_${teacherId}`,
      files: [sampleUrl],
      description: `Cloned voice for teacher ${teacherId}`,
    }),
  });

  const data = await response.json();
  const voiceId = data.voice_id;

  // Save to teacher profile
  await Teacher.updateOne({ _id: teacherId }, { voiceId });

  teacherVoices.set(teacherId, voiceId);
  return voiceId;
}