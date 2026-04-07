// student-app/src/utils/ThemeModeContext.js
import { createContext, useContext } from "react";

/**
 * Provides "light" or "dark" to any descendant component.
 * Wrap the app tree with <ThemeModeContext.Provider value="dark">.
 */
const ThemeModeContext = createContext("light");

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export default ThemeModeContext;
