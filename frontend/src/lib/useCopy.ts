// frontend/src/lib/useCopy.ts
import { useEffect, useState } from "react";

export const useCopy = () => {
  const [COPY, setCOPY] = useState<any>(null);

  useEffect(() => {
    // @ts-ignore — window.COPY is injected from /public/config/copy.js
    if (window.COPY) setCOPY(window.COPY);
  }, []);

  return COPY;
};