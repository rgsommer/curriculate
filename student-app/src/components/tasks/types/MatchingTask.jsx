// student-app/src/components/tasks/types/MatchingTask.jsx
// ... (keep all previous imports and code up to the return statement)

export default function MatchingTask({ task, onSubmit, disabled, onAnswerChange }) {
  // ... (existing code: leftItems, rightItems, correctMatches, sounds, etc.)

  const [matches, setMatches] = useState({});
  const [dragging, setDragging] = useState(null);
  const [lines, setLines] = useState([]);
  const [history, setHistory] = useState([]); // NEW: Undo stack (array of previous matches states)
  const svgRef = useRef(null);

  // Save to history whenever a match is made
  const addMatch = (fromId, toId) => {
    const newMatches = { ...matches, [fromId]: toId };
    setHistory(prev => [...prev, matches]); // Save previous state
    setMatches(newMatches);

    const isCorrect = correctMatches[fromId] === toId;
    setLines(prev => [...prev, {
      fromId,
      toId,
      progress: 0,
      correct: isCorrect,
    }]);

    playSound(sounds.match);
    onAnswerChange?.({ matches: newMatches });
  };

  // NEW: Undo last match
  const undoLastMatch = () => {
    if (history.length === 0) return;

    const previousMatches = history[history.length - 1];
    const lastFromId = Object.keys(matches).find(id => !previousMatches.hasOwnProperty(id) || previousMatches[id] !== matches[id]);

    setMatches(previousMatches);
    setHistory(prev => prev.slice(0, -1));

    // Remove the last line animation
    setLines(prev => prev.slice(0, -1));

    onAnswerChange?.({ matches: previousMatches });
  };

  const handleDrop = (e, toId) => {
    e.preventDefault();
    if (disabled || !dragging || matches[dragging.fromId]) return;

    addMatch(dragging.fromId, toId);
    setDragging(null);
  };

  // ... (rest of useEffect for line animation, etc.)

  const isComplete = Object.keys(matches).length === leftItems.length;
  const canUndo = history.length > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto h-screen flex flex-col">
      <h2 className="font-bold text-2xl mb-8 text-center">{task?.prompt || "Draw lines to match concepts to words"}</h2>

      {/* Undo Button */}
      <div className="flex justify-center mb-4">
        <button
          onClick={undoLastMatch}
          disabled={!canUndo || disabled}
          className={`px-8 py-3 rounded-full font-bold text-lg transition-all shadow-lg flex items-center gap-3 ${
            canUndo && !disabled
              ? "bg-orange-500 hover:bg-orange-600 text-white"
              : "bg-gray-400 text-gray-600 cursor-not-allowed"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          Undo Last Match
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center bg-gradient-to-r from-blue-50 to-indigo-100 rounded-3xl shadow-2xl overflow-hidden">
        {/* ... (SVG, left column, right column – unchanged) */}
      </div>

      <div className="mt-8 text-center flex justify-center gap-6 items-center">
        {/* Undo button moved above for better visibility – or keep both if desired */}
        <button
          onClick={undoLastMatch}
          disabled={!canUndo || disabled}
          className={`px-8 py-4 rounded-2xl font-bold text-xl transition-all shadow-lg flex items-center gap-3 ${
            canUndo && !disabled
              ? "bg-orange-600 hover:bg-orange-700 text-white"
              : "bg-gray-500 text-gray-300 cursor-not-allowed"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16.2V7.8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16.2V7.8a1 1 0 00-1.6-.8l-5.334 4z" />
          </svg>
          Undo
        </button>

        <button
          className={`px-12 py-4 text-xl font-bold rounded-2xl shadow-lg transition-all ${
            isComplete
              ? 'bg-green-600 hover:bg-green-700 text-white animate-pulse'
              : 'bg-gray-500 text-gray-300 cursor-not-allowed'
          }`}
          onClick={handleSubmit}
          disabled={!isComplete || disabled}
        >
          {isComplete ? '🎉 Submit Matches!' : `Complete ${leftItems.length - Object.keys(matches).length} more`}
        </button>
      </div>

      {/* Optional: Show progress */}
      <div className="text-center mt-4 text-lg font-medium text-indigo-700">
        {Object.keys(matches).length} / {leftItems.length} matches made
        {canUndo && <span className="ml-4 text-orange-600">← You can undo!</span>}
      </div>
    </div>
  );
}