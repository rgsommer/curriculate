// frontend/src/app/faq/page.tsx

const faqs = [
  {
    q: "Do students need accounts?",
    a: "No. Students join with a room code and team name. This allows fast onboarding, fewer privacy concerns, and no long-term student account management.",
  },
  {
    q: "Does Curriculate replace teaching?",
    a: "No. Curriculate is designed to amplify effective teaching—not replace it. Teachers still set the goals, explain concepts, and guide learning. Curriculate adds structure, visibility, and evidence to what teachers already do well.",
  },
  {
    q: "This looks powerful — but will it take a lot of time for teachers to set up?",
    a: "That concern is exactly why Curriculate was designed the way it is. Teachers do not need to spend hours building task sets. Most sessions can be created in minutes using AI-assisted generation, reusable templates, or prior sessions. Teachers set the goals and constraints; Curriculate handles structure, pacing, and task creation. Many teachers find that after running one session, preparation time is actually lower than with traditional lessons. (See the Features page for how planning, pacing, and task selection are handled automatically.)",
  },
  {
    q: "What does this require from teachers at a school-wide level?",
    a: "Curriculate is designed to be low-friction for teacher adoption. Teachers do not need to redesign their curriculum or learn complex workflows. Sessions can be introduced gradually, reused, and adapted over time. From a leadership perspective, the platform emphasizes consistency, clarity, and reduced prep burden rather than added expectations, making it easier to support sustainable implementation across classrooms. (The Features page outlines how these structures are built into the system by design.)",
  },
  {
    q: "Schools are trying to reduce device use. Why does Curriculate require devices?",
    a: "This is a fair concern—and one Curriculate was designed around intentionally. Curriculate is driven by technology, but the student experience is more about movement and tasks that are prompted by the device, not on the device. Students are not individually glued to screens. Instead, devices coordinate tasks, timers, prompts, and submissions while the learning happens through movement, discussion, collaboration, creation, and physical interaction. Students write on paper, observe physical displays, explore challenges around the room, discuss with teammates, and create real evidence of learning. The screen is a launchpad, not the destination.",
  },
  {
    q: "So what are students actually doing during a task?",
    a: "Depending on the task, students may be hunting for the next challenge around the room, building or arranging physical models, discussing answers as a team, writing on paper, acting out scenarios, drawing, debating, or searching for evidence. The device is often checked briefly for instructions or submission, then set aside.",
  },
  {
    q: "Are students working individually on their own screens?",
    a: "Most tasks are designed for intra-team collaboration. One device often serves an entire team, or devices are passed between students. Roles naturally emerge (reader, recorder, scanner, leader), which reduces isolation and increases face-to-face interaction.",
  },
  {
    q: "Can I define a worldview lens for how tasks are framed and evaluated?",
    a: "Yes. You can specify a worldview lens (values, virtues, assumptions, guiding principles) and apply it to task prompts, reflection questions, and scoring rubrics. You remain in control of the criteria; the system helps apply them consistently.",
  },
  {
    q: "Does the system decide my worldview or the ‘right’ perspective?",
    a: "No. The teacher defines the lens and the evaluation criteria. Any AI-assisted generation or scoring is constrained by teacher-defined prompts/rubrics and can be edited before students see it.",
  },
  {
    q: "Is worldview alignment optional?",
    a: "Yes. You can use it heavily, lightly, or not at all — per class, unit, or task — depending on your context and goals.",
  },
  {
    q: "How is this different from typical screen-based learning?",
    a: "Traditional ed-tech often keeps students seated, isolated, and continuously interacting with a screen. Curriculate uses the device to orchestrate learning—directing movement, pacing collaboration, capturing evidence, and giving feedback—while the learning itself happens off-screen as much as possible.",
  },
  {
    q: "Does this increase screen time overall?",
    a: "Not necessarily. While devices are present, screen interaction is typically brief and purposeful. Many classes report higher physical activity, more peer discussion, and less passive screen time compared to traditional digital worksheets or quizzes.",
  },
  {
    q: "Is it chaotic because students move around?",
    a: "Movement is structured and intentional. CurricQR-coded stations, time limits, clear prompts, and teacher-controlled pacing keep energy productive rather than chaotic. Teachers retain full control over when tasks start, pause, or end.",
  },
  {
    q: "Can this work in a quiet or highly structured classroom?",
    a: "Yes. Curriculate supports timers, clear expectations, teacher pacing controls, and optional limits on competition, sound effects, and celebrations. Movement can be calm and purposeful, not loud or disruptive.",
  },
  {
    q: "What devices does Curriculate work on?",
    a: "Any modern browser: phones, tablets, Chromebooks, or laptops. No installs are required. Many classrooms successfully share devices within teams.",
  },
  {
    q: "What happens if a device fails or connectivity drops?",
    a: "Because learning is team-based and often off-screen, a single device issue rarely stops the activity. Teams can continue discussing or creating while a device reconnects. Teachers can also pause or relaunch tasks instantly from the dashboard.",
  },
  {
    q: "How do teachers know students are actually engaged?",
    a: "Teachers see live indicators of participation, submissions, and progress. Evidence such as photos, drawings, written responses, and recordings provides visible proof of learning—not just clicks or guesses.",
  },
  {
    q: "Can students write on paper instead of typing?",
    a: "Yes! For written tasks (open-text, letter writing, case studies), students can choose to write on paper and snap a photo. The system reads their handwriting via OCR and fills in the answer field automatically. Students earn bonus points for choosing to write by hand—encouraging real pencil-and-paper engagement while still capturing the response digitally for reports.",
  },
  {
    q: "Are photos, drawings, and recordings included in the reports?",
    a: "Yes. Session reports include links to all physical evidence—handwriting photos, team selfies, photo journal entries, drawings, audio recordings, and more. These artifacts make learning visible to teachers, parents, and administrators, and provide authentic evidence that goes far beyond a score on a quiz.",
  },
];

export default function FAQPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">FAQ</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Clear answers to the questions teachers and administrators ask most often.
        </p>

        <div className="space-y-4">
          {faqs.map((f) => (
            <div key={f.q} className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8">
              <div className="text-xl font-extrabold text-gray-900 mb-2">{f.q}</div>
              <div className="text-gray-700 font-medium leading-relaxed">{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
