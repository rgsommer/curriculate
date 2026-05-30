// teacher-app/src/components/ui/index.js
//
// Barrel export for the shared UI primitives. Import everything from one path:
//   import { Button, Modal, Field, TextInput, TextArea, Select, PageHeader,
//            PageShell, COLORS, RADII, SHADOWS, SPACING } from "../components/ui";

export { default as Button } from "./Button";
export { default as Modal } from "./Modal";
export { default as Field, TextInput, TextArea, Select } from "./Field";
export { default as Checkbox } from "./Checkbox";
export { default as ToggleGroup } from "./ToggleGroup";
export { default as PageHeader, PageShell } from "./PageHeader";
export { COLORS, RADII, SHADOWS, SPACING, TYPE } from "./tokens";
