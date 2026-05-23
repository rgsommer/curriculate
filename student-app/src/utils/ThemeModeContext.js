// student-app/src/utils/ThemeModeContext.js
import { createContext, useContext } from "react";

/**
 * Provides the active theme key ("eager" | "bold" | "dyno") to any descendant.
 * The legacy literals "light"/"dark" are still accepted for back-compat.
 * Consumers must use isDarkTheme() from themeHelpers to branch on light/dark
 * rather than comparing against "dark" directly, since the value is now the
 * specific theme (so Bold and Dyno can render differently).
 * Wrap the app tree with <ThemeModeContext.Provider value={uiTheme}>.
 */
const ThemeModeContext = createContext("eager");

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export default ThemeModeContext;
