// src/components/tasks/ScannerOverlay.jsx
import React from 'react';
import PropTypes from 'prop-types';

/**
 * ScannerOverlay
 * Modern, animated QR scanner overlay with vertical scanning line
 * Designed for classroom physical multiple-choice tasks
 *
 * Features:
 * - Classic moving scan line with glow
 * - Subtle frame pulse
 * - Corner guides
 * - Centered instruction text
 * - Clean fade-in/out
 * - Mobile/desktop responsive
 */
export default function ScannerOverlay({
  visible = true,
  onClose,
  instruction = "Scan a colored station to choose your answer",
  className = "",
}) {
  if (!visible) return null;

  return (
    <div
      className={`
        fixed inset-0 z-[1000] bg-black/65 backdrop-blur-sm
        flex items-center justify-center transition-opacity duration-400
        ${className}
      `}
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        className="
          relative w-[min(90vw,340px)] aspect-square rounded-3xl
          overflow-hidden border-4 border-indigo-400/60
          shadow-2xl shadow-indigo-600/30
          animate-fade-in
        "
      >
        {/* Placeholder for actual camera feed / QR scanner */}
        {/* Replace this <div> with your <QrScanner /> component */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
          <div className="text-slate-400 text-center px-8">
            <div className="text-5xl mb-4">📷</div>
            <div className="text-lg font-medium">Camera feed active</div>
            <div className="text-sm opacity-70 mt-2">
              Align the CurricQR code within the frame
            </div>
          </div>
        </div>

        {/* Scanning line */}
        <div className="scanner-line" />

        {/* Glow overlay that follows the scan */}
        <div className="scanner-glow" />

        {/* Corner brackets / guides */}
        <div className="absolute inset-6 pointer-events-none">
          <div className="absolute top-0 left-0 w-16 h-16 border-t-4 border-l-4 border-cyan-400 rounded-tl-xl" />
          <div className="absolute top-0 right-0 w-16 h-16 border-t-4 border-r-4 border-cyan-400 rounded-tr-xl" />
          <div className="absolute bottom-0 left-0 w-16 h-16 border-b-4 border-l-4 border-cyan-400 rounded-bl-xl" />
          <div className="absolute bottom-0 right-0 w-16 h-16 border-b-4 border-r-4 border-cyan-400 rounded-br-xl" />
        </div>

        {/* Instruction text */}
        <div className="absolute bottom-[-60px] left-1/2 -translate-x-1/2 whitespace-nowrap">
          <div className="
            bg-black/60 backdrop-blur-sm px-6 py-3 rounded-full
            text-white text-base font-semibold shadow-lg
            border border-white/10
          ">
            {instruction}
          </div>
        </div>

        {/* Optional close button – uncomment if needed */}
        {/* {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/40 rounded-full p-2 z-10"
            aria-label="Close scanner"
          >
            ✕
          </button>
        )} */}
      </div>

      <style jsx>{`
        .scanner-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            #a5b4fc 30%,
            #c084fc 50%,
            #a5b4fc 70%,
            transparent 100%
          );
          box-shadow: 0 0 20px #c084fc, 0 0 40px #a5b4fc;
          animation: scan 3.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .scanner-glow {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            transparent 35%,
            rgba(165, 180, 252, 0.35) 50%,
            transparent 65%
          );
          pointer-events: none;
          animation: glow-pulse 4.2s ease-in-out infinite;
        }

        @keyframes scan {
          0%   { top: -20%; opacity: 0.4; }
          25%  { opacity: 1; }
          50%  { top: 120%; opacity: 0.4; }
          75%  { opacity: 1; }
          100% { top: -20%; opacity: 0.4; }
        }

        @keyframes glow-pulse {
          0%, 100% { opacity: 0.18; }
          50%      { opacity: 0.55; }
        }

        @keyframes fade-in {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }

        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

ScannerOverlay.propTypes = {
  visible: PropTypes.bool,
  onClose: PropTypes.func,
  instruction: PropTypes.string,
  className: PropTypes.string,
};