// teacher-app/src/components/tasks/TaskRenderer.jsx
import React from "react";

export default function TaskRenderer({ task }) {
  if (!task) return <div className="p-4 text-sm text-gray-500">No task selected.</div>;

  const { type, prompt, config = {} } = task;

  return (
    <div className="border rounded-lg bg-white p-4 space-y-3">
      <div className="text-xs uppercase text-gray-500 tracking-wide">
        {type}
      </div>
      <h2 className="font-semibold text-lg">{prompt}</h2>

      {type === "multiple-choice" && Array.isArray(config.options) && (
        <ul className="list-disc pl-5 text-sm space-y-1">
          {config.options.map((opt, idx) => (
            <li key={idx}>{opt}</li>
          ))}
        </ul>
      )}

      {type === "true-false" && (
        <div className="text-sm text-gray-700">Answer: True or False</div>
      )}

      {type === "short-answer" && (
        <div className="text-sm text-gray-700 italic">
          Short text response expected.
        </div>
      )}

      {type === "sort" && (
        <div className="text-sm space-y-2">
          <div className="font-semibold">Buckets:</div>
          <ul className="list-disc pl-5">
            {(config.buckets || []).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <div className="font-semibold mt-2">Items:</div>
          <ul className="list-disc pl-5">
            {(config.items || []).map((item, i) => (
              <li key={i}>{item.text}</li>
            ))}
          </ul>
        </div>
      )}

      {type === "sequence" && (
        <div className="text-sm">
          <div className="font-semibold mb-1">Items in correct order:</div>
          <ol className="list-decimal pl-5 space-y-1">
            {(config.correctOrder || []).map((idx, i) => {
              const item = config.items?.[idx];
              return <li key={i}>{item?.text || "…"}</li>;
            })}
          </ol>
        </div>
      )}

      {type === "photo" && (
        <div className="text-sm text-gray-700">
          Students will submit a photo.
          {config.requirements && (
            <div className="mt-1 italic">{config.requirements}</div>
          )}
        </div>
      )}

      {type === "make-and-snap" && (
        <div className="text-sm text-gray-700">
          Students will create something and submit a photo.
          {Array.isArray(config.rubric) && config.rubric.length > 0 && (
            <div className="mt-1">
              <span className="font-semibold">Rubric:</span>{" "}
              {config.rubric.join(", ")}
            </div>
          )}
        </div>
      )}

      {type === "body-break" && (
        <div className="text-sm text-gray-700">
          Short physical activity / movement break.
          {config.verification && (
            <div className="mt-1">
              Verification: <code className="text-xs">{config.verification}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
