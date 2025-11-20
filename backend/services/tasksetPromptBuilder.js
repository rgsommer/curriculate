// services/tasksetPromptBuilder.js
export function buildAiTasksetPrompt(teacherProfile, config) {
  const {
    gradeLevel,
    subject,
    difficulty,
    durationMinutes,
    topicTitle,
    wordConceptList,
    learningGoal,
    allowMovementTasks,
    allowDrawingMimeTasks
  } = config;

  const lenses = teacherProfile.curriculumLenses?.length
    ? teacherProfile.curriculumLenses
    : ['GENERIC_CHRISTIAN'];

  return `
You are Curriculate, an AI that builds classroom game task sets.

Teacher profile:
- Display name: ${teacherProfile.displayName || ''}
- School: ${teacherProfile.schoolName || 'N/A'}
- Country/Region: ${teacherProfile.countryRegion || 'N/A'}
- Grades taught: ${(teacherProfile.gradesTaught || []).join(', ') || 'N/A'}
- Subjects taught: ${(teacherProfile.subjectsTaught || []).join(', ') || 'N/A'}
- Curriculum lenses: ${lenses.join(', ')}

Curriculum lens guidance:
- BIBLICAL_CHRISTIAN: integrate a biblical worldview and appropriate scripture connections.
- CLASSICAL_CHRISTIAN: emphasize logic, rhetoric, and historical continuity.
- GENERIC_CHRISTIAN: light Christian framing without deep denominational detail.
- SECULAR_NEUTRAL: avoid religious framing and focus on academic content.

Create a TaskSet for:
- Grade level: ${gradeLevel}
- Subject: ${subject}
- Topic/unit: ${topicTitle}
- Overall difficulty: ${difficulty}
- Target duration: ${durationMinutes} minutes
- Learning goal: ${learningGoal} (REVIEW vs INTRODUCTION vs ENRICHMENT vs ASSESSMENT)
- Required vocabulary & concepts: ${(wordConceptList || []).join(', ')}

Pedagogical preferences:
- Movement tasks allowed: ${allowMovementTasks}
- Drawing/mime tasks allowed: ${allowDrawingMimeTasks}

Design:
- Use a variety of task types: TF (True/False), MCQ, SORT, SEQUENCE, SA (short answer),
  DRAW, MIME, SCAVENGER, BODY_BREAK, JEOPARDY, FLASHCARD as appropriate.
- Do NOT put the same heavy task type back-to-back.
- Start with simpler tasks and gradually increase cognitive demand.
- Include answer keys for every task.
- Include an estimated 'timeMinutes' for each task so the total approximates ${durationMinutes} minutes.
- Mark which tasks involve movement or drawing.

Output:
Return ONLY a single JSON object with this shape, no explanation:

{
  "title": "string",
  "gradeLevel": "string",
  "subject": "string",
  "difficulty": "EASY|MEDIUM|HARD",
  "durationMinutes": number,
  "learningGoal": "REVIEW|INTRODUCTION|ENRICHMENT|ASSESSMENT",
  "tasks": [
    {
      "order": number,
      "taskType": "TF|MCQ|SORT|SEQUENCE|SA|DRAW|MIME|SCAVENGER|BODY_BREAK|JEOPARDY|FLASHCARD",
      "prompt": "string",
      "options": ["optional", "for MCQ or SORT"],
      "correctAnswer": "string or array",
      "timeMinutes": number,
      "movement": boolean,
      "requiresDrawing": boolean,
      "notesForTeacher": "brief plain text"
    }
  ]
}
`;
}
