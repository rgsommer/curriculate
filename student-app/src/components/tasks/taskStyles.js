// student-app/src/components/tasks/taskStyles.js
//
// Thin ESM re-export layer.
// Many task components import "../taskStyles" (no extension). Vite/Rollup will
// resolve to this .js file, so it must expose *all* of the named exports.
//
// The actual implementations live in taskStyles.jsx.

export * from "./taskStyles.jsx";

// Explicit named exports (helps some bundlers/tree-shakers and avoids
// "is not exported" errors if a consumer expects a specific symbol).
export {
  UI,
  TaskCardFrame,
  TaskPanel,
  TaskTitle,
  TaskSubtitle,
  TaskBodyText,
  Pill,
  StatPill,
  Divider,
  InlineCode,
  HelpText,
  PrimaryButton,
  GhostButton,
  IconButton,
  TextInput,
  TextArea,
  SegmentedToggle,
} from "./taskStyles.jsx";
