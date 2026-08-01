import { redirect } from 'next/navigation';

type Ctx = { searchParams: { id?: string } | Promise<{ id?: string }> };

export default async function Success({ searchParams }: Ctx) {
  const sp = await searchParams;
  if (!sp?.id) redirect('/opportunities');
  redirect(`/opportunities/report/${sp.id}`);
}
