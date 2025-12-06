// frontend/src/app/page.tsx  ← replace everything with this
import { redirect } from 'next/navigation';

export default function Home() {
  // In real app: check auth cookie/session
  // For now, just go straight to dashboard
  redirect('/dashboard');
}