import { redirect } from 'next/navigation';

type Ctx = { searchParams: { id?: string } | Promise<{ id?: string }> };

export default async function Success({ searchParams }: Ctx) {
  const sp = await searchParams;
  if (!sp?.id) redirect('/businesses');
  redirect(`/businesses/report/${sp.id}`);
}
