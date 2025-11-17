// student-app/src/App.jsx
import React from 'react';
import PlaySession from './PlaySession.jsx';

export default function App() {
  // For now, read code/teamId from URL query (e.g. ?code=ROOM&teamId=...)
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || '';
  const teamId = params.get('teamId') || null;

  return <PlaySession code={code} teamId={teamId} server={import.meta.env.VITE_API_URL || 'http://localhost:4000'} />;
}
