"use client";

// Print / Save-as-PDF trigger for the Guide. The page's print CSS hides the
// nav + action buttons so it exports as a clean overview document.
export default function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Print / Save as PDF ⎙
    </button>
  );
}
